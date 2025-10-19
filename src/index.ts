import 'dotenv/config';
import http from 'node:http';
import { parse } from 'node:url';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { JobStore } from './jobs/jobStore.js';
import { enqueueJob } from './jobs/jobRunner.js';
import { listRuns, getRunMeta, diffRuns, setTriage, getTriageMap, setTriageMeta, getTriageMetaMap } from './store/jsonStore.js';
import { buildRoasts } from './synthesis/roast.js';
import { buildFixPack, fixPackToMarkdown } from './fixpacks/fixpack.js';
import { buildROI, roiToMarkdown } from './synthesis/roi.js';
import { buildSummary, summaryToMarkdown, buildRoadmap, roadmapToMarkdown } from './synthesis/summary.js';
import { issueDigest } from './synthesis/digest.js';
import { buildPRPack, prpackToMarkdown, prpackToUnifiedDiff } from './prpack/generate.js';
import { suggestSelectors } from './journeys/selectorHeuristics.js';
import { runFlow } from './journeys/runFlow.js';
import { buildCopySuggestionsFallback, buildCopySuggestionsLLM } from './synthesis/copyCoach.js';

const jobStore = new JobStore();

function sendJSON(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

function sendHTML(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = parse(req.url || '/', true);
  const method = req.method || 'GET';

  // CORS for convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'POST' && url.pathname === '/api/analyze') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const targetUrl = String(payload.url || '').trim();
      const maxDepth = Math.max(1, Math.min(Number(payload.maxDepth || 2), 3));
      const rawCrawler = payload?.engines?.crawler;
      const crawler = rawCrawler === 'http' ? 'http' : undefined;
      const rawA11y = payload?.engines?.a11y;
      const a11y = rawA11y === 'pa11y' ? 'pa11y' : undefined;
      // competitors can be array or comma-separated string
      let competitors: string[] | undefined = undefined;
      if (Array.isArray(payload.competitors)) {
        competitors = payload.competitors.map((s: any) => String(s||'').trim()).filter((s: string) => /^https?:\/\//i.test(s)).slice(0,3);
      } else if (payload.competitors) {
        const raw = String(payload.competitors || '');
        competitors = raw.split(',').map(s => s.trim()).filter(s => /^https?:\/\//i.test(s)).slice(0,3);
      }
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return sendJSON(res, 400, { error: 'Please enter a valid website address (https://...)' });
      }
      const job = jobStore.createJob(targetUrl, { maxDepth, engines: { crawler, a11y }, competitors });
      const reportUrl = `/api/report/${job.id}`;
      const jobUrl = `/api/job/${job.id}`;
      enqueueJob(jobStore, job.id);
      return sendJSON(res, 202, { jobId: job.id, reportUrl, jobUrl });
    } catch (e: any) {
      return sendJSON(res, 500, { error: e?.message || 'Server error' });
    }
  }

  // SSE: real-time progress stream
  if (method === 'GET' && url.pathname?.startsWith('/api/job/') && url.pathname?.endsWith('/stream')) {
    const id = (url.pathname.split('/')[3]) as string; // /api/job/:id/stream
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    } as any;
    res.writeHead(200, headers);
    res.write(`retry: 1500\n\n`);
    let last: { progress?: number; stage?: string; status?: string } = {};
    const send = (evt: string, data: any) => {
      res.write(`event: ${evt}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const timer = setInterval(() => {
      const job = jobStore.getJob(id);
      if (!job) {
        send('error', { error: 'not_found' });
        clearInterval(timer);
        try { res.end(); } catch {}
        return;
      }
      const snap = { progress: job.progress, stage: job.stage, status: job.status };
      if (snap.progress !== last.progress || snap.stage !== last.stage || snap.status !== last.status) {
        send('progress', snap);
        last = snap;
      }
      if (job.status === 'done') {
        send('done', { progress: 100, stage: 'done' });
        clearInterval(timer);
        try { res.end(); } catch {}
      } else if (job.status === 'error') {
        send('error', { error: job.error || 'error' });
        clearInterval(timer);
        try { res.end(); } catch {}
      }
    }, 1000);
    req.on('close', () => { try { clearInterval(timer); } catch {} });
    return;
  }

  // Serve artifacts under /runs/* (screenshots, logs, results)
  if (method === 'GET' && url.pathname?.startsWith('/runs/')) {
    try {
      const baseDir = path.resolve('runs');
      const rel = decodeURIComponent(url.pathname.replace(/^\/runs\//, ''));
      const abs = path.resolve(baseDir, rel);
      if (!abs.startsWith(baseDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const st = fs.statSync(abs);
      if (!st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(abs).toLowerCase();
      const ct = (
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.gif' ? 'image/gif' :
        ext === '.svg' ? 'image/svg+xml' :
        ext === '.json' ? 'application/json; charset=utf-8' :
        ext === '.log' || ext === '.txt' ? 'text/plain; charset=utf-8' :
        'application/octet-stream'
      );
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': st.size });
      const rs = fs.createReadStream(abs);
      rs.on('error', () => { try { res.destroy(); } catch {} });
      rs.pipe(res);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/job/')) {
    const id = url.pathname.split('/').pop() as string;
    const job = jobStore.getJob(id);
    if (!job) return sendJSON(res, 404, { error: 'Not found' });
    return sendJSON(res, 200, job);
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/report/')) {
    const id = url.pathname.split('/').pop() as string;
    const job = jobStore.getJob(id);
    if (!job) return sendHTML(res, 404, '<h1>Not found</h1>');
    if (!job.outputs?.artifacts?.reportHtml) {
      if (job.status === 'error') {
        const err = job.error ? String(job.error) : 'Unknown error';
        return sendHTML(res, 500, `<h1>Report error</h1><pre>${escapeHtml(err)}</pre>`);
      }
      const progNum = typeof job.progress === 'number' ? job.progress : 0;
      const prog = `${progNum}%`;
      const pendingHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Generating report…</title>
        <style>
          body{font-family:system-ui,Arial,sans-serif;padding:24px}
          .bar{height:8px;background:#eee;border-radius:999px;overflow:hidden;width:360px;margin:8px 0}
          .bar>span{display:block;height:100%;background:#4f46e5;width:${progNum}%}
          .muted{color:#555}
        </style>
      </head><body>
        <h1>Generating report…</h1>
        <p class="muted">Hang tight — this may take 1–3 minutes. This page will open automatically when ready.</p>
        <p>Job <code>${escapeHtml(id)}</code> — Status: <strong id="st">${escapeHtml(job.status)}</strong> | Stage: <strong id="sg">${escapeHtml(job.stage || 'queued')}</strong> | Progress: <strong id="p">${escapeHtml(String(prog))}</strong></p>
        <div class="bar"><span id="pb"></span></div>
        <p class="muted">Tip: You can start another scan from the home page.</p>
        <p><a id="joblink" href="/api/job/${escapeHtml(id)}" target="_blank">View job JSON</a> · <a href="/">Start another</a></p>
        <script>
          (function(){
            const id = ${JSON.stringify(id)};
            const pEl = document.getElementById('p');
            const pbEl = document.getElementById('pb');
            const stEl = document.getElementById('st');
            const sgEl = document.getElementById('sg');
            function setProg(n){ pEl.textContent = (typeof n === 'number') ? (n + '%') : 'pending'; if (typeof n === 'number') pbEl.style.width = n + '%'; }
            setProg(${progNum});
            function connectSSE(){
              if (!('EventSource' in window)) return false;
              try {
                const es = new EventSource('/api/job/' + id + '/stream');
                es.addEventListener('progress', function(ev){
                  try {
                    const j = JSON.parse(ev.data);
                    if (typeof j.progress === 'number') setProg(j.progress);
                    if (j.status) stEl.textContent = j.status;
                    if (j.stage) sgEl.textContent = j.stage;
                  } catch {}
                });
                es.addEventListener('done', function(){ es.close(); location.reload(); });
                es.addEventListener('error', function(){ /* fallback to poll */ es.close(); poll(); });
                return true;
              } catch (e) { return false; }
            }
            async function poll(){
              try {
                const r = await fetch('/api/job/' + id, { cache: 'no-cache' });
                if (!r.ok) throw new Error('status');
                const j = await r.json();
                setProg(j && typeof j.progress === 'number' ? j.progress : undefined);
                if (j && j.stage) sgEl.textContent = j.stage;
                if (j && j.status) stEl.textContent = j.status;
                if (j && j.status === 'done') { location.reload(); return; }
                if (j && j.status === 'error') { pEl.textContent = 'error'; return; }
              } catch (e) { /* ignore transient errors */ }
              setTimeout(poll, 1500);
            }
            if (!connectSSE()) { poll(); }
          })();
        </script>
      </body></html>`;
      return sendHTML(res, 202, pendingHtml);
    }
    // Augment the static report HTML for backward-compat (inject Roast script if missing)
    const augmented = augmentReportHtml(job, job.outputs.artifacts.reportHtml);
    return sendHTML(res, 200, augmented);
  }

  // Project runs page (HTML)
  if (method === 'GET' && url.pathname === '/project') {
    const q: any = url.query || {};
    const origin = q.origin ? String(q.origin) : '';
    if (!origin) {
      // Show simple index of origins and a form
      try {
        const all = await listRuns();
        const origins = Array.from(new Set((all || []).map((r: any) => r.origin))).sort();
        const items = origins.map(o => `<li><a href="/project?origin=${encodeURIComponent(o)}">${escapeHtml(o)}</a></li>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Past Scans</title></head>
          <body style="font-family:Arial,sans-serif; padding:24px">
            <h1>Past Scans</h1>
            <form action="/project" method="get" style="margin:8px 0;">
              <input name="origin" placeholder="https://example.com" style="width:360px"/>
              <button type="submit">Open</button>
            </form>
            <h3>Websites</h3>
            <ul>${items || '<li>(none)</li>'}</ul>
          </body></html>`;
        return sendHTML(res, 200, html);
      } catch {
        return sendHTML(res, 200, '<h1>Past Scans</h1><p>No results yet.</p>');
      }
    } else {
      try {
        const runs = await listRuns(origin);
        const rows = runs.map((r: any, i: number) => {
          const prev = runs[i+1];
          const diffLink = prev ? `<a href="/api/diff/${prev.id}/${r.id}" target="_blank">diff</a>` : '';
          return `<tr><td>${new Date(r.createdAt).toLocaleString()}</td><td>${r.counts.issues}</td><td><a href="/api/report/${r.id}">report</a></td><td>${diffLink}</td></tr>`;
        }).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Past Scans – ${escapeHtml(origin)}</title></head>
          <body style="font-family:Arial,sans-serif; padding:24px">
            <h1>Past Scans</h1>
            <p><strong>Website:</strong> ${escapeHtml(origin)} · <a href="/project">All websites</a></p>
            <table style="border-collapse:collapse; width:100%"><thead><tr><th>When</th><th>Findings</th><th>Report</th><th>Diff</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">No runs yet</td></tr>'}</tbody></table>
          </body></html>`;
        return sendHTML(res, 200, html);
      } catch {
        return sendHTML(res, 500, '<h1>Error</h1>');
      }
    }
  }

  async function loadOutputsSnapshot(id: string): Promise<{ pages?: any[]; issues?: any[]; journeys?: any[] } | null> {
    try {
      const p = path.resolve('runs', id, 'outputs.json');
      const raw = await fsp.readFile(p, 'utf-8');
      const j = JSON.parse(raw);
      return j && typeof j === 'object' ? j : null;
    } catch { return null; }
  }

  // Roast API: /api/roast/:id?personas=sassy,dev&intensity=2
  if (method === 'GET' && url.pathname?.startsWith('/api/roast/')) {
    const id = url.pathname.split('/').pop() as string;
    let job = jobStore.getJob(id);
    let issues: any[] = [];
    let pages: any[] = [];
    let journeys: any[] = [];
    if (job?.outputs) {
      issues = job.outputs.issues || [];
      pages = job.outputs.pages || [];
      journeys = job.outputs.journeys || [];
    } else {
      const snap = await loadOutputsSnapshot(id);
      if (!snap) return sendJSON(res, 404, { error: 'Not found' });
      issues = snap.issues || [];
      pages = snap.pages || [];
      journeys = snap.journeys || [];
    }
    const q: any = url.query || {};
    const list = String(q.personas || 'sassy').split(',').map((s: string) => s.trim()).filter(Boolean);
    const intensity = Math.max(1, Math.min(Number(q.intensity || 2), 3));
    const useLLM = String(q.llm||'').toLowerCase()==='1' || String(q.llm||'').toLowerCase()==='true';
    if (useLLM) {
      try {
        const mod = await import('./synthesis/roast.js');
        const llm = await (mod as any).buildRoastsLLM(list, issues, pages, journeys, intensity);
        if (llm) return sendJSON(res, 200, { roasts: llm });
      } catch {}
    }
    const roasts = buildRoasts(issues, pages, journeys, { personas: list as any, intensity: intensity as any, limitPerPersona: 6 });
    return sendJSON(res, 200, { roasts });
  }

  // Runs history
  if (method === 'GET' && url.pathname === '/api/runs') {
    const origin = typeof url.query?.origin === 'string' ? String(url.query?.origin) : undefined;
    try {
      const runs = await listRuns(origin);
      return sendJSON(res, 200, { runs });
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }

  // Fix Pack endpoints
  if (method === 'GET' && url.pathname?.startsWith('/api/fixpack/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; job = job || { id, url: '(unknown)', createdAt: '', options: {} } as any; }
    const fp = buildFixPack(job as any, pages as any, issues as any);
    return sendJSON(res, 200, fp);
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/fixpack/') && url.pathname?.endsWith('.md')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.md$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; job = job || { id, url: '(unknown)', createdAt: '', options: {} } as any; }
    const fp = buildFixPack(job as any, pages as any, issues as any);
    const md = fixPackToMarkdown(fp);
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    return res.end(md);
  }

  // ROI endpoints (accept optional query: monthlyVisitors, currentCVR, aov)
  if (method === 'GET' && url.pathname?.startsWith('/api/roi/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = []; let bench: any[] | undefined;
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; bench = job.outputs.bench?.targets; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; }
    const q = url.query || {} as any;
    const params = { monthlyVisitors: Number(q.monthlyVisitors || ''), currentCVR: Number(q.currentCVR || ''), aov: Number(q.aov || '') };
    const roi = buildROI((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any, bench as any, params);
    return sendJSON(res, 200, roi);
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/roi/') && url.pathname?.endsWith('.md')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.md$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = []; let bench: any[] | undefined;
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; bench = job.outputs.bench?.targets; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; }
    const q = url.query || {} as any;
    const params = { monthlyVisitors: Number(q.monthlyVisitors || ''), currentCVR: Number(q.currentCVR || ''), aov: Number(q.aov || '') };
    const roi = buildROI((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any, bench as any, params);
    const md = roiToMarkdown(roi);
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    return res.end(md);
  }
  // Planner/Jira exports
  if (method === 'GET' && url.pathname?.startsWith('/api/jira/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = []; let bench: any[] | undefined;
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; bench = job.outputs.bench?.targets; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; }
    const fix = buildFixPack((job || { id, url: '(unknown)' } as any), pages as any, issues as any);
    const items = (fix.actions || []).map((a: any, i: number) => ({
      summary: `[${a.type}] ${a.title}`,
      description: `${a.description}${a.pageUrl ? `\n\nPage: ${a.pageUrl}` : ''}`,
      issueType: 'Task',
      priority: a.type === 'perf' ? 'High' : a.type === 'flow' ? 'High' : a.type === 'a11y' ? 'Medium' : 'Medium',
      labels: [a.type, 'agentic-ux'],
      pageUrl: a.pageUrl || '',
      digest: `${a.type}-${i}`
    }));
    return sendJSON(res, 200, { items });
  }
  if (method === 'GET' && url.pathname?.startsWith('/api/jira/') && url.pathname?.endsWith('.csv')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.csv$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; }
    const fix = buildFixPack((job || { id, url: '(unknown)' } as any), pages as any, issues as any);
    const rows = (fix.actions || []).map((a: any, i: number) => ({
      Summary: `[${a.type}] ${a.title}`,
      Description: `${a.description}${a.pageUrl ? `\n\nPage: ${a.pageUrl}` : ''}`,
      IssueType: 'Task',
      Priority: a.type === 'perf' ? 'High' : a.type === 'flow' ? 'High' : a.type === 'a11y' ? 'Medium' : 'Medium',
      Labels: `agentic-ux,${a.type}`,
      Page: a.pageUrl || ''
    }));
    const header = Object.keys(rows[0] || { Summary:'', Description:'', IssueType:'', Priority:'', Labels:'', Page:'' });
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const csv = [header.join(',')].concat(rows.map(r => header.map(h => esc((r as any)[h])).join(','))).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    return res.end(csv);
  }

  // PR Pack (draft) endpoints
  if (method === 'GET' && url.pathname?.startsWith('/api/prpack/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; job = job || { id, url: '(unknown)', options: {}, createdAt: '' } as any; }
    const pk = buildPRPack(job as any, pages as any, issues as any);
    return sendJSON(res, 200, pk);
  }
  if (method === 'GET' && url.pathname?.startsWith('/api/prpack/') && url.pathname?.endsWith('.md')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.md$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; job = job || { id, url: '(unknown)', options: {}, createdAt: '' } as any; }
    const pk = buildPRPack(job as any, pages as any, issues as any);
    const md = prpackToMarkdown(pk);
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    return res.end(md);
  }
  if (method === 'GET' && url.pathname?.startsWith('/api/prpack/') && url.pathname?.endsWith('.patch')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.patch$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; job = job || { id, url: '(unknown)', options: {}, createdAt: '' } as any; }
    const pk = buildPRPack(job as any, pages as any, issues as any);
    const diff = prpackToUnifiedDiff(pk);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(diff);
  }

  // Journey tools
  if (method === 'POST' && url.pathname === '/api/journeys/suggest') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const urlIn = String(payload.url || '').trim();
      const selector = String(payload.selector || '').trim();
      if (!/^https?:\/\//i.test(urlIn) || !selector) return sendJSON(res, 400, { error: 'invalid url or selector' });
      const r = await suggestSelectors({ url: urlIn, selector });
      return sendJSON(res, 200, r);
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }
  if (method === 'POST' && url.pathname === '/api/journeys/run') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const flow = payload?.flow;
      if (!flow || !Array.isArray(flow?.steps)) return sendJSON(res, 400, { error: 'missing flow' });
      const result = await runFlow({ name: String(flow.name || 'ad-hoc'), steps: flow.steps });
      return sendJSON(res, 200, result);
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }
  if (method === 'GET' && url.pathname === '/api/journeys/recorder.js') {
    const js = `(function(){\n  try{\n    if(window.__uxRec) return; window.__uxRec={steps:[]};\n    function cssPath(el){\n      if(!el || el.nodeType!==1) return '';\n      if(el.id) return '#'+el.id;\n      var seg=el.tagName.toLowerCase();\n      if(el.classList && el.classList.length){ seg += '.' + Array.from(el.classList).slice(0,2).join('.'); }\n      if(el.getAttribute('data-testid')) seg += '[data-testid="'+el.getAttribute('data-testid')+'"]';\n      return seg;\n    }\n    document.addEventListener('click', function(e){ var s=cssPath(e.target); window.__uxRec.steps.push({action:'click', selector:s}); console.log('[rec] click', s); }, true);\n    document.addEventListener('input', function(e){ var s=cssPath(e.target); var v=(e.target && e.target.value)||''; window.__uxRec.steps.push({action:'type', selector:s, value:v}); console.log('[rec] type', s, v); }, true);\n    console.log('[rec] started. window.__uxRec.steps will fill.');\n    window.__uxDump=function(){ var flow={ name:'recorded', steps:[{action:'visit', url:location.href}].concat(window.__uxRec.steps) }; console.log(JSON.stringify(flow, null, 2)); return flow; };\n  }catch(e){ console.error(e); }\n})();`;
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }

  // Competitor bench raw JSON
  if (method === 'GET' && url.pathname?.startsWith('/api/bench/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    const job = jobStore.getJob(id);
    if (!job || !job.outputs) return sendJSON(res, 404, { error: 'Not found' });
    const base = job.outputs.pages?.[0] || null;
    const out = { base, competitors: job.outputs.bench?.targets || [] };
    return sendJSON(res, 200, out);
  }

  // LLM diagnostics (no secrets leaked)
  if (method === 'GET' && url.pathname === '/api/diag/llm') {
    const hasKey = !!process.env.GEMINI_API_KEY;
    return sendJSON(res, 200, { provider: 'gemini', configured: hasKey });
  }

  // Copy Coach (title/meta suggestions)
  if (method === 'GET' && url.pathname?.startsWith('/api/copy/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = [];
    if (job?.outputs) pages = job.outputs.pages || []; else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; }
    const q: any = url.query || {};
    const opts = {
      strategy: (q.strategy || 'refine') as any,
      brand: q.brand ? String(q.brand) : undefined,
      keywords: q.keywords ? String(q.keywords).split(',').map((s:string)=>s.trim()).filter(Boolean) : undefined,
      locale: q.locale ? String(q.locale) : undefined,
      tone: q.tone ? String(q.tone) as any : undefined,
      forceDifferent: String(q.forceDifferent||'true').toLowerCase() !== 'false'
    };
    const useLLM = String(q.llm||'').toLowerCase()==='1' || String(q.llm||'').toLowerCase()==='true';
    // Ensure site URL is available even when job is not in memory
    const siteUrl = job?.url || (pages && pages[0] && pages[0].url) || '(unknown)';
    if (useLLM) {
      try {
        const r = await buildCopySuggestionsLLM((job || { id, url: siteUrl } as any), pages as any, opts);
        if (r) return sendJSON(res, 200, { source: 'llm', ...r });
      } catch (e: any) {
        if (String(q.debug||'').toLowerCase()==='1') return sendJSON(res, 200, { source: 'fallback', error: String(e?.message||'llm_error'), site: siteUrl, suggestions: buildCopySuggestionsFallback({ id, url: siteUrl } as any, pages as any, opts).suggestions });
      }
    }
    const r = buildCopySuggestionsFallback((job || { id, url: siteUrl } as any), pages as any, opts);
    return sendJSON(res, 200, { source: 'fallback', ...r });
  }

  // Summary endpoints
  if (method === 'GET' && url.pathname?.startsWith('/api/summary/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = []; let journeys: any[] = []; let bench: any[] | undefined;
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; journeys = job.outputs.journeys || []; bench = job.outputs.bench?.targets; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; journeys = snap.journeys || []; }
    const fix = buildFixPack((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any);
    const roi = buildROI((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any, bench as any, {});
    const useLLM = String((url.query as any)?.llm || '').toLowerCase() === 'true' || String((url.query as any)?.llm || '').toLowerCase() === '1' || process.env.SUMMARY_LLM_DEFAULT === 'true';
    if (useLLM) {
      try {
        const mod = await import('./synthesis/summary.js');
        const sLLM = await (mod as any).buildSummaryLLM((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, journeys as any, issues as any, fix, roi);
        if (sLLM) return sendJSON(res, 200, sLLM);
      } catch (e: any) { /* fall through to template */ }
    }
    const s = buildSummary((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, journeys as any, issues as any, fix, roi);
    return sendJSON(res, 200, s);
  }
  if (method === 'GET' && url.pathname?.startsWith('/api/summary/') && url.pathname?.endsWith('.md')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.md$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = []; let journeys: any[] = []; let bench: any[] | undefined;
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; journeys = job.outputs.journeys || []; bench = job.outputs.bench?.targets; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) { res.writeHead(404); return res.end('Not found'); } pages = snap.pages || []; issues = snap.issues || []; journeys = snap.journeys || []; }
    const fix = buildFixPack((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any);
    const roi = buildROI((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any, bench as any, {});
    const useLLM = String((url.query as any)?.llm || '').toLowerCase() === 'true' || String((url.query as any)?.llm || '').toLowerCase() === '1' || process.env.SUMMARY_LLM_DEFAULT === 'true';
    let s: any = null;
    if (useLLM) {
      try {
        const mod = await import('./synthesis/summary.js');
        s = await (mod as any).buildSummaryLLM((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, journeys as any, issues as any, fix, roi);
      } catch { /* ignore */ }
    }
    if (!s) s = buildSummary((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, journeys as any, issues as any, fix, roi);
    const md = summaryToMarkdown(s);
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    return res.end(md);
  }

  // Roadmap endpoint
  if (method === 'GET' && url.pathname?.startsWith('/api/roadmap/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    let pages: any[] = []; let issues: any[] = [];
    if (job?.outputs) { pages = job.outputs.pages || []; issues = job.outputs.issues || []; }
    else { const snap = await loadOutputsSnapshot(id); if (!snap) return sendJSON(res, 404, { error: 'Not found' }); pages = snap.pages || []; issues = snap.issues || []; }
    const fix = buildFixPack((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), pages as any, issues as any);
    // Fetch triage meta for issues to influence plan
    const digests = (issues || []).map((i: any) => issueDigest(i));
    const metaMap = await getTriageMetaMap(digests);
    // Capacities via query params (optional)
    const q: any = url.query || {};
    const cap = {
      week1: { FE: Number(q.fe1||'')||undefined, Design: Number(q.design1||'')||undefined, SEO: Number(q.seo1||'')||undefined, QA: Number(q.qa1||'')||undefined },
      week2: { FE: Number(q.fe2||'')||undefined, Design: Number(q.design2||'')||undefined, SEO: Number(q.seo2||'')||undefined, QA: Number(q.qa2||'')||undefined }
    };
    // Clean undefineds
    Object.keys(cap.week1).forEach(k => { if (!(cap.week1 as any)[k]) delete (cap.week1 as any)[k]; });
    Object.keys(cap.week2).forEach(k => { if (!(cap.week2 as any)[k]) delete (cap.week2 as any)[k]; });
    const r = buildRoadmap((job || { id, url: '(unknown)', options: {}, createdAt: '' } as any), issues as any, fix, metaMap as any, cap as any);
    return sendJSON(res, 200, r);
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/run/')) {
    const id = url.pathname.split('/').pop() as string;
    try {
      const meta = await getRunMeta(id);
      const job = jobStore.getJob(id);
      return sendJSON(res, 200, { meta, job });
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }

  if (method === 'GET' && url.pathname?.startsWith('/api/diff/')) {
    const parts = (url.pathname || '').split('/'); // /api/diff/:a/:b
    const a = parts[3];
    const b = parts[4];
    try {
      const d = await diffRuns(a, b);
      return sendJSON(res, 200, d);
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }

  // Triage APIs
  if (method === 'POST' && url.pathname === '/api/triage') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const digest = String(payload.digest || '').trim();
      const state = payload.state || null;
      if (!digest) return sendJSON(res, 400, { error: 'missing digest' });
      await setTriage(digest, state);
      return sendJSON(res, 200, { ok: true });
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }

  if (method === 'GET' && url.pathname === '/api/triage') {
    try {
      const q = url.query || {} as any;
      const dParam = String(q.digests || '').trim();
      const digests = dParam ? dParam.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const map = await getTriageMap(digests);
      return sendJSON(res, 200, map);
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }
  // Triage meta
  if (method === 'POST' && url.pathname === '/api/triage/meta') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const digest = String(payload.digest || '').trim();
      if (!digest) return sendJSON(res, 400, { error: 'missing digest' });
      const meta: any = {};
      if (payload.state) meta.state = String(payload.state);
      if (payload.owner) meta.owner = String(payload.owner);
      if (payload.estimateHours != null) meta.estimateHours = Number(payload.estimateHours);
      if (payload.notes) meta.notes = String(payload.notes);
      await setTriageMeta(digest, meta);
      return sendJSON(res, 200, { ok: true });
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }
  if (method === 'GET' && url.pathname === '/api/triage/meta') {
    try {
      const q = url.query || {} as any;
      const dParam = String(q.digests || '').trim();
      const digests = dParam ? dParam.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const map = await getTriageMetaMap(digests);
      return sendJSON(res, 200, map);
    } catch (e: any) { return sendJSON(res, 500, { error: e?.message || 'error' }); }
  }

  // Issues export: JSON
  if (method === 'GET' && url.pathname?.startsWith('/api/issues/') && url.pathname?.endsWith('.json')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.json$/, '');
    let job = jobStore.getJob(id);
    if (job?.outputs) return sendJSON(res, 200, job.outputs.issues || []);
    const snap = await loadOutputsSnapshot(id);
    if (!snap) return sendJSON(res, 404, { error: 'Not found' });
    return sendJSON(res, 200, snap.issues || []);
  }

  // Issues export: CSV
  if (method === 'GET' && url.pathname?.startsWith('/api/issues/') && url.pathname?.endsWith('.csv')) {
    const id = (url.pathname.split('/').pop() as string).replace(/\.csv$/, '');
    let issues: any[] | undefined;
    const job = jobStore.getJob(id);
    if (job?.outputs) issues = job.outputs.issues || [];
    if (!issues) {
      const snap = await loadOutputsSnapshot(id);
      if (!snap) return sendHTML(res, 404, 'Not found');
      issues = snap.issues || [];
    }
    const rows = (issues || []).map((i: any) => ({
      id: i.id,
      type: i.type,
      pageUrl: i.pageUrl || '',
      title: i.title,
      evidence: i.evidence,
      severity: i.severity,
      impact: i.impact,
      effort: i.effort,
      score: i.score,
      wcag: i.wcag || '',
      ruleId: i.ruleId || '',
      metricName: i.metric?.name || '',
      metricValue: typeof i.metric?.value === 'number' ? i.metric.value : '',
      fixSteps: Array.isArray(i.fixSteps) ? i.fixSteps.join(' | ') : ''
    }));
    const header = Object.keys(rows[0] || { id:'', type:'', pageUrl:'', title:'', evidence:'', severity:'', impact:'', effort:'', score:'', wcag:'', ruleId:'', metricName:'', metricValue:'', fixSteps:'' });
    const esc = (v: any) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const csv = [header.join(',')].concat(rows.map(r => header.map(h => esc((r as any)[h])).join(','))).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    return res.end(csv);
  }

  // Default: serve Tailwind-based landing page (and preserve query auto-run)
  if (method === 'GET' && url.pathname === '/') {
    // If query params provided (url[, maxDepth, crawler, a11y, competitors]), auto-create job and redirect to report
    const q: any = url.query || {};
    const qUrl = q.url ? String(q.url).trim() : '';
    if (qUrl) {
      if (!/^https?:\/\//i.test(qUrl)) {
        return sendHTML(res, 400, '<h1>Please enter a valid website address</h1>');
      }
      const maxDepth = Math.max(1, Math.min(Number(q.maxDepth || 2), 3));
      const crawler = q.crawler === 'http' ? 'http' : undefined;
      const a11y = q.a11y === 'pa11y' ? 'pa11y' : undefined;
      let competitors: string[] | undefined;
      if (q.competitors) {
        competitors = String(q.competitors).split(',').map((s: string) => s.trim()).filter((s: string) => /^https?:\/\//i.test(s)).slice(0,3);
      }
      const job = jobStore.createJob(qUrl, { maxDepth, engines: { crawler, a11y }, competitors });
      enqueueJob(jobStore, job.id);
      const loc = `/api/report/${job.id}`;
      res.writeHead(303, { Location: loc, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta http-equiv="refresh" content="0;url=${loc}"><a href="${loc}">Redirecting to report…</a>`);
    }
    // Try to serve public/index.html (Tailwind UI). Fallback to old inline minimal UI on error.
    try {
      const html = await fsp.readFile(path.resolve('public', 'index.html'), 'utf-8');
      return sendHTML(res, 200, html);
    } catch {
      return sendHTML(res, 200, '<!doctype html><html><body><h1>Agentic UX</h1><p>Missing public/index.html</p></body></html>');
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
server.listen(PORT, () => {
  console.log(`Agentic UX prototype listening on http://localhost:${PORT}`);
});

function escapeHtml(s: string) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function augmentReportHtml(job: any, html: string): string {
  try {
    let out = String(html || '');
    // Sanitize remnants of TS syntax accidentally shipped inside inline scripts
    out = out.replace(/\(window as any\)/g, 'window');
    out = out.replace(/\bas any\b/g, '');
    out = out.replace(/\sas HTMLInputElement/g, '');
    // Remove non-null assertion before property access, e.g., el!.textContent
    out = out.replace(/\)!\./g, ').');
    // Ensure Generate button does not submit enclosing forms
    if (out.includes('id="genRoast"') && !/id=\"genRoast\"[^>]*type=\"button\"/i.test(out)) {
      out = out.replace(/<button([^>]*id=\"genRoast\"[^>]*)>/i, (m, attrs) => `<button${attrs} type="button">`);
    }
    // Always inject a robust roast wiring script (overrides broken ones in older reports)
    const script = `\n<script>(function(){\n  try {\n    var outEl = document.getElementById('roastOut');\n    function gen(){\n      try{\n        var checked = Array.prototype.slice.call(document.querySelectorAll('input[name=\\"persona\\\"]:checked')) || [];\n        var ps = checked.map(function(el){return el.value;}).join(',');\n        var honestyEl = document.getElementById('honesty');\n        var honesty = honestyEl && honestyEl.value ? honestyEl.value : 2;\n        if (outEl) outEl.textContent = 'Generating…';\n        fetch('/api/roast/${escapeHtml(job.id)}?personas=' + encodeURIComponent(ps || 'sassy') + '&intensity=' + honesty, { cache:'no-cache' })\n        .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })\n        .then(function(j){\n          var blocks = (j.roasts || []).map(function(b){\n            var title = (b.persona === 'sassy' ? 'Sassy Designer' : b.persona === 'dev' ? 'Grumpy Dev' : b.persona === 'coach' ? 'Conversion Coach' : b.persona === 'genz' ? 'Gen Z Critic' : b.persona === 'seo' ? 'SEO Shark' : 'Corporate Consultant');\n            var header = '<h3 style=\\"margin:8px 0\\">' + title + '</h3>';\n            var lines = '<ul>' + (b.lines || []).map(function(l){ return '<li>' + String(l).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }) + '</li>'; }).join('') + '</ul>';\n            return '<div class=\\"card\\">' + header + lines + '</div>';\n          }).join('');\n          if (outEl) outEl.innerHTML = blocks || '<em>No roast generated.</em>';\n        })\n        .catch(function(e){ if (outEl) outEl.textContent = 'Error generating roast: ' + (e && e.message ? e.message : String(e)); });\n      } catch(e){ if(outEl) outEl.textContent = 'Error generating roast'; }\n    }\n    var btn = document.getElementById('genRoast');\n    if (btn && !btn.getAttribute('data-wired')) {\n      btn.setAttribute('data-wired','1');\n      btn.addEventListener('click', function(ev){ if(ev && ev.preventDefault) ev.preventDefault(); gen(); });\n      btn.onclick = function(ev){ try { if(ev && ev.preventDefault) ev.preventDefault(); } catch(e) {} gen(); return false; };\n    }\n    try { window._genRoast = gen; } catch(e) {}\n    setTimeout(gen, 10);\n  } catch(e) { /* ignore */ }\n})();</script>\n`;
    const idx = out.lastIndexOf('</body>');
    if (idx !== -1) out = out.slice(0, idx) + script + out.slice(idx);
    else out += script;
    return out;
  } catch { return html; }
}
