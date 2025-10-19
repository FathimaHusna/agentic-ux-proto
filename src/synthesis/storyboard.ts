import { Job, PageRun, Journey, Issue } from '../jobs/types.js';
import { issueDigest } from './digest.js';
import { buildROI } from './roi.js';
import { buildFixPack } from '../fixpacks/fixpack.js';
import { buildSummary, buildRoadmap } from './summary.js';

export function buildStoryboardHtml(
  job: Job,
  pages: PageRun[],
  journeys: Journey[],
  issues: Issue[],
  benchTargets?: Array<{ url: string; origin: string; page?: PageRun }>
): string {
  const SHOW_TECH = String(process.env.REPORT_INCLUDE_TECH || "").toLowerCase() === "true";
  const top = issues.slice(0, 5);
  const hasPerf = pages.some(p => p.lhr && p.lhr.audits);
  const hasA11y = pages.some(p => p.axe && Array.isArray(p.axe.violations) && p.axe.violations.length > 0);
  const hasIssues = (issues && issues.length > 0);
  const perf = hasPerf
    ? pages
      .map(p => {
        const lcp = p.lhr?.audits?.['largest-contentful-paint']?.numericValue ?? '-';
        const inp = p.lhr?.audits?.['interactive']?.numericValue ?? '-';
        const cls = p.lhr?.audits?.['cumulative-layout-shift']?.numericValue ?? '-';
        return `<tr><td>${escapeHtml(p.url)}</td><td>${lcp}</td><td>${inp}</td><td>${cls}</td></tr>`;
      })
      .join('')
    : '';

  const seoSignals = pages
    .map(p => {
      const title = p.meta?.title ? escapeHtml(p.meta.title) : '-';
      const h1 = p.meta?.h1 ? escapeHtml(p.meta.h1) : '-';
      const desc = p.meta?.description ? escapeHtml(p.meta.description) : '-';
      return `<tr><td>${escapeHtml(p.url)}</td><td>${title}</td><td>${h1}</td><td>${desc}</td></tr>`;
    })
    .join('');

  const a11yRows = pages
    .map(p => {
      const v = (p.axe?.violations || []) as any[];
      const total = v.length;
      const byImpact = v.reduce((acc, cur) => { const k = (cur.impact || 'unknown'); acc[k] = (acc[k]||0)+1; return acc; }, {} as Record<string, number>);
      // top 3 rules by frequency
      const byRule = new Map<string, number>();
      for (const viol of v) {
        const id = String(viol.id || 'unknown');
        byRule.set(id, (byRule.get(id) || 0) + 1);
      }
      const topRules = Array.from(byRule.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,c]) => `${escapeHtml(k)}×${c}`).join(', ');
      const impactStr = ['critical','serious','moderate','minor'].map(k => `${k}:${(byImpact as any)[k]||0}`).join(' ');
      return `<tr><td>${escapeHtml(p.url)}</td><td>${total}</td><td>${escapeHtml(impactStr)}</td><td>${escapeHtml(topRules || '-')}</td></tr>`;
    })
    .join('');

  const journeysHtml = (journeys && journeys.length)
    ? journeys
      .map(j => {
        const status = typeof j.failedAt === 'number' ? '❌ Failed' : '✅ Passed';
        const steps = j.steps
          .map((s, i) => {
            const img = s.screenshotPath ? `<div><img src="/${escapeHtml(s.screenshotPath)}" alt="step ${i+1} screenshot" style="max-width:420px;border:1px solid #eee;border-radius:4px"/></div>` : '';
            return `<li>${i + 1}. ${escapeHtml(s.action)} — ${s.ok ? 'ok' : '<strong>fail</strong>'} (${s.t}ms)${img}</li>`;
          })
          .join('');
        return `<div class="card"><h3>${escapeHtml(j.name)} — ${status}</h3><ol>${steps}</ol></div>`;
      })
      .join('')
    : '';

  const issuesHtml = top
    .map(i => {
      const d = issueDigest(i);
      const title = humanizeIssueTitle(i);
      const why = friendlyWhy(i);
      const how = friendlyHow(i);
      const where = i.pageUrl ? ` — <small>${escapeHtml(i.pageUrl)}</small>` : '';
      return `<li data-digest="${d}"><span class="badge" id="b-${d}">•</span> <strong>${escapeHtml(title)}</strong>${where}
      <br/><small>${escapeHtml(why)}</small>
      <br/><small><strong>What to do:</strong> ${escapeHtml(how)}</small></li>`;
    })
    .join('');

  const created = new Date(job.createdAt).toLocaleString();
  const engines = job.options?.engines || {} as any;
  const perfEngine = hasPerf ? 'lighthouse' : 'none';
  const journeysEngine = (journeys && journeys.length) ? 'puppeteer' : 'none';
  const enginesLine = `Scan: ${engines.crawler ? 'fast' : 'standard'} | Accessibility checks: ${engines.a11y ? 'on' : 'off'} | Speed checks: ${hasPerf ? 'on' : 'off'} | User journeys: ${journeys && journeys.length ? 'on' : 'off'}`;
  const roi = (() => { try { return buildROI(job as any, pages as any, issues as any, benchTargets as any, {}); } catch { return null; } })();
  const fix = (() => { try { return buildFixPack(job as any, pages as any, issues as any); } catch { return null; } })();
  const summary = (() => { try { return buildSummary(job as any, pages as any, journeys as any, issues as any, fix as any, roi as any); } catch { return null; } })();
  const roadmap = (() => { try { return buildRoadmap(job as any, issues as any, fix as any); } catch { return null; } })();
  // Diff vs previous run (same origin)
  let diffHtml = '';
  try {
    const origin = new URL(job.url).origin;
    // Note: listRuns is async; we can't await inside this sync function.
    // Workaround: embed a client-side fetch to compute diff counts.
    diffHtml = `<div class="card technical-only" style="margin-top:8px;"><h2>Changes vs Previous</h2>
      <p class="muted">Compared to the last scan for this site (if any): <span id="diff">loading…</span></p>
      <p><small><a id="diffLink" href="#" target="_blank" style="display:none;">Open JSON diff</a></small></p>
      <script>
        (async function(){
          try{
            const runsRes = await fetch('/api/runs?origin=${origin.replace(/"/g,'')}', { cache: 'no-cache' });
            const j = await runsRes.json();
            const runs = (j && Array.isArray(j.runs)) ? j.runs : [];
            const curId = ${JSON.stringify(job.id)};
            const ix = runs.findIndex(r => r.id === curId);
            const prev = runs.filter(r => r.id !== curId)[0];
            if (!prev) { document.getElementById('diff').textContent = 'no previous run'; return; }
            const diffRes = await fetch('/api/diff/' + prev.id + '/' + curId, { cache: 'no-cache' });
            const d = await diffRes.json();
            const span = document.getElementById('diff');
            span.textContent = '+' + (d.added?.length||0) + ' new, -' + (d.removed?.length||0) + ' resolved, •' + (d.unchanged?.length||0) + ' unchanged';
            const a = document.getElementById('diffLink'); a.href = '/api/diff/' + prev.id + '/' + curId; a.style.display = 'inline';
          }catch(e){ try{ document.getElementById('diff').textContent = 'unavailable'; }catch(_){} }
        })();
      </script>
    </div>`;
  } catch {}

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Agentic UX Storyboard – ${escapeHtml(job.url)}</title>
    <style>
      body { font-family: system-ui, Arial, sans-serif; margin: 24px; }
      h1 { margin-bottom: 0; }
      h2 { margin-top: 24px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; font-size: 14px; }
      th { background: #f5f5f5; text-align: left; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .card { border: 1px solid #eee; padding: 12px; border-radius: 8px; }
      .controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin: 8px 0; }
      .badge { display:inline-block; padding:2px 6px; border-radius:999px; font-size:12px; border:1px solid #ccc; }
      .muted { color:#666; }
      .technical-only { display: none; }
      .matrix { display:grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: minmax(80px, auto); gap:8px; }
      .cell { border:1px dashed #ddd; padding:8px; border-radius:6px; min-height:80px; position:relative; }
      .cell h4 { margin:0 0 6px 0; font-size:12px; color:#444; }
      .dot { display:inline-block; background:#4f46e5; color:#fff; border-radius:999px; padding:2px 6px; margin:2px; font-size:11px; white-space:nowrap; }
      .actions { margin: 8px 0; display:flex; gap: 8px; align-items:center; }
      .overview { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin: 12px 0; }
      .ov { border:1px solid #eee; border-radius:8px; padding:10px; background:#fff; }
      .ov h4 { margin:0 0 4px 0; font-size:12px; color:#475569; font-weight:600; }
      .ov .val { font-size:18px; font-weight:600; color:#0f172a; }
      .chip { display:inline-block; padding:2px 6px; border-radius:999px; font-size:12px; margin-left:6px; }
      .good { background:#e8f5e9; color:#166534; border:1px solid #a7f3d0; }
      .warn { background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; }
      .bad  { background:#fef2f2; color:#991b1b; border:1px solid #fecaca; }
      .na   { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
      @media print {
        .controls, .actions { display: none !important; }
        a { color: black; text-decoration: none; }
        .card { break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <h1>Agentic UX – Executive Storyboard</h1>
    <p><strong>Site:</strong> ${escapeHtml(job.url)}<br/>
       <strong>Run:</strong> ${created}<br/>
       <span class="technical-only"><strong>Scan details:</strong> ${escapeHtml(enginesLine)}<br/></span>
       <strong>Summary:</strong> ${escapeHtml(job.summary || '')}</p>
    <div class="actions">
      <a class="badge" href="/project?origin=${escapeHtml(new URL(job.url).origin)}" target="_blank">View Past Scans</a>
      <button onclick="window.print()">Download PDF</button>
      
    </div>
    ${diffHtml}

    ${(() => {
      try {
        const lcp = pages?.[0]?.lhr?.audits?.['largest-contentful-paint']?.numericValue as number | undefined;
        const a11yCount = pages.reduce((acc, p) => acc + ((p.axe?.violations || []).length), 0);
        const seoIssues = (issues || []).filter(i => i.type === 'seo').length;
        const flowFail = (journeys || []).some(j => typeof j.failedAt === 'number');
        function secs(ms?: number){ return (typeof ms === 'number') ? (ms/1000).toFixed(1) + 's' : '–'; }
        function chip(lbl: string){ return `<span class="chip ${lbl}">${lbl==='good'?'Good':lbl==='warn'?'OK':lbl==='bad'?'Needs work':'N/A'}</span>`; }
        const speedLbl = (typeof lcp === 'number') ? (lcp < 2500 ? 'good' : (lcp < 4000 ? 'warn' : 'bad')) : 'na';
        const a11yLbl = (a11yCount === 0 ? 'good' : 'bad');
        const seoLbl = (seoIssues > 0 ? 'warn' : 'good');
        const flowLbl = (flowFail ? 'bad' : 'good');
        return `<div class="overview business-only">
          <div class="ov"><h4>Speed (first screen)</h4><div class="val">${secs(lcp)} ${chip(speedLbl)}</div></div>
          <div class="ov"><h4>Clarity (titles/descriptions)</h4><div class="val">${seoIssues > 0 ? (seoIssues + ' fix(es)') : 'Looks good'} ${chip(seoLbl)}</div></div>
          <div class="ov"><h4>Key steps</h4><div class="val">${flowFail ? 'Issue found' : 'Passed'} ${chip(flowLbl)}</div></div>
          <div class="ov"><h4>Accessibility</h4><div class="val">${a11yCount > 0 ? (a11yCount + ' issues') : 'No issues'} ${chip(a11yLbl)}</div></div>
        </div>`;
      } catch { return ''; }
    })()}

    <div class="grid">
      <div class="card business-only">
        <h2>Business Summary</h2>
        ${summary ? `<p>${escapeHtml(summary.abstract)}</p>
          <ul>${summary.themes.map(t => `<li><strong>${escapeHtml(t.title)}:</strong> ${t.bullets.map(escapeHtml).join(' · ')}</li>`).join('')}</ul>
          <p class="technical-only"><small><a href="/api/summary/${escapeHtml(job.id)}.json" target="_blank">Summary JSON</a> · <a href="/api/summary/${escapeHtml(job.id)}.md" target="_blank">Summary Markdown</a></small></p>` : '<p class="muted">Summary unavailable.</p>'}
      </div>
      <div class="card business-only">
        <h2>Top 5 Fixes</h2>
        <ol>${issuesHtml}</ol>
        <p class="technical-only"><small>Export findings: <a href="/api/issues/${escapeHtml(job.id)}.json" target="_blank">Download (JSON)</a> · <a href="/api/issues/${escapeHtml(job.id)}.csv" target="_blank">Download (CSV)</a></small></p>
        <p class="technical-only"><small>Action Plan: <a href="/api/fixpack/${escapeHtml(job.id)}.json" target="_blank">Download (JSON)</a> · <a href="/api/fixpack/${escapeHtml(job.id)}.md" target="_blank">View (Markdown)</a></small></p>
        <p class="technical-only"><small>Draft code changes (optional): <a href="/api/prpack/${escapeHtml(job.id)}.json" target="_blank">JSON</a> · <a href="/api/prpack/${escapeHtml(job.id)}.md" target="_blank">Markdown</a> · <a href="/api/prpack/${escapeHtml(job.id)}.patch" target="_blank">Patch</a></small></p>
        <p class="technical-only"><small>2‑Week Plan: <a href="/api/roadmap/${escapeHtml(job.id)}.json" target="_blank">Download (JSON)</a> · Jira export: <a href="/api/jira/${escapeHtml(job.id)}.csv" target="_blank">CSV</a> · <a href="/api/jira/${escapeHtml(job.id)}.json" target="_blank">JSON</a></small></p>
        <p class="technical-only"><small>Title/Meta suggestions: <a href="/api/copy/${escapeHtml(job.id)}.json" target="_blank">View</a> · <a href="/api/copy/${escapeHtml(job.id)}.json?llm=1" target="_blank">Use AI</a></small></p>
      </div>
      <div class="card business-only">
        <h2>Business Case (ROI)</h2>
        ${roi ? `<p>Monthly revenue (current): <strong id="roiBase">$${Math.round(roi.baseline.monthlyRevenue).toLocaleString()}</strong><br/>
          Estimated conversion uplift: <strong id="roiUplift">${(roi.aggregated.min*100).toFixed(1)}% – ${(roi.aggregated.max*100).toFixed(1)}%</strong><br/>
          Estimated revenue impact (monthly): <strong id="roiImpact">$${Math.round(roi.impact.monthlyRevenueMin).toLocaleString()} – $${Math.round(roi.impact.monthlyRevenueMax).toLocaleString()}</strong></p>
          <div class="controls">
            <details>
              <summary>Adjust assumptions</summary>
              <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <label>Visitors <input id="roiVisitors" type="number" min="100" step="100" value="${roi.baseline.monthlyVisitors}"></label>
                <label>Conversion rate (%) <input id="roiCVR" type="number" min="0" max="100" step="0.1" value="${(roi.baseline.currentCVR*100).toFixed(1)}"></label>
                <label>AOV <input id="roiAOV" type="number" min="1" step="1" value="${roi.baseline.aov}"></label>
                <button id="roiUpdate" type="button">Update</button>
                <small class="technical-only"><a href="/api/roi/${escapeHtml(job.id)}.json" target="_blank">ROI JSON</a> · <a href="/api/roi/${escapeHtml(job.id)}.md" target="_blank">ROI Markdown</a></small>
              </div>
            </details>
          </div>` : '<p class="muted">ROI unavailable.</p>'}
      </div>
      <div class="card business-only">
        <h2>Accessibility Check</h2>
        ${buildA11yRollupHtml(pages)}
      </div>
      <div class="card technical-only">
        <h2>Feedback Mode</h2>
        <div class="controls">
          <label><input type="checkbox" name="persona" value="sassy" checked/> Sassy Designer</label>
          <label><input type="checkbox" name="persona" value="dev"/> Grumpy Dev</label>
          <label><input type="checkbox" name="persona" value="coach"/> Conversion Coach</label>
          <label><input type="checkbox" name="persona" value="genz"/> Gen Z Critic</label>
          <label><input type="checkbox" name="persona" value="seo"/> SEO Shark</label>
          <label><input type="checkbox" name="persona" value="corp"/> Corporate Consultant</label>
        </div>
        <div class="controls">
          <label>Honesty <input id="honesty" type="range" min="1" max="3" value="2"/></label>
          <button id="genRoast" type="button">Generate Roast</button>
          <button id="copyRoast">Copy</button>
        </div>
        <div id="roastOut" class="muted">Choose personas and click Generate.</div>
      </div>
      ${hasPerf ? `<div class="card technical-only">
        <h2>Performance Metrics</h2>
        <table>
          <thead><tr><th>Page</th><th>Page load (ms)</th><th>Interaction delay (ms)</th><th>Layout shift</th></tr></thead>
          <tbody>${perf}</tbody>
        </table>
      </div>` : ''}
    </div>

    <script>
      (function(){
        try {
          if (typeof window !== 'undefined') {
            var w = window;
            if (w['__roastInit']) return;
            w['__roastInit'] = true;
          }
        } catch (e) { /* ignore */ }
        var roastOut = document.getElementById('roastOut');
        async function generateRoast(){
          try {
            var checked = Array.prototype.slice.call(document.querySelectorAll('input[name="persona"]:checked'));
            var ps = checked.map(function(el){ return el.value; }).join(',');
            var honestyEl = document.getElementById('honesty');
            var honesty = (honestyEl && (honestyEl).value) ? (honestyEl).value : 2;
            if (roastOut) roastOut.textContent = 'Generating…';
            var r = await fetch('/api/roast/${escapeHtml(job.id)}?personas=' + encodeURIComponent(ps || 'sassy') + '&intensity=' + honesty, { cache: 'no-cache' });
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            var j = await r.json();
            var blocks = (j.roasts || []).map(function(b){
              var title = (b.persona === 'sassy' ? 'Sassy Designer' : b.persona === 'dev' ? 'Grumpy Dev' : b.persona === 'coach' ? 'Conversion Coach' : b.persona === 'genz' ? 'Gen Z Critic' : b.persona === 'seo' ? 'SEO Shark' : 'Corporate Consultant');
              var header = '<h3 style="margin:8px 0">' + title + '</h3>';
              var lines = '<ul>' + (b.lines || []).map(function(l){ return '<li>' + String(l).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }) + '</li>'; }).join('') + '</ul>';
              return '<div class="card">' + header + lines + '</div>';
            }).join('');
            if (roastOut) roastOut.innerHTML = blocks || '<em>No roast generated.</em>';
          } catch (e) {
            if (roastOut) roastOut.textContent = 'Error generating roast' + (e && e.message ? (': ' + e.message) : '');
          }
        }
        // Fallback: expose generator globally for inline click if needed
        try { (window['_genRoast'] = generateRoast); } catch (e) {}
        var genBtn = document.getElementById('genRoast');
        if (genBtn) genBtn.addEventListener('click', function(ev){ ev.preventDefault(); generateRoast(); });
        var copyBtn = document.getElementById('copyRoast');
        if (copyBtn) copyBtn.addEventListener('click', function(){ try { var txt = Array.prototype.slice.call((roastOut||document).querySelectorAll('li')).map(function(li){ return '- ' + (li.textContent||''); }).join('\n'); navigator.clipboard.writeText(txt); } catch (e) {} });
        // Auto-generate a default roast on load
        try { setTimeout(function(){ generateRoast(); }, 10); } catch (e) {}
      })();
    </script>

    <script>
      (function(){
        // ROI update
        var btn = document.getElementById('roiUpdate');
        if (btn) btn.addEventListener('click', async function(){
          try{
            var vEl = document.getElementById('roiVisitors');
            var cEl = document.getElementById('roiCVR');
            var aEl = document.getElementById('roiAOV');
            var v = Number((vEl && (vEl as HTMLInputElement).value) || 0);
            var cPerc = Number((cEl && (cEl as HTMLInputElement).value) || 0);
            var c = cPerc / 100;
            var a = Number((aEl && (aEl as HTMLInputElement).value) || 0);
            var r = await fetch('/api/roi/${escapeHtml(job.id)}.json?monthlyVisitors='+encodeURIComponent(String(v))+'&currentCVR='+encodeURIComponent(String(c))+'&aov='+encodeURIComponent(String(a)), { cache:'no-cache' });
            if (!r.ok) throw new Error('HTTP '+r.status);
            var j = await r.json();
            var baseEl = document.getElementById('roiBase');
            var upEl = document.getElementById('roiUplift');
            var impEl = document.getElementById('roiImpact');
            if (baseEl) baseEl.textContent = '$'+Math.round(j.baseline.monthlyRevenue).toLocaleString();
            if (upEl) upEl.textContent = (j.aggregated.min*100).toFixed(1)+'% – '+(j.aggregated.max*100).toFixed(1)+'%';
            if (impEl) impEl.textContent = '$'+Math.round(j.impact.monthlyRevenueMin).toLocaleString()+' – $'+Math.round(j.impact.monthlyRevenueMax).toLocaleString();
          }catch(e){ alert('Failed to update ROI'); }
        });
      })();
    </script>

    <div class="card technical-only" style="margin-top:16px;">
      <h2>SEO/Copy Signals</h2>
      <table>
        <thead><tr><th>Page</th><th>Title</th><th>H1</th><th>Meta Description</th></tr></thead>
        <tbody>${seoSignals}</tbody>
      </table>
    </div>

    ${hasA11y ? `<div class="card technical-only" style="margin-top:16px;">
      <h2>Accessibility Details</h2>
      <table>
        <thead><tr><th>Page</th><th>Issues</th><th>By Impact</th><th>Top Rules</th></tr></thead>
        <tbody>${a11yRows}</tbody>
      </table>
      <p><small>Tip: Drill into selectors using your accessibility tooling (axe/Pa11y).</small></p>
    </div>` : ''}

    ${benchTargets && benchTargets.length ? `<div class="card technical-only" style="margin-top:16px;">
      <h2>Comparison</h2>
      <table>
        <thead><tr><th>Site</th><th>Page load (ms)</th><th>Interaction delay (ms)</th><th>Layout shift</th><th>Accessibility issues</th><th>Title</th></tr></thead>
        <tbody>
          ${(function(){
            const rows: string[] = [];
            const base = (pages && pages[0]) || null;
            function met(p?: any, k?: string){ return (p && p.lhr && p.lhr.audits && p.lhr.audits[k||''] && p.lhr.audits[k||''].numericValue) ?? '-'; }
            function av(p?: any){ return (p && p.axe && Array.isArray(p.axe.violations)) ? p.axe.violations.length : 0; }
            if (base) {
              const lcp = met(base, 'largest-contentful-paint');
              const inp = met(base, 'interactive');
              const cls = met(base, 'cumulative-layout-shift');
              const a11y = av(base);
              const title = base.meta && base.meta.title ? base.meta.title : '';
              rows.push(`<tr><td><strong>This site</strong></td><td>${lcp}</td><td>${inp}</td><td>${cls}</td><td>${a11y}</td><td>${escapeHtml(title)}</td></tr>`);
            }
            for (const t of (benchTargets || [])){
              const p = t.page;
              const lcp = met(p, 'largest-contentful-paint');
              const inp = met(p, 'interactive');
              const cls = met(p, 'cumulative-layout-shift');
              const a11y = av(p);
              const title = p && p.meta && p.meta.title ? p.meta.title : '';
              rows.push(`<tr><td><a href="${escapeHtml(t.url)}" target="_blank">${escapeHtml(t.origin)}</a></td><td>${lcp}</td><td>${inp}</td><td>${cls}</td><td>${a11y}</td><td>${escapeHtml(title)}</td></tr>`);
            }
            return rows.join('');
          })()}
        </tbody>
      </table>
      <p class="muted">Benchmarks scan the first page of each competitor for quick signals.</p>
    </div>` : ''}

    ${hasIssues ? `<div class="card technical-only" style="margin-top:16px;">
      <h2>Full Findings (for teams)</h2>
      <div class="controls">
        <label>Type <select id="f-type"><option value="">All</option><option value="perf">Performance</option><option value="a11y">Accessibility</option><option value="seo">SEO</option><option value="flow">Journey</option></select></label>
        <label>Minimum priority <select id="f-sev"><option value="0">Any</option><option value="3">≥3</option><option value="4">≥4</option><option value="5">=5</option></select></label>
        <label>Page <select id="f-page"><option value="">All</option>${pages.map(p=>`<option value="${escapeHtml(p.url)}">${escapeHtml(p.url)}</option>`).join('')}</select></label>
      </div>
      <table id="issues">
        <thead><tr><th>Type</th><th>Priority</th><th>Severity</th><th>Impact</th><th>Effort</th><th>Page</th><th>Title</th><th>Evidence</th></tr></thead>
        <tbody>
          ${issues.map(i => {
            const d = issueDigest(i);
            return `<tr data-type="${i.type}" data-sev="${i.severity}" data-impact="${i.impact}" data-effort="${i.effort}" data-page="${escapeHtml(i.pageUrl || '')}" data-digest="${d}">
            <td><span class="badge">${i.type}</span></td>
            <td>${i.score}</td>
            <td>${i.severity}</td>
            <td>${i.impact}</td>
            <td>${i.effort}</td>
            <td>${i.pageUrl ? `<a href="${escapeHtml(i.pageUrl)}" target="_blank">link</a>` : '-'}</td>
            <td>${escapeHtml(humanizeIssueTitle(i))}</td>
            <td class="muted">${escapeHtml(i.evidence)}</td>
          </tr>`;}).join('')}
        </tbody>
      </table>
      <p class="muted">Tip: Click a row to mark status (accepted → won’t fix → needs design → none).</p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h2>2‑Week Plan</h2>
      ${roadmap ? `<div>
        ${roadmap.weeks.map(w => `<p><strong>${escapeHtml(w.label)}</strong><br/>${w.tasks.map(t => friendlyPlanTitle(t.title)).join(' · ')}</p>`).join('')}
        <p class="technical-only"><small><a href="/api/roadmap/${escapeHtml(job.id)}.json" target="_blank">Roadmap JSON</a></small></p>
      </div>` : '<p class="muted">Plan unavailable.</p>'}
    </div>

    <div class="card technical-only" style="margin-top:16px;">
      <h2>Impact vs Effort Matrix</h2>
      <div class="matrix" id="matrix">
        <div class="cell" data-cell="high-low"><h4>Quick Wins (High Impact, Low Effort)</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="high-med"><h4>High Impact, Medium Effort</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="high-high"><h4>Strategic (High Impact, High Effort)</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="med-low"><h4>Medium Impact, Low Effort</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="med-med"><h4>Balanced</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="med-high"><h4>Consider</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="low-low"><h4>Nice to Have</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="low-med"><h4>Lower Priority</h4><div class="bucket"></div></div>
        <div class="cell" data-cell="low-high"><h4>Defer</h4><div class="bucket"></div></div>
      </div>
      <p class="muted">Placement is based on numeric impact (1–5) and effort (1–5), collapsed to low/med/high buckets.</p>
    </div>` : ''}

    ${journeysHtml ? `<div class="card technical-only" style="margin-top:16px;">
      <h2>Journeys</h2>
      <p><small>Artifacts: <a href="/runs/${escapeHtml(job.id)}/journeys/results.json" target="_blank">results.json</a> · <a href="/runs/${escapeHtml(job.id)}/journeys/error.log" target="_blank">error.log</a></small></p>
      ${journeysHtml}
    </div>` : ''}
    <div class="card technical-only" style="margin-top:16px;">
      <h2>Journey Tools</h2>
      <p><small>Recorder: open the console on your site and run <code>fetch('/api/journeys/recorder.js').then(r=>r.text()).then(eval)</code>. Interact, then run <code>window.__uxDump()</code> to print a flow JSON (start with a <code>visit</code> step).</small></p>
      <p><small>Suggest Selector API: <code>POST /api/journeys/suggest</code> body <code>{url, selector}</code> → returns better candidates (CSS/XPath).</small></p>
      <p><small>Ad-hoc Runner: <code>POST /api/journeys/run</code> body <code>{ flow: { name, steps[] } }</code> → runs once, returns failure hints + selector suggestions.</small></p>
      <p><small>Comparison JSON: <a href="/api/bench/${escapeHtml(job.id)}.json" target="_blank">/api/bench/${escapeHtml(job.id)}.json</a></small></p>
    </div>
    ${hasIssues ? `<script>
      (function(){
        // Roast Mode
        const roastOut = document.getElementById('roastOut');
        async function generateRoast(){
          const ps = Array.from(document.querySelectorAll('input[name="persona"]:checked')).map(el => el.value).join(',');
          const honesty = document.getElementById('honesty').value;
          roastOut.textContent = 'Generating…';
          try {
            const r = await fetch('/api/roast/${escapeHtml(job.id)}?personas=' + encodeURIComponent(ps || 'sassy') + '&intensity=' + honesty, { cache: 'no-cache' });
            const j = await r.json();
            const blocks = (j.roasts || []).map(function(b){
              const header = '<h3 style="margin:8px 0">' + (
                b.persona === 'sassy' ? 'Sassy Designer' :
                b.persona === 'dev' ? 'Grumpy Dev' :
                b.persona === 'coach' ? 'Conversion Coach' :
                b.persona === 'genz' ? 'Gen Z Critic' :
                b.persona === 'seo' ? 'SEO Shark' : 'Corporate Consultant'
              ) + '</h3>';
              const lines = '<ul>' + (b.lines || []).map(l => '<li>' + l.replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }) + '</li>').join('') + '</ul>';
              return '<div class="card">' + header + lines + '</div>';
            }).join('');
            roastOut.innerHTML = blocks || '<em>No roast generated.</em>';
          } catch (e) {
            roastOut.textContent = 'Error generating roast';
          }
        }
        document.getElementById('genRoast').addEventListener('click', function(ev){ ev.preventDefault(); generateRoast(); });
        document.getElementById('copyRoast').addEventListener('click', function(){
          try {
            const txt = Array.from(roastOut.querySelectorAll('li')).map(li => '- ' + li.textContent).join('\n');
            navigator.clipboard.writeText(txt);
          } catch {}
        });
        // end Roast Mode
        const typeSel = document.getElementById('f-type');
        const sevSel = document.getElementById('f-sev');
        const pageSel = document.getElementById('f-page');
        const tbody = document.querySelector('#issues tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const digests = rows.map(r => r.getAttribute('data-digest')).filter(Boolean);
        function bucket(v){ if (v<=2) return 'low'; if (v===3) return 'med'; return 'high'; }
        const TRIAGE_ORDER = [null, 'accepted', 'wontfix', 'needs-design'];
        const TRIAGE_NEXT = { 'accepted':'wontfix', 'wontfix':'needs-design', 'needs-design': null };
        function setRowTriage(r, state){
          r.setAttribute('data-triage', state||'');
          r.style.opacity = state==='wontfix' ? 0.6 : 1;
        }
        async function loadTriage(){
          try{
            if (!digests.length) return;
            const mRes = await fetch('/api/triage?digests=' + encodeURIComponent(digests.join(',')));
            const map = await mRes.json();
            rows.forEach(r => { const d = r.getAttribute('data-digest'); setRowTriage(r, map[d] || null); });
          }catch{}
        }
        function applyFilters(){
          const t = (typeSel.value||'').trim();
          const s = parseInt(sevSel.value||'0',10);
          const p = (pageSel.value||'').trim();
          rows.forEach(r=>{
            const okType = !t || r.getAttribute('data-type')===t;
            const okSev = (parseInt(r.getAttribute('data-sev')||'0',10) >= s);
            const okPage = !p || r.getAttribute('data-page')===p;
            (okType && okSev && okPage) ? (r.style.display='') : (r.style.display='none');
          });
          renderMatrix();
        }
        function renderMatrix(){
          const cells = document.querySelectorAll('.cell .bucket');
          cells.forEach(c => c.innerHTML='');
          rows.forEach(r=>{
            if (r.style.display==='none') return;
            const imp = parseInt(r.getAttribute('data-impact')||'0',10);
            const eff = parseInt(r.getAttribute('data-effort')||'0',10);
            const cellKey = bucket(imp)+'-'+bucket(eff);
            const cell = document.querySelector('.cell[data-cell="'+cellKey+'"] .bucket');
            if (cell) {
              const title = r.children[6].textContent || '';
              const badge = document.createElement('span');
              badge.className = 'dot';
              badge.textContent = (r.getAttribute('data-type')||'') + ' • ' + title.slice(0,24);
              badge.title = title + ' | Sev ' + (r.getAttribute('data-sev')||'') + ', Impact ' + imp + ', Effort ' + eff;
              cell.appendChild(badge);
            }
          });
        }
        async function cycleTriage(r){
          const cur = r.getAttribute('data-triage') || null;
          const next = TRIAGE_NEXT[cur] ?? 'accepted';
          try{
            const d = r.getAttribute('data-digest');
            await fetch('/api/triage', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ digest: d, state: next }) });
            setRowTriage(r, next);
          }catch{}
        }
        rows.forEach(r => {
          r.style.cursor = 'pointer';
          r.addEventListener('click', () => cycleTriage(r));
        });
        typeSel.addEventListener('change', applyFilters);
        sevSel.addEventListener('change', applyFilters);
        pageSel.addEventListener('change', applyFilters);
        loadTriage().then(applyFilters);
        // Diff badges for Top 5
        (async function(){
          try{
            const runsRes = await fetch('/api/runs?origin=${escapeHtml(new URL(job.url).origin)}', { cache: 'no-cache' });
            const rj = await runsRes.json();
            const runs = (rj && Array.isArray(rj.runs)) ? rj.runs : [];
            const curId = ${JSON.stringify(job.id)};
            const prev = runs.filter(r => r.id !== curId)[0];
            if (!prev) return;
            const diffRes = await fetch('/api/diff/' + prev.id + '/' + curId, { cache: 'no-cache' });
            const d = await diffRes.json();
            const added = new Set(d.added || []);
            const unchanged = new Set(d.unchanged || []);
            document.querySelectorAll('ol > li[data-digest]').forEach(li => {
              const dig = li.getAttribute('data-digest');
              const badge = li.querySelector('.badge');
              if (!badge) return;
              if (added.has(dig)) { badge.textContent = 'New'; badge.style.background = '#16a34a'; badge.style.color = '#fff'; badge.style.borderColor = '#16a34a'; }
              else if (unchanged.has(dig)) { badge.textContent = 'Unchanged'; badge.style.background = '#6b7280'; badge.style.color = '#fff'; badge.style.borderColor = '#6b7280'; }
            });
          } catch {}
        })();
      })();
    </script>` : ''}
  </body>
  </html>`;
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildA11yRollupHtml(pages: PageRun[]): string {
  try {
    type Group = { title: string; count: number; examples: string[] };
    const map = new Map<string, Group>();
    function push(title: string, example?: string){
      const key = title;
      const g = map.get(key) || { title, count: 0, examples: [] };
      g.count++;
      if (example && g.examples.length < 3) g.examples.push(example);
      map.set(key, g);
    }
    for (const p of pages) {
      const v = p.axe?.violations || [] as any[];
      for (const viol of v) {
        const desc = String(viol.description || '');
        const target = (viol.nodes && viol.nodes[0] && viol.nodes[0].target && viol.nodes[0].target[0]) ? String(viol.nodes[0].target[0]) : '';
        if (/Duplicate id attribute value/i.test(desc)) {
          const m = desc.match(/Duplicate id attribute value\s+\"([^\"]+)\"/i);
          push('Duplicate id attributes', m ? `id="${m[1]}"` : target);
        } else if (/insufficient contrast/i.test(desc)) {
          push('Insufficient color contrast', target);
        } else if (/html element should have a lang/i.test(desc)) {
          push('Set page language (html lang)', 'html');
        } else if (/does not have a name available/i.test(desc) && /button/i.test(viol.id || '')) {
          push('Button lacks accessible name', target);
        } else if (/should be labelled/i.test(desc) || /textarea element does not have a name/i.test(desc)) {
          push('Form field missing label/name', target);
        } else {
          push((viol.id || 'a11y issue'), target);
        }
      }
    }
    const rows = Array.from(map.values()).sort((a,b) => b.count - a.count).slice(0, 6)
      .map(g => `<tr><td>${escapeHtml(g.title)}</td><td>${g.count}</td><td>${escapeHtml(g.examples.join(', ') || '-')}</td></tr>`)
      .join('');
    return rows ? `<table><thead><tr><th>Issue</th><th>Count</th><th>Examples</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Tip: Fix template-level issues (e.g., duplicate ids, contrast) once to resolve many instances.</p>` : '<p class="muted">No accessibility issues detected.</p>';
  } catch {
    return '<p class="muted">Roll‑up unavailable.</p>';
  }
}

function humanizeIssueTitle(i: Issue): string {
  if (i.type === 'a11y') {
    const id = (i.ruleId || i.title || '').toLowerCase();
    const ev = (i.evidence || '').toLowerCase();
    if (id.includes('h57')) return 'Set page language (html lang)';
    if (id.includes('button.name')) return 'Button lacks accessible name';
    if (id.includes('a.nocontent')) return 'Link has no visible text';
    if (id.includes('f77') || ev.includes('duplicate id')) return 'Duplicate id attributes';
    if (id.includes('g18') || id.includes('g145') || (i.title||'').toLowerCase().includes('contrast')) return 'Insufficient color contrast';
  }
  if (i.type === 'perf') {
    if (i.metric?.name === 'largest-contentful-paint') return 'First screen is slow to load';
    if (i.metric?.name === 'interactive') return 'Slow to respond to clicks/typing';
    if (i.metric?.name === 'cumulative-layout-shift') return 'Page moves while loading';
  }
  if (i.type === 'seo') {
    const t = (i.title||'').toLowerCase();
    if (t.includes('missing <title>')) return 'Add a descriptive title tag';
    if (t.includes('missing meta description')) return 'Add a clear meta description (~155 chars)';
    if (t.includes('short title')) return 'Short page title';
    if (t.includes('long meta description')) return 'Trim meta description (~155 chars)';
  }
  return i.title;
}

function friendlyPlanTitle(title: string): string {
  try {
    let t = title || '';
    t = t.replace(/^Reduce LCP.*$/i, 'Speed up first screen');
    t = t.replace(/^Improve\s*<title>\s*tag$/i, 'Clarify page title');
    t = t.replace(/^Stabilize journeys and add tests$/i, 'Make key steps reliable');
    // generic cleanup of any remaining jargon
    t = t.replace(/\bLCP\b/gi, 'first screen');
    return t;
  } catch { return title; }
}

function friendlyWhy(i: Issue): string {
  try {
    if (i.type === 'perf') {
      const m = i.metric?.name || '';
      if (m === 'largest-contentful-paint') return 'First impression feels slow. Faster hero improves engagement.';
      if (m === 'interactive') return 'The page is slow to respond to clicks and typing.';
      if (m === 'cumulative-layout-shift') return 'Content moves while loading, which causes mis‑clicks and frustration.';
      return 'Faster pages keep users engaged and reduce drop‑off.';
    }
    if (i.type === 'a11y') {
      const t = (i.title||'').toLowerCase();
      if (t.includes('contrast')) return 'Low contrast text is hard to read and excludes users.';
      if (t.includes('label') || t.includes('name')) return 'Unlabeled buttons or fields block keyboard and screen reader users.';
      return 'Accessibility issues reduce reach and trust.';
    }
    if (i.type === 'seo') {
      const t = (i.title||'').toLowerCase();
      if (t.includes('title')) return 'Unclear titles hurt clicks from search results.';
      if (t.includes('description')) return 'Missing descriptions make results less compelling to click.';
      return 'Clear titles and descriptions improve discovery and clicks.';
    }
    if (i.type === 'flow') return 'Broken steps stop users from completing key tasks.';
    return 'Fixing this reduces friction and improves conversion.';
  } catch { return 'Improves user experience and conversion.'; }
}

function friendlyHow(i: Issue): string {
  try {
    if (Array.isArray(i.fixSteps) && i.fixSteps.length) {
      let s = i.fixSteps.join('; ');
      s = s.replace(/Inline critical CSS/gi, 'Load essential styles first');
      s = s.replace(/Preload hero image\s*&\s*font/gi, 'Load the first picture and font early');
      s = s.replace(/Preload hero image/gi, 'Load the first picture early');
      s = s.replace(/Defer non[- ]critical JS/gi, 'Delay non‑essential code');
      s = s.replace(/Add a ~155 char meta description/gi, 'Add a short description (~155 chars)');
      return s.length > 180 ? (s.slice(0, 177) + '…') : s;
    }
    if (i.type === 'perf') {
      const m = i.metric?.name || '';
      if (m === 'largest-contentful-paint') return 'Preload hero image and key fonts; inline critical CSS; defer non‑essential scripts.';
      if (m === 'interactive') return 'Reduce long tasks; defer non‑critical scripts; keep input handlers light.';
      if (m === 'cumulative-layout-shift') return 'Reserve space for images/fonts; avoid late‑loading banners; set dimensions.';
      return 'Trim and defer scripts; preload critical assets.';
    }
    if (i.type === 'a11y') return 'Add clear labels, improve text contrast, and ensure buttons/links have names.';
    if (i.type === 'seo') return 'Set a descriptive title (50–60 chars) and a clear meta description (~155 chars).';
    if (i.type === 'flow') return 'Stabilize selectors and handle errors; add a simple automated test.';
    return 'Apply the recommended change and re‑scan.';
  } catch { return 'Apply the recommended change and re‑scan.'; }
}
