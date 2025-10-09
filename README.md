# Agentic UX – Rapid Prototype

This is a lightweight, file-backed Node/TypeScript prototype for an “Agentic UX” service:

- Paste a URL → create an analysis job
- Orchestrator (stubbed) coordinates: crawl → audits → journeys → synthesis
- Returns a prioritized backlog and a simple executive storyboard (HTML)

Notes
- This prototype uses in-memory storage (with optional file writes under `runs/`).
- Engines are stubbed only (no Playwright/Lighthouse/axe-core). This keeps it runnable without extra installs during prototyping.
- Endpoints are implemented with Node’s built-in HTTP module (no framework dependency).

Endpoints
- `POST /api/analyze` → `{ jobId }`
- `GET /api/job/:id` → job status + results snapshot
- `GET /api/report/:id` → HTML storyboard (generated)

Project Structure
- `src/index.ts` – HTTP server and routing
- `src/jobs/*` – in-memory job store and runner
- `src/agents/*` – crawl/audit/journeys (stubs)
- `src/synthesis/*` – prioritization and report HTML
- `runs/` – optional artifacts written per job (best-effort; errors are caught)

Developer Flow
1) When ready post-prototype, you can wire real engines behind the existing agent interfaces (not included in this prototype):
   - Crawl: Playwright (headless), frontier BFS (depth/domain guards)
   - Performance/SEO: Lighthouse JSON via chrome-launcher
   - Accessibility: @axe-core/playwright (WCAG 2.2 mapping)
   - Journeys: Playwright flows (configurable selectors)
2) Keep synthesis deterministic; use LLM later for narrative polish.
3) Swap in real persistence (SQLite/Postgres/Azure SQL) if needed.

Install (optional, only for type-check/build)
```
npm install
npm run build
npm start
```

Environment options
- None required for the prototype. All engines are stubbed and settings are passed via the request payload (e.g., `maxDepth`).

Because this environment may be read-only and network-restricted, running the server isn’t required to review the code. The code is structured so you can drop it into your preferred runtime and iterate.

Next Steps
- Wire real engines behind the agent interfaces
- Add progress streaming (SSE/websocket)
- Add export to CSV/Jira/ADO
- Introduce Next.js UI when you’re ready for demos
