import type { Job, PageRun, Journey, Issue } from '../jobs/types.js';
import type { FixPack, FixAction } from '../fixpacks/fixpack.js';
import type { ROIResult } from './roi.js';
import { geminiGenerateText } from '../llm/gemini.js';

export interface SummaryTheme { title: string; bullets: string[] }
export interface SummaryResult {
  abstract: string;
  themes: SummaryTheme[];
  nextSteps: string[];
}

export interface RoadmapTask {
  title: string;
  owner: 'FE' | 'Design' | 'SEO' | 'QA';
  description: string;
  pageUrl?: string;
  estimateHours?: number;
  acceptance?: string[];
  digest?: string;
  state?: string;
}
export interface RoadmapResult {
  weeks: Array<{ label: string; tasks: RoadmapTask[]; capacity?: Record<string, number>; used?: Record<string, number> }>;
}

function pct(x: number): string { return (x * 100).toFixed(1) + '%'; }

function pickTop<T>(arr: T[], n: number): T[] { return (arr || []).slice(0, n); }

export function buildSummary(job: Job, pages: PageRun[], journeys: Journey[], issues: Issue[], fix: FixPack | null, roi: ROIResult | null): SummaryResult {
  const site = job.url;
  const lcp = pages?.[0]?.lhr?.audits?.['largest-contentful-paint']?.numericValue as number | undefined;
  const flowFail = (journeys || []).some(j => typeof j.failedAt === 'number');
  const a11yCount = pages.reduce((acc, p) => acc + ((p.axe?.violations || []).length), 0);
  const seoIssues = issues.filter(i => i.type === 'seo').length;
  const perfIssues = issues.filter(i => i.type === 'perf').length;
  const topImpact = roi ? `${pct(roi.aggregated.min)} – ${pct(roi.aggregated.max)}` : 'meaningful';

  const abstract = [
    `We analyzed ${site} across speed, accessibility, messaging, and key journeys.`,
    lcp && lcp > 2500 ? `The first screen loads slowly; speeding it up will improve first impression.` : '',
    flowFail ? `A key user journey failed; fixing it will immediately unblock users.` : '',
    a11yCount > 0 ? `We found accessibility gaps that reduce reach and task success.` : '',
    seoIssues > 0 ? `Page titles and descriptions can better communicate value to improve clicks.` : '',
    `Addressing the top opportunities is expected to lift conversion by ${topImpact}.`
  ].filter(Boolean).join(' ');

  const themes: SummaryTheme[] = [];
  themes.push({ title: 'Faster First Impression', bullets: [
    lcp && lcp > 2500 ? `Make the first screen load faster: inline critical CSS, preload hero image and font.` : 'Ensure hero and fonts load fast on first view.',
    perfIssues > 0 ? `Fix performance opportunities that slow down the page.` : 'Verify performance budgets and preloading.'
  ]});
  themes.push({ title: 'Clarity and Trust', bullets: [
    seoIssues > 0 ? `Clarify page titles and descriptions to communicate value and improve clicks.` : 'Keep titles/descriptions descriptive and unique.',
    a11yCount > 0 ? `Fix key accessibility issues (alt text, labels, contrast).` : 'Maintain accessible components and patterns.'
  ]});
  themes.push({ title: 'Unblock Journeys', bullets: [
    flowFail ? `Stabilize any failing steps and handle errors clearly.` : 'Add simple checks to guard key flows.',
    `Make forms forgiving: clear validation and helpful inline guidance.`
  ]});

  const nextSteps: string[] = [];
  const actions = fix?.actions || [];
  for (const a of pickTop(actions, 5)) {
    nextSteps.push(`${a.title}${a.pageUrl ? ` — ${a.pageUrl}` : ''}`);
  }
  if (!nextSteps.length) nextSteps.push('Review Top 5 issues and apply quick wins in the Fix Pack.');

  return { abstract, themes, nextSteps };
}

