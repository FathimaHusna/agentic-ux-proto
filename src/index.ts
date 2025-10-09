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
      enqueueJob(jobStore, job.id);
      return sendJSON(res, 202, { jobId: job.id });
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
      const prog = typeof job.progress === 'number' ? `${job.progress}%` : 'pending';
      return sendHTML(res, 202, `<h1>Report not ready</h1><p>Status: ${escapeHtml(job.status)} | Progress: ${escapeHtml(String(prog))}</p>`);
    }
    return sendHTML(res, 200, job.outputs.artifacts.reportHtml);
  }

  // Default: simple landing
  if (method === 'GET' && url.pathname === '/') {
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
            const r = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
            const j = await r.json();
            out.textContent = JSON.stringify(j, null, 2);
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
