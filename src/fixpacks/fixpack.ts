import type { Job, PageRun, Issue, AxeViolation } from '../jobs/types.js';

export interface FixAction {
  id: string;
  type: 'seo' | 'perf' | 'a11y' | 'flow' | 'general';
  pageUrl?: string;
  title: string;
  description: string;
  snippet?: string;
}

export interface FixPack {
  jobId: string;
  site: string;
  generatedAt: string;
  counts: { pages: number; issues: number };
  actions: FixAction[];
}

function shortId() { return Math.random().toString(36).slice(2, 10); }

function suggestTitleFromH1(p: PageRun): string | undefined {
  const h1 = p.meta?.h1?.trim();
  if (!h1) return undefined;
  const base = h1.replace(/\s+/g, ' ').slice(0, 60).trim();
  return base;
}

function addSeoActions(actions: FixAction[], pages: PageRun[]) {
  for (const p of pages) {
    const title = (p.meta?.title || '').trim();
    const desc = (p.meta?.description || '').trim();
    const h1 = (p.meta?.h1 || '').trim();
    if (!title || title.length < 15 || title.length > 65) {
      const suggested = suggestTitleFromH1(p) || 'Add a clear, benefit‑driven title';
      actions.push({
        id: shortId(), type: 'seo', pageUrl: p.url,
        title: 'Improve <title> tag',
        description: `Set a unique, descriptive title (~50–60 chars). Current length=${title ? title.length : 0}.` + (h1 ? ` Consider using H1 as a base: “${h1.slice(0,80)}”` : ''),
        snippet: `<title>${suggested}</title>`
      });
    }
    if (!desc || desc.length > 180) {
      actions.push({
        id: shortId(), type: 'seo', pageUrl: p.url,
        title: 'Add meta description',
        description: `Add a 120–160 char meta description with a clear value prop and CTA. Current ${desc ? 'length=' + desc.length : 'missing'}.`,
        snippet: `<meta name="description" content="Describe value in 140–160 characters with a soft CTA." />`
      });
    }
  }
}

function addPerfActions(actions: FixAction[], issues: Issue[]) {
  for (const i of issues) {
    if (i.type !== 'perf') continue;
    if (i.metric?.name === 'largest-contentful-paint') {
      actions.push({
        id: shortId(), type: 'perf', pageUrl: i.pageUrl,
        title: 'Reduce LCP (slow hero)',
        description: 'Inline critical CSS, preload hero image/font, defer non‑critical JS to lower LCP below 2500ms.',
        snippet: `<link rel="preload" as="image" href="/path/to/hero.jpg" imagesrcset="..." />\n<link rel="preload" as="font" href="/path/to/font.woff2" type="font/woff2" crossorigin>`
      });
    } else if (i.metric?.name === 'interactive') {
      actions.push({ id: shortId(), type: 'perf', pageUrl: i.pageUrl, title: 'Improve INP (interaction)', description: 'Break up long tasks (>50ms), defer analytics, use event delegation, avoid heavy synchronous work on input.' });
    } else if (i.metric?.name === 'cumulative-layout-shift') {
      actions.push({ id: shortId(), type: 'perf', pageUrl: i.pageUrl, title: 'Reduce CLS (layout shift)', description: 'Reserve image/ads slots with width/height, avoid injecting above‑the‑fold content, set aspect‑ratio on media.' });
    }
  }
}

function addA11yActions(actions: FixAction[], pages: PageRun[]) {
  for (const p of pages) {
    const v = p.axe?.violations || [];
    for (const viol of v as AxeViolation[]) {
      if ((viol.id || '').toLowerCase().includes('image') && viol.nodes && viol.nodes.length) {
        const target = viol.nodes[0]?.target?.[0] || 'img';
        actions.push({
          id: shortId(), type: 'a11y', pageUrl: p.url,
          title: 'Add alt text to images',
          description: `Provide meaningful alt text for images (selector ${target}).`,
          snippet: `<img src="..." alt="Describe image purpose, not just appearance" />`
        });
      }
      if ((viol.id || '').toLowerCase().includes('contrast')) {
        actions.push({ id: shortId(), type: 'a11y', pageUrl: p.url, title: 'Fix text contrast', description: 'Ensure text has contrast ≥ 4.5:1 against its background. Use theme tokens and test dark/light modes.' });
      }
      if ((viol.id || '').toLowerCase().includes('label')) {
        actions.push({ id: shortId(), type: 'a11y', pageUrl: p.url, title: 'Label form controls', description: 'Associate labels with inputs via for/id or aria‑labelledby; include helpful placeholder/aria‑describedby as needed.' });
      }
    }
  }
}

function addFlowActions(actions: FixAction[], issues: Issue[]) {
  for (const i of issues) {
    if (i.type !== 'flow') continue;
    actions.push({ id: shortId(), type: 'flow', title: 'Stabilize journey step', pageUrl: i.pageUrl, description: 'Reproduce failing step, stabilize selectors, handle errors gracefully, and add clear validation messages.' });
  }
}

export function buildFixPack(job: Job, pages: PageRun[], issues: Issue[]): FixPack {
  const actions: FixAction[] = [];
  addSeoActions(actions, pages);
  addPerfActions(actions, issues);
  addA11yActions(actions, pages);
  addFlowActions(actions, issues);
  // De‑dupe by (type + pageUrl + title)
  const seen = new Set<string>();
  const uniq: FixAction[] = [];
  for (const a of actions) {
    const key = [a.type, a.pageUrl || '', a.title].join('|');
    if (seen.has(key)) continue; seen.add(key); uniq.push(a);
  }
  return {
    jobId: job.id,
    site: job.url,
    generatedAt: new Date().toISOString(),
    counts: { pages: pages.length, issues: issues.length },
    actions: uniq
  };
}

export function fixPackToMarkdown(fp: FixPack): string {
  const lines: string[] = [];
  lines.push(`# Fix Pack – ${fp.site}`);
  lines.push('');
  lines.push(`Generated: ${fp.generatedAt}`);
  lines.push('');
  lines.push(`- Pages: ${fp.counts.pages}`);
  lines.push(`- Issues considered: ${fp.counts.issues}`);
  lines.push('');
  lines.push('## Actions');
  lines.push('');
  fp.actions.forEach((a, idx) => {
    lines.push(`### ${idx + 1}. ${a.title}`);
    if (a.pageUrl) lines.push(`- Page: ${a.pageUrl}`);
    lines.push(`- Type: ${a.type}`);
    lines.push(`- What to do: ${a.description}`);
    if (a.snippet) { lines.push('```html'); lines.push(a.snippet); lines.push('```'); }
    lines.push('');
  });
  return lines.join('\n');
}