export function summaryToMarkdown(s: SummaryResult): string {
  const lines: string[] = [];
  lines.push('# Executive Summary');
  lines.push('');
  lines.push(s.abstract);
  lines.push('');
  lines.push('## Key Themes');
  for (const t of s.themes) {
    lines.push(`### ${t.title}`);
    for (const b of t.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('## Immediate Next Steps');
  for (const n of s.nextSteps) lines.push(`- ${n}`);
  return lines.join('\n');
}

export interface TriageMeta { state?: string; owner?: 'FE'|'Design'|'SEO'|'QA'; estimateHours?: number; notes?: string }
export interface Capacities { [owner: string]: number }

function defaultEstimateFor(type: string): number {
  switch (type) {
    case 'seo': return 2;
    case 'a11y': return 3;
    case 'perf': return 4;
    case 'flow': return 6;
    default: return 3;
  }
}
function ownerFor(type: string): 'FE'|'Design'|'SEO'|'QA' { return type === 'seo' ? 'SEO' : type === 'a11y' ? 'Design' : type === 'flow' ? 'FE' : 'FE'; }
function acceptanceFor(type: string): string[] {
  if (type === 'perf') return ['LCP < 2500ms on homepage', 'No blocking long tasks (>50ms) on input'];
  if (type === 'seo') return ['Unique title (50–60 chars)', 'Meta description (120–160 chars)'];
  if (type === 'a11y') return ['No axe violations on page', 'Buttons/links have accessible names'];
  if (type === 'flow') return ['Journey passes reliably 3x', 'Clear inline validation messages'];
  return [];
}

export function buildRoadmap(job: Job, issues: Issue[], fix: FixPack | null, triageMeta?: Record<string, TriageMeta>, capacities?: { week1?: Capacities; week2?: Capacities }): RoadmapResult {
  const actions = (fix?.actions || []).slice();
  // Score mapping from issues for rough prioritization
  const scoreMap = new Map<string, number>();
  for (const i of issues) {
    const k = `${i.type}|${i.pageUrl || ''}`;
    scoreMap.set(k, Math.max(scoreMap.get(k) || 0, i.score || 0));
  }
  // Build tasks with owner/estimate/acceptance and any triage overrides
  const tasks: RoadmapTask[] = actions.map((a) => {
    const owner = ownerFor(a.type);
    const est = defaultEstimateFor(a.type);
    const acc = acceptanceFor(a.type);
    // Attempt to find a matching issue for triage
    const key = `${a.type}|${a.pageUrl || ''}`;
    const score = scoreMap.get(key) || 0;
    const t: RoadmapTask = { title: a.title, owner, description: a.description, pageUrl: a.pageUrl, estimateHours: est, acceptance: acc };
    return { ...t, estimateHours: est };
  });
  // Sort by score desc (approx from issues) then by type priority
  tasks.sort((a, b) => {
    const ka = `${(a.description||'').slice(0,10)}|${a.pageUrl||''}`;
    const kb = `${(b.description||'').slice(0,10)}|${b.pageUrl||''}`;
    const sa = scoreMap.get(`${a.title.toLowerCase().includes('lcp')?'perf':''}|${a.pageUrl||''}`) || 0;
    const sb = scoreMap.get(`${b.title.toLowerCase().includes('lcp')?'perf':''}|${b.pageUrl||''}`) || 0;
    return sb - sa;
  });

  const capW1: Capacities = Object.assign({ FE: 8, Design: 4, SEO: 4, QA: 4 }, capacities?.week1 || {});
  const capW2: Capacities = Object.assign({ FE: 8, Design: 4, SEO: 4, QA: 4 }, capacities?.week2 || {});
  const usedW1: Capacities = { FE:0, Design:0, SEO:0, QA:0 };
  const usedW2: Capacities = { FE:0, Design:0, SEO:0, QA:0 };
  const week1: RoadmapTask[] = [];
  const week2: RoadmapTask[] = [];
  for (const t of tasks) {
    const est = t.estimateHours || 2;
    const o = t.owner;
    if (usedW1[o] + est <= capW1[o]) { week1.push(t); usedW1[o] += est; }
    else if (usedW2[o] + est <= capW2[o]) { week2.push(t); usedW2[o] += est; }
    else { /* overflow ignored for 2-week plan */ }
  }
  if (!week1.length) week1.push({ title: 'Apply Top 5 quick wins', owner: 'FE', description: 'Implement actions listed in Fix Pack and re-run analysis.', estimateHours: 4, acceptance: ['Retest: Top 5 addressed'] });
  if (!week2.length) week2.push({ title: 'Stabilize journeys and add tests', owner: 'QA', description: 'Repair flows and add coverage with robust selectors.', estimateHours: 6, acceptance: ['Smoke + key flows pass 3x'] });

  return { weeks: [ { label: 'Week 1', tasks: week1, capacity: capW1, used: usedW1 }, { label: 'Week 2', tasks: week2, capacity: capW2, used: usedW2 } ] };
}

export function roadmapToMarkdown(r: RoadmapResult): string {
  const lines: string[] = [];
  lines.push('# 2‑Week Implementation Plan');
  lines.push('');
  for (const w of r.weeks) {
    lines.push(`## ${w.label}`);
    for (const t of w.tasks) lines.push(`- [${t.owner}] ${t.title}${t.pageUrl ? ` — ${t.pageUrl}` : ''}: ${t.description}`);
    lines.push('');
  }
  lines.push('_Define done_: re-run analysis; expect lower LCP/INP, zero journey failures, improved a11y coverage.');
  return lines.join('\n');
}

export async function buildSummaryLLM(job: Job, pages: PageRun[], journeys: Journey[], issues: Issue[], fix: FixPack | null, roi: ROIResult | null): Promise<SummaryResult | null> {
  const schemaNote = `Respond in JSON with fields: {"abstract": string, "themes": [{"title": string, "bullets": string[]}], "nextSteps": string[]}`;
  const system = `You are an expert UX/product analyst. Write concise, business‑friendly summaries with specific recommendations. Avoid jargon. ${schemaNote}`;
  const input = JSON.stringify({
    site: job.url,
    roi,
    issues,
    pages: pages.map(p => ({ url: p.url, lcp: p?.lhr?.audits?.['largest-contentful-paint']?.numericValue, inp: p?.lhr?.audits?.['interactive']?.numericValue, cls: p?.lhr?.audits?.['cumulative-layout-shift']?.numericValue, a11y: (p.axe?.violations || []).length, title: p.meta?.title, h1: p.meta?.h1, description: p.meta?.description })),
    journeys
  });
  try {
    const resp = await geminiGenerateText({ system, input, json: true });
    const parsed = JSON.parse(resp);
    if (parsed && parsed.abstract && Array.isArray(parsed.themes) && Array.isArray(parsed.nextSteps)) return parsed as SummaryResult;
    return null;
  } catch {
    return null;
  }
}
