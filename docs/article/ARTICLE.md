# Turn Website Friction Into a Two‑Week Action Plan: Meet Agentic UX

If you’ve ever stared at a Lighthouse score or a 100‑page audit and wondered “What do we actually ship next?”, you’re not alone. Teams need a clear narrative, not just numbers—and a plan they can act on this sprint.

Agentic UX flips the script: paste a URL, and in minutes you get an executive‑ready storyboard—Top 5 Fixes, evidence, an ROI snapshot, and a two‑week plan. It’s action‑first, business‑friendly, and backed by real checks for performance, accessibility, clarity, and key user flows.

## Why another tool?
Most tools stop at scores. Agentic UX produces a shareable narrative with a prioritized backlog and exports for Jira/CSV. It also generates a “Fix Pack” (concrete changes) and an optional “PR Pack” (draft code templates) to accelerate implementation. By default the report is business‑only—technical tables and tools can be enabled when needed.

## How it works
- Paste your site URL (optionally add up to 3 competitors) and click Analyze.
- The prototype crawls same‑origin pages, runs perf (Lighthouse), accessibility (Pa11y), and optional user journeys (Puppeteer).
- It synthesizes the top issues and renders a single Executive Storyboard with exports and an ROI snapshot.

What you see:
- Top 5 Fixes with clear “why this matters” and “what to do”.
- Evidence tables for performance/SEO signals and accessibility overview.
- Journey outcomes with screenshots if flows fail.
- ROI ranges you can tweak (visitors, CVR, AOV) with instant updates.
- Exports for Jira/Sheets and optional PR/Fix Packs.

## What makes it different
- Action‑first: Converts audits into a prioritized plan you can ship.
- Business‑friendly: One link to align stakeholders; print‑friendly.
- Evidence‑backed: Every recommendation is traceable to a metric, a rule, or a failing step.
- Honest mode: Optional “Roast” personas for candid critiques that land in meetings.

## Quick start (Docker Compose)
```bash
cd agentic-ux-proto
docker compose up --build -d
# Copy the https URL from:
docker compose logs -f cloudflared
```
Open the public link and paste your site URL. Share the report with your team.

Prefer local?
```bash
npm ci
export CHROME_PATH=$(which google-chrome || which chromium)
export PUPPETEER_EXECUTABLE_PATH=$CHROME_PATH
npm run build && npm start
open http://localhost:8787/
```

## A mini case study
Scanning a marketing site (depth 2) surfaced:
- Slow LCP on the hero; fix: preload hero image and inline critical CSS.
- Missing H1 and short titles across several pages.
- Accessibility violations concentrated in form labels.
- A checkout journey that fails on client‑side validation.

The two‑week plan grouped these into quick win tickets (perf/a11y) and one cross‑functional task (checkout). The business summary linked improvements to conversion uplift ranges for a simple revenue story.

## Roadmap
- Richer UI and PDF export, per‑page deep dives, better journey recorder.
- Persistence (SQLite/Postgres) and a real job queue (Redis) for scale.
- Optional auth for shared environments and a tighter default CORS policy.

## Wrap‑up
Agentic UX is a practical starting point for actionable UX audits. It’s small, fast, and focused on momentum. Scan your site, share the storyboard, and ship the top five.

Repo: ./
