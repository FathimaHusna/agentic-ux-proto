import type { Job, PageRun, Issue } from '../jobs/types.js';

export interface PRFile {
  path: string;
  content: string;
}
export interface PRPack {
  jobId: string;
  site: string;
  generatedAt: string;
  readme: string;
  files: PRFile[];
}

function slugFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.replace(/\/$/, '') || '/index';
    return (path === '/') ? 'index' : path.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'index';
  } catch { return 'page'; }
}

function metaSnippet(title?: string, description?: string): string {
  const t = title && title.trim() ? title.trim().slice(0, 65) : 'Add a clear, benefit‑driven title';
  const d = description && description.trim() ? description.trim().slice(0, 160) : 'Summarize the page value in ~140–160 characters with a gentle CTA.';
  return `  <title>${t}</title>\n  <meta name="description" content="${d}" />`;
}

function preloadSnippet(): string {
  return `  <!-- Preload hero image and key font (update href to real assets) -->\n  <link rel="preload" as="image" href="/assets/hero.jpg" imagesrcset="/assets/hero@2x.jpg 2x" />\n  <link rel="preload" as="font" href="/assets/brand.woff2" type="font/woff2" crossorigin />`;
}

function deferSnippet(): string {
  return `  <!-- Defer non‑critical scripts and run analytics when idle -->\n  <script>\n    window.addEventListener('load', function(){\n      if (window.requestIdleCallback) {\n        requestIdleCallback(function(){ /* init analytics */ });\n      } else {\n        setTimeout(function(){ /* init analytics */ }, 1500);\n      }\n    });\n  </script>`;
}

export function buildPRPack(job: Job, pages: PageRun[], issues: Issue[]): PRPack {
  const files: PRFile[] = [];
  const seen: Set<string> = new Set();
  for (const p of (pages || []).slice(0, 5)) {
    const slug = slugFromUrl(p.url);
    const head: string[] = [];
    head.push('  <!-- SEO: Title & Meta Description -->');
    head.push(metaSnippet(p.meta?.h1 || p.meta?.title, p.meta?.description));
    head.push('');
    head.push(preloadSnippet());
    head.push('');
    head.push(deferSnippet());
    const html = `<!-- Example template patch for ${p.url} -->\n<!doctype html>\n<html>\n<head>\n${head.join('\n')}\n</head>\n<body>\n  <!-- ... existing content ... -->\n</body>\n</html>\n`;
    const path = `prpack/pages/${slug}.html`; if (!seen.has(path)) { files.push({ path, content: html }); seen.add(path); }
  }

  // Add README with instructions
  const readme = `# PR Pack (Preview) – ${job.url}\n\nThis pack includes example edits to apply common quick wins:\n\n- SEO: set <title> and meta description\n- Performance: preload hero image and key font\n- Perf hygiene: defer non‑critical JS / run analytics when idle\n\nNotes:\n- Files are examples under \`prpack/\` – adapt them to your framework/templates before committing.\n- Review every change. This pack does not auto‑apply.\n- Re‑run Agentic UX after applying to measure impact (LCP/INP/CLS, a11y, journeys).\n\n## Suggested Review Checklist\n- [ ] Titles are unique (50–60 chars) and benefit‑driven\n- [ ] Meta descriptions are ~140–160 chars with a clear value prop\n- [ ] Preload points to real hero image & font assets (verify paths)\n- [ ] Non‑critical scripts are deferred; analytics initialized when idle\n- [ ] Key journeys still pass; consider adding tests for brittle selectors\n`;

  return { jobId: job.id, site: job.url, generatedAt: new Date().toISOString(), readme, files };
}

export function prpackToMarkdown(pk: PRPack): string {
  const lines: string[] = [];
  lines.push(`# PR Pack – ${pk.site}`);
  lines.push('');
  lines.push(pk.readme);
  lines.push('');
  lines.push('## Files');
  pk.files.forEach(f => { lines.push(`### ${f.path}`); lines.push('```html'); lines.push(f.content); lines.push('```'); lines.push(''); });
  return lines.join('\n');
}

export function prpackToUnifiedDiff(pk: PRPack): string {
  // Provide a unified diff style for each file as if creating new files under project root
  const chunks: string[] = [];
  for (const f of pk.files) {
    const hdr = `--- /dev/null\n+++ b/${f.path}`;
    const body = f.content.split('\n').map(l => `+${l}`).join('\n');
    chunks.push(`${hdr}\n@@\n${body}\n`);
  }
  // Include README
  const rHdr = `--- /dev/null\n+++ b/prpack/README.md`;
  const rBody = pk.readme.split('\n').map(l => `+${l}`).join('\n');
  chunks.push(`${rHdr}\n@@\n${rBody}\n`);
  return chunks.join('\n');
}

