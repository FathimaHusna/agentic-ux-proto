import { Job, PageRun, Journey, Issue } from '../jobs/types.js';

export function buildStoryboardHtml(job: Job, pages: PageRun[], journeys: Journey[], issues: Issue[]): string {
  const top = issues.slice(0, 5);
  const hasPerf = pages.some(p => p.lhr && p.lhr.audits);
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

  const journeysHtml = (journeys && journeys.length)
    ? journeys
      .map(j => {
        const status = typeof j.failedAt === 'number' ? '❌ Failed' : '✅ Passed';
        const steps = j.steps
          .map((s, i) => `<li>${i + 1}. ${escapeHtml(s.action)} – ${s.ok ? 'ok' : 'fail'} (${s.t}ms)</li>`) 
          .join('');
        return `<h3>${escapeHtml(j.name)} — ${status}</h3><ol>${steps}</ol>`;
      })
      .join('')
    : '';

  const issuesHtml = top
    .map(i => `<li><strong>${escapeHtml(i.title)}</strong> — score ${i.score} — ${escapeHtml(i.evidence)}
      <br/><small>Type: ${i.type}${i.pageUrl ? ' | ' + escapeHtml(i.pageUrl) : ''}</small>
      <br/><small>Fix: ${i.fixSteps.map(escapeHtml).join('; ')}</small></li>`)
    .join('');

  const created = new Date(job.createdAt).toLocaleString();
  const engines = job.options?.engines || {} as any;
  const perfEngine = hasPerf ? 'lighthouse' : 'none';
  const journeysEngine = (journeys && journeys.length) ? 'puppeteer' : 'none';
  const enginesLine = `Crawler: ${engines.crawler || 'none'} | A11y: ${engines.a11y || 'none'} | Perf: ${perfEngine} | Journeys: ${journeysEngine}`;
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
    </style>
  </head>
  <body>
    <h1>Agentic UX – Executive Storyboard</h1>
    <p><strong>Site:</strong> ${escapeHtml(job.url)}<br/>
       <strong>Run:</strong> ${created}<br/>
       <strong>Engines:</strong> ${escapeHtml(enginesLine)}<br/>
       <strong>Summary:</strong> ${escapeHtml(job.summary || '')}</p>

    <div class="grid">
      <div class="card">
        <h2>Top 5 Fixes</h2>
        <ol>${issuesHtml}</ol>
      </div>
      ${hasPerf ? `<div class="card">
        <h2>Performance Metrics</h2>
        <table>
          <thead><tr><th>Page</th><th>LCP (ms)</th><th>INP (ms)</th><th>CLS</th></tr></thead>
          <tbody>${perf}</tbody>
        </table>
      </div>` : ''}
    </div>

    <div class="card" style="margin-top:16px;">
      <h2>SEO/Copy Signals</h2>
      <table>
        <thead><tr><th>Page</th><th>Title</th><th>H1</th><th>Meta Description</th></tr></thead>
        <tbody>${seoSignals}</tbody>
      </table>
    </div>

    ${journeysHtml ? `<h2>Journeys</h2>${journeysHtml}` : ''}
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
