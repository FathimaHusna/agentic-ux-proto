# Agentic UX – Executive Overview (for Business Users)

Agentic UX quickly shows where a website is helping or hurting customers, and what to do next. It produces a single Executive Storyboard to share with stakeholders: top fixes, evidence, a 2‑week plan, and an estimated impact.

What you get
- Executive Storyboard: top 5 fixes, a plain‑English summary, and quick exports
- Evidence: accessibility and performance tables, and journey screenshots if flows fail
- ROI snapshot: adjustable inputs (visitors, CVR, AOV) with uplift ranges
- Exports: Jira‑ready CSV, Fix Pack (what to change), PR Pack (example edits)

How to use
- Open the app, paste your site URL, optionally add up to 3 competitors, then Analyze
- Share the report link with stakeholders (works in any browser)
- Use the Impact/Effort matrix and Top 5 Fixes to decide “Now vs Next”

Sharing a public link (Docker Compose)
- Run `docker compose up --build -d`
- Get the public URL: `docker compose logs -f cloudflared` and copy the `https://...trycloudflare.com` link

What it doesn’t do (yet)
- Deep crawls of very large sites; advanced login flows out of the box; long‑term storage/roles

Why it’s different
- Action‑first (not just scores), business‑friendly narrative, evidence‑backed, fast and private

# Agentic UX – Rapid Prototype

Lightweight Node/TypeScript prototype to analyze a site and generate an executive storyboard (HTML) from real, pluggable engines. Includes a Tailwind‑powered landing page for a friendly, responsive entry point.

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
- Also accepts `{ competitors: string[] | string }` where string can be comma-separated URLs (max 3).
- `GET /api/job/:id` → job status + results snapshot.
- `GET /api/job/:id/stream` → SSE stream with `{ progress, stage, status }` events.
- `GET /api/report/:id` → HTML storyboard.
- `GET /api/issues/:id.json` → issues as JSON (backlog export).
- `GET /api/issues/:id.csv` → issues as CSV (import into Jira/Sheets).
- `GET /api/fixpack/:id.json` → generated Fix Pack (actions for SEO/Perf/A11y/Flow).
- `GET /api/fixpack/:id.md` → Fix Pack as Markdown (copy into tickets/proposals).
- `GET /api/roi/:id.json` → ROI estimate with optional query params: `monthlyVisitors`, `currentCVR`, `aov`.
- `GET /api/roi/:id.md` → ROI as Markdown business case.
- `GET /api/summary/:id.json[?llm=1]` → Business Summary (JSON). Add `?llm=1` to use Gemini.
- `GET /api/summary/:id.md[?llm=1]` → Business Summary (Markdown). Add `?llm=1` to use Gemini.
- `GET /api/roadmap/:id.json` → 2‑Week Plan (JSON).
- `GET /api/jira/:id.csv` → Jira CSV export (Tasks).
- `GET /api/jira/:id.json` → Jira items as JSON.
- `GET /api/runs[?origin=...]` → list recent runs (optionally filter by origin).
- `GET /api/run/:id` → run meta + job snapshot if in memory.
- `GET /api/diff/:a/:b` → diff issue digests between two runs (new/resolved/unchanged).
- `POST /api/triage` → body `{ digest, state }` with state in `accepted|wontfix|needs-design|null`.
- `GET /api/triage?digests=d1,d2,...` → returns mapping of triage states.
- `POST /api/triage/meta` → body `{ digest, state?, owner?, estimateHours?, notes? }`.
- `GET /api/triage/meta?digests=d1,d2,...` → returns mapping to triage metadata per digest.
- `GET /project[?origin=...]` → HTML page listing runs for a project (origin).
- `GET /api/roast/:id?personas=sassy,dev&intensity=2` → returns persona-based roast lines for a run.
- `GET /` → minimal UI form (URL + depth).

**Project Structure**
- `src/index.ts` – HTTP server and routing.
- `src/jobs/*` – in‑memory job store and runner.
- `src/agents/*` – real adapters: `crawl.http.ts`, `a11y.pa11y.ts`, `perf.lighthouse.ts`, `journeys.puppeteer.ts`.
- `src/synthesis/*` – prioritization + report HTML.
- `runs/` – artifacts per job (report, journey screenshots/logs).
 - `public/` – Tailwind landing page served at `/`.

**Install**
- Requirements: Node 18+; local Chrome/Chromium recommended.
- Install deps: `npm install`.

