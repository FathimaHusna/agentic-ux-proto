# Agentic UX – Rapid Prototype

Lightweight Node/TypeScript prototype to analyze a site and generate an executive storyboard (HTML) from real, pluggable engines.

**What It Does**
- Paste a URL → creates a job and runs: crawl → a11y → perf → synthesis (+ optional journeys).
- Returns a prioritized backlog and an “Executive Storyboard” with evidence.

**Current Engines**
- Crawl: HTTP fetcher (same‑origin BFS), extracts links + Title/H1/Meta Description.
- Accessibility: Pa11y (WCAG 2.0/2.1 AA) against first pages.
- Performance/SEO: Lighthouse (perf category + selected audits) against first pages.
- Journeys: Puppeteer flows (visit/click/type/assert) with screenshots on failure.

**Endpoints**
- `POST /api/analyze` → `{ jobId }` (body: `{ url, maxDepth, engines? }`).
- `GET /api/job/:id` → job status + results snapshot.
- `GET /api/report/:id` → HTML storyboard.
- `GET /` → minimal UI form (URL + depth).

**Project Structure**
- `src/index.ts` – HTTP server and routing.
- `src/jobs/*` – in‑memory job store and runner.
- `src/agents/*` – real adapters: `crawl.http.ts`, `a11y.pa11y.ts`, `perf.lighthouse.ts`, `journeys.puppeteer.ts`.
- `src/synthesis/*` – prioritization + report HTML.
- `runs/` – artifacts per job (report, journey screenshots/logs).

**Install**
- Requirements: Node 18+; local Chrome/Chromium recommended.
- Install deps: `npm install`.

**Run**
- Start: `npm start` (defaults to port `8787`).
- UI: open `http://localhost:8787/`, submit URL + Max Depth.
- API example:
  - `curl -s -X POST http://localhost:8787/api/analyze -H 'Content-Type: application/json' -d '{"url":"https://example.com","maxDepth":2,"engines":{"crawler":"http","a11y":"pa11y"}}'`
  - `open http://localhost:8787/api/report/<jobId>`

**Environment Variables**
- `PORT`: server port (default `8787`).
- `CHROME_PATH`: path to Chrome for Lighthouse (e.g., `/usr/bin/google-chrome`).
- `PUPPETEER_EXECUTABLE_PATH`: Chrome path for Puppeteer journeys (same as above).
- `FLOWS_PATH`: JSON file with journey flows (optional). If not set or invalid, a default “smoke” flow runs.
- `PUPPETEER_HEADLESS`: set to `false` to run journeys non‑headless (debug).

**Artifacts**
- Report HTML: `runs/<jobId>/report.html` (also served at `/api/report/<jobId>`).
- Journey screenshots: `runs/<jobId>/journeys/*.png`.
- Journey logs/hints: `runs/<jobId>/journeys/error.log`, `results.json`.

**Troubleshooting**
- No Performance section: ensure Chrome is installed and, if needed, set `CHROME_PATH`.
- Journeys: “none”
  - Export `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome` (or your Chrome/Chromium path).
  - Provide `FLOWS_PATH` or rely on default smoke flow.
  - Check `runs/<jobId>/journeys/error.log` for launch errors.
- SEO/Copy empty for some sites: strict servers may block generic fetch. Use real browser headers if needed (HTTP crawler can be extended).

**Notes**
- In‑memory jobs; artifacts best‑effort written under `runs/`.
- Minimal code; no framework dependency for the server.

**Next Steps**
- Progress streaming (SSE/websockets) and richer UI.
- Persistence (SQLite/Postgres) and run diffs.
- Evidence sections: A11y table + Journey screenshots gallery.
