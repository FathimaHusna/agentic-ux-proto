# Agentic UX — Product Requirements Document (PRD)

## 1. Summary
Agentic UX turns a website scan into an executive‑ready storyboard that prioritizes the top fixes, shows evidence, and estimates business impact. It is action‑first: instead of raw scores, it outputs a concise plan with exports for Jira/CSV and optional code‑ready “PR Pack”.

## 2. Problem & Goals
- Problem: Most audits produce noisy scores and long reports. Non‑technical stakeholders struggle to translate them into a plan, and teams lose momentum.
- Goal: Produce a single, shareable artifact that answers “What should we fix next, why, and what’s the expected impact?”, with evidence and one‑click exports.

## 3. Users & Personas
- Business lead: Needs a plain‑English narrative, ROI snapshot, and a top‑5 list to align stakeholders quickly.
- UX/product manager: Needs a backlog export, impact/effort framing, and a 2‑week plan to sequence work.
- Developer: Needs concrete evidence, links, suggested fixes, and a “PR Pack” to accelerate changes.

## 4. Value Proposition
- Action‑first: Outputs a prioritized backlog and two‑week plan, not just scores.
- Evidence‑backed: Perf metrics, accessibility violations, journey outcomes, and SEO signals.
- Business‑friendly: Executive Storyboard with ROI and clear “Now vs Next”.
- Fast and private: Local prototype, small footprint, easy to share via a tunnel.

## 5. Scope (MVP)
- Input: URL (plus optional max depth and up to 3 competitor URLs).
- Crawl engine: fast, same‑origin BFS fetcher; extracts links + title/H1/meta.
- Perf/SEO: Lighthouse (selected audits) for the first pages.
- Accessibility: Pa11y (WCAG 2.0/2.1 AA) across the first pages.
- Journeys: Optional Puppeteer flows (visit/click/type/assert) with screenshots on failure.
- Synthesis: Prioritized issues (perf, a11y, seo, flow) with impact/effort scoring.
- Executive Storyboard: Top 5 fixes, business summary, ROI, evidence tables, journey gallery, exports.
- Exports: issues JSON/CSV, Fix Pack (JSON/Markdown), PR Pack (JSON/Markdown/patch), ROI JSON/Markdown, Summary JSON/Markdown, Roadmap JSON, Jira CSV.
- Run history: list by origin, diffs between runs, triage states per issue digest.

Out of scope (MVP): deep crawl of very large sites, complex auth flows, role‑based access, persistent DB/state beyond JSON artifacts, multi‑region scale.

## 6. UX Overview
Primary flow:
1) Paste site URL (+ competitors optional) and click Analyze.
2) Watch progress (SSE/polling), then open the report.
3) Review Top 5 fixes and ROI; export issues or Fix Pack; share link.
4) Use Impact/Effort and the 2‑week plan to decide “Now vs Next”.

Secondary flows:
- Triage: Toggle states on issues (accepted/wontfix/needs‑design) for continuity and diffs.
- Competitor bench: Compare first‑page metrics per competitor for positioning gaps.
- Roast Mode (technical view): Persona‑based critiques to help storytelling with stakeholders.
- Copy Coach: Title/meta suggestions via heuristic or optional LLM (Gemini).

## 7. Functional Requirements
- Create analysis jobs via `POST /api/analyze` and stream progress via `/api/job/:id/stream`.
- Generate and serve an HTML report via `/api/report/:id` with exports.
- Business‑only report is default (technical sections/exports are hidden in the shared report to reduce noise).
- Produce JSON/CSV artifacts for issues, roadmap, ROI, PR Pack, Fix Pack, and Jira import.
- Persist run snapshots and allow list/diff by origin.
- Optional LLM summaries when configured with `GEMINI_API_KEY`.

## 8. Non‑Functional Requirements
- Performance: Complete typical scans (depth <= 2, first 3 pages audited) in ~1–3 minutes.
- Reliability: Best‑effort writes; tolerant of missing dependencies (e.g., Lighthouse not installed).
- Privacy: Does not store secrets; artifacts live in local `runs/`. No exfiltration.
- Portability: Docker image with Chromium; simple systemd option for a VM.
- Simplicity: Minimal server with zero framework; small TypeScript codebase.

## 9. Prioritization & Roadmap
MVP (current):
- Crawl + perf + a11y + simple SEO, journeys with screenshots, synthesis, storyboard, exports, triage, diffs, bench, ROI, Summary/Roadmap.

VNext (near‑term):
- Progress UI with richer streaming; evidence tables in report; PDF export; better copy suggestions; per‑page detail view; advanced journey recorder.
- Persistence: swap in SQLite/Postgres for runs + triage; Redis queue for jobs.
- Auth: optional basic auth or GitHub OAuth for shared environments.

## 10. Success Metrics
- Time to insight: median time from “Analyze” to “shared storyboard link” (< 3 minutes).
- Adoption: number of shared report links per week; number of exports (CSV/Jira/Markdown).
- Impact proxy: % of issues marked “accepted” that are closed within 2 weeks.
- Quality: decrease in duplicate titles/long titles across pages; improvement in first‑page LCP and INP.

## 11. Risks & Mitigations
- Headless Chrome availability: Detect and degrade gracefully (skip perf/journeys if absent).
- Anti‑bot server rules: Extend crawler with real browser headers or rate limiting.
- Over‑indexing on heuristics: Provide clear labels and links to evidence; allow triage states.
- Report drift across versions: Inject wiring scripts into old HTML to keep key buttons working.

## 12. Dependencies & Assumptions
- Node 18+, local Chrome/Chromium for perf/journeys, Pa11y for a11y checks.
- Optional Gemini LLM for richer summaries.
- Docker image includes Chromium; Compose uses Cloudflare Tunnel for shareable links.

## 13. Open Questions
- Depth and page limits per plan? (config knobs per deployment)
- Auth model for shared demos? (basic vs OAuth)
- Persistence and quotas in multi‑tenant mode?
