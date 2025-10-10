import http from 'node:http';
import { parse } from 'node:url';
import { JobStore } from './jobs/jobStore.js';
import { enqueueJob } from './jobs/jobRunner.js';

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
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return sendJSON(res, 400, { error: 'Invalid url' });
      }
      const job = jobStore.createJob(targetUrl, { maxDepth, engines: { crawler, a11y } });
      const reportUrl = `/api/report/${job.id}`;
      const jobUrl = `/api/job/${job.id}`;
      enqueueJob(jobStore, job.id);
      return sendJSON(res, 202, { jobId: job.id, reportUrl, jobUrl });
    } catch (e: any) {
      return sendJSON(res, 500, { error: e?.message || 'Server error' });
    }
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
        <p>Job <code>${escapeHtml(id)}</code> — Status: <strong>${escapeHtml(job.status)}</strong> | Progress: <strong id="p">${escapeHtml(String(prog))}</strong></p>
        <div class="bar"><span id="pb"></span></div>
        <p class="muted">This page will open automatically when ready.</p>
        <p><a id="joblink" href="/api/job/${escapeHtml(id)}" target="_blank">View job JSON</a> · <a href="/">Start another</a></p>
        <script>
          (function(){
            const id = ${JSON.stringify(id)};
            const pEl = document.getElementById('p');
            const pbEl = document.getElementById('pb');
            function setProg(n){ pEl.textContent = (typeof n === 'number') ? (n + '%') : 'pending'; if (typeof n === 'number') pbEl.style.width = n + '%'; }
            setProg(${progNum});
            async function poll(){
              try {
                const r = await fetch('/api/job/' + id, { cache: 'no-cache' });
                if (!r.ok) throw new Error('status');
                const j = await r.json();
                setProg(j && typeof j.progress === 'number' ? j.progress : undefined);
                if (j && j.status === 'done') { location.reload(); return; }
                if (j && j.status === 'error') { pEl.textContent = 'error'; return; }
              } catch (e) { /* ignore transient errors */ }
              setTimeout(poll, 1500);
            }
            poll();
          })();
        </script>
      </body></html>`;
      return sendHTML(res, 202, pendingHtml);
    }
    return sendHTML(res, 200, job.outputs.artifacts.reportHtml);
  }

  // Default: simple landing
  if (method === 'GET' && url.pathname === '/') {
    // If query params provided (url[, maxDepth, crawler, a11y]), auto-create job and redirect to report
    const q: any = url.query || {};
    const qUrl = q.url ? String(q.url).trim() : '';
    if (qUrl) {
      if (!/^https?:\/\//i.test(qUrl)) {
        return sendHTML(res, 400, '<h1>Invalid url</h1>');
      }
      const maxDepth = Math.max(1, Math.min(Number(q.maxDepth || 2), 3));
      const crawler = q.crawler === 'http' ? 'http' : undefined;
      const a11y = q.a11y === 'pa11y' ? 'pa11y' : undefined;
      const job = jobStore.createJob(qUrl, { maxDepth, engines: { crawler, a11y } });
      enqueueJob(jobStore, job.id);
      const loc = `/api/report/${job.id}`;
      res.writeHead(303, { Location: loc, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta http-equiv="refresh" content="0;url=${loc}"><a href="${loc}">Redirecting to report…</a>`);
    }
    return sendHTML(
      res,
      200,
      `<!doctype html><html><head><meta charset="utf-8"/><title>Agentic UX Proto</title></head>
      <body style="font-family:Arial, sans-serif; padding:24px">
        <h1>Agentic UX – Prototype</h1>
        <form id="f">
          <input name="url" placeholder="https://example.com" style="width:360px" required />
          <input name="maxDepth" type="number" min="1" max="3" value="2"/>
          <select name="crawler" title="Crawler engine">
            <option value="http" selected>HTTP crawl (no browser)</option>
          </select>
          <select name="a11y" title="Accessibility engine">
            <option value="pa11y" selected>Pa11y (real scan)</option>
          </select>
          <button type="submit">Analyze</button>
        </form>
        <pre id="out"></pre>
        <script>
          const f = document.getElementById('f');
          const out = document.getElementById('out');
          f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(f).entries());
            const payload = {
              url: data.url,
              maxDepth: Number(data.maxDepth || 2),
              engines: { crawler: data.crawler || 'http', a11y: data.a11y || 'pa11y' }
            };
            try {
              out.textContent = 'Creating job...';
              const r = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
              const j = await r.json();
              if (j && j.jobId) {
                const reportUrl = j.reportUrl || ('/api/report/' + j.jobId);
                out.textContent = 'Job created. Redirecting to report...\n' + JSON.stringify(j, null, 2);
                window.location.href = reportUrl;
              } else {
                out.textContent = 'Failed to create job: ' + JSON.stringify(j);
              }
            } catch (err) {
              out.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
            }
          });
        </script>
      </body></html>`
    );
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