**Run**
- Start: `npm start` (defaults to port `8787`).
- UI: open `http://localhost:8787/`, submit URL + Max Depth.
- API example:
  - `curl -s -X POST http://localhost:8787/api/analyze -H 'Content-Type: application/json' -d '{"url":"https://example.com","maxDepth":2,"engines":{"crawler":"http","a11y":"pa11y"}}'`
  - `open http://localhost:8787/api/report/<jobId>`

**One-Click Link**
- You can auto-run via query params and get redirected to the progress/report page:
  - `http://localhost:8787/?url=https%3A%2F%2Fexample.com&maxDepth=2&crawler=http&a11y=pa11y`

**Public URL (quick demo)**
- Using Docker Compose, a Cloudflare Tunnel sidecar provides a shareable URL.
- Start: `docker compose up --build -d`
- Copy the printed `https://...trycloudflare.com` from: `docker compose logs -f cloudflared`

**Environment Variables**
- `PORT`: server port (default `8787`).
- `CHROME_PATH`: path to Chrome for Lighthouse (e.g., `/usr/bin/google-chrome`).
- `PUPPETEER_EXECUTABLE_PATH`: Chrome path for Puppeteer journeys (same as above).
- `FLOWS_PATH`: JSON file with journey flows (optional). If not set or invalid, a default “smoke” flow runs.
- `PUPPETEER_HEADLESS`: set to `false` to run journeys non‑headless (debug).
 - `GEMINI_API_KEY`: optional. If set, enables LLM‑generated Business Summary via Gemini (use `?llm=1`).
 - `SUMMARY_LLM_DEFAULT`: set to `true` to prefer LLM summary for `/api/summary/:id` by default.

Secrets management:
- Copy `.env.example` to `.env` and set values locally. `.env` is already in `.gitignore`.
- In Docker/CI/Prod, prefer setting these as environment variables rather than committing `.env`.

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

Recent additions:
- SEO heuristics (title/H1/meta description; duplicate titles).
- Accessibility overview table in report.
- Backlog export (JSON/CSV) from report.
- SSE progress stream + waiting page updates.
- Report filters (type/severity/page) and Impact/Effort matrix.
- Run history index + diffs, and triage states (click row to toggle).
- Diff badges in Top 5 (New/Unchanged).
- Competitor benchmarking (first page per competitor) with quick comparison table.
- Project runs page (`/project`) and print-friendly PDF via “Download PDF” button in the report.
- Roast Mode: persona-based, evidence-aware quips with honesty slider; API `GET /api/roast/:id`.
- Fix Pack v1: SEO titles/descriptions, LCP/INP/CLS improvements, A11y fixes; download JSON/Markdown from the report.
 - ROI v1: competitor gaps + revenue impact ranges; JSON/Markdown endpoints.
 - Business Summary + 2‑Week Plan (JSON/Markdown), with optional Gemini LLM for more natural narrative.

### Report Mode
- Business‑only by default: technical sections and debug/export links are hidden and not required for sharing or printing.
- Printing tip: when saving to PDF, disable "Headers and footers" to avoid page URL text on each page.

## Docs
- Product doc (PRD): docs/product/PRD.md
- Technical design + diagrams: docs/technical/TECH_DESIGN.md and docs/technical/architecture.mmd
- Draft article: docs/article/ARTICLE.md

## Deploy

### Option A: Docker (recommended)
This repo includes a production-ready `Dockerfile` using the Puppeteer image with Chromium built-in.

Build and run:

```bash
cd agentic-ux-proto
docker build -t agentic-ux .
docker run --rm -p 8787:8787 \
  -e PORT=8787 \
  -e FLOWS_PATH=/app/flows.json \
  -e CHROME_PATH=/usr/bin/chromium \
  -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  -v agentic_runs:/app/runs \
  agentic-ux
```

Or with Compose:

```bash
docker compose up --build
```

Open: `http://localhost:8787`

To expose publicly, run Cloudflare Tunnel locally: `cloudflared tunnel --url http://localhost:8787`

### Option B: Systemd on a VM

1) Install Node 18+ and Chrome/Chromium
2) Build: `npm ci && npm run build`
3) Install the service: see `deploy/systemd/README.md`
4) Start: `sudo systemctl enable --now agentic-ux`

### Option C: Local + Quick Tunnel (fastest dev demo)

```bash
npm ci
export CHROME_PATH=$(which google-chrome || which chromium)
export PUPPETEER_EXECUTABLE_PATH=$CHROME_PATH
export FLOWS_PATH=$PWD/flows.json
npm run build && npm run start:prod
# In another shell:
cloudflared tunnel --url http://localhost:8787
```

Share the https URL that Cloudflare prints.
