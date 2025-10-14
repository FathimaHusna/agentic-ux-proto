import type { Job, PageRun, Issue } from '../jobs/types.js';

export interface ROIParams {
  monthlyVisitors?: number; // e.g., 50000
  currentCVR?: number;      // 0.02 = 2%
  aov?: number;             // average order value, e.g., 100
}

export interface UpliftComponent {
  key: 'perf_lcp' | 'perf_inp' | 'perf_cls' | 'a11y' | 'flow' | 'seo_meta';
  label: string;
  min: number; // fractional, e.g., 0.03
  max: number; // fractional
  rationale: string;
}

export interface CompetitorGap {
  origin: string;
  url: string;
  lcp?: number | '-';
  inp?: number | '-';
  cls?: number | '-';
  a11y?: number; // violations count
}

export interface ROIResult {
  site: string;
  jobId: string;
  assumptions: Required<ROIParams>;
  baseline: { monthlyRevenue: number; monthlyVisitors: number; currentCVR: number; aov: number };
  components: UpliftComponent[];
  aggregated: { min: number; max: number; method: 'independent_caps_50' };
  impact: { monthlyRevenueMin: number; monthlyRevenueMax: number };
  competitorGaps: CompetitorGap[];
}

function num(x: any): number | undefined { const n = Number(x); return isFinite(n) ? n : undefined; }

function getAudit(p: any, key: string): number | undefined {
  const v = p?.lhr?.audits?.[key]?.numericValue;
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function getA11yCount(p: any): number { return Array.isArray(p?.axe?.violations) ? p.axe.violations.length : 0; }

export function buildROI(job: Job, pages: PageRun[], issues: Issue[], benchTargets?: Array<{ url: string; origin: string; page?: PageRun }>, params?: ROIParams): ROIResult {
  const assumptions: Required<ROIParams> = {
    monthlyVisitors: params?.monthlyVisitors && params.monthlyVisitors > 0 ? params.monthlyVisitors : 50000,
    currentCVR: params?.currentCVR && params.currentCVR > 0 && params.currentCVR < 1 ? params.currentCVR : 0.02,
    aov: params?.aov && params.aov > 0 ? params.aov : 100
  };
  const baselineRevenue = assumptions.monthlyVisitors * assumptions.currentCVR * assumptions.aov;

  // Performance metrics from first site page as proxy
  const base = pages && pages[0];
  const lcp = base ? getAudit(base as any, 'largest-contentful-paint') : undefined;
  const inp = base ? getAudit(base as any, 'interactive') : undefined;
  const cls = base ? getAudit(base as any, 'cumulative-layout-shift') : undefined;

  const comps: UpliftComponent[] = [];
  // Perf heuristics: conservative min/max uplift ranges
  if (typeof lcp === 'number') {
    if (lcp > 4000) comps.push({ key: 'perf_lcp', label: 'Reduce LCP (slow hero)', min: 0.07, max: 0.20, rationale: `LCP ${Math.round(lcp)}ms → target < 2500ms` });
    else if (lcp > 2500) comps.push({ key: 'perf_lcp', label: 'Reduce LCP (slow hero)', min: 0.03, max: 0.12, rationale: `LCP ${Math.round(lcp)}ms → target < 2500ms` });
  }
  if (typeof inp === 'number' && inp > 200) {
    const range = inp > 400 ? { min: 0.04, max: 0.12 } : { min: 0.02, max: 0.06 };
    comps.push({ key: 'perf_inp', label: 'Improve INP (interaction)', ...range, rationale: `INP ${Math.round(inp)}ms → target < 200ms` });
  }
  if (typeof cls === 'number' && cls > 0.1) {
    const range = cls > 0.25 ? { min: 0.02, max: 0.06 } : { min: 0.01, max: 0.03 };
    comps.push({ key: 'perf_cls', label: 'Reduce CLS (layout shift)', ...range, rationale: `CLS ${cls.toFixed(2)} → target < 0.1` });
  }
  // Accessibility: widening reach + task success
  const hasA11y = (pages || []).some(p => getA11yCount(p) > 0);
  if (hasA11y) comps.push({ key: 'a11y', label: 'Fix key accessibility issues', min: 0.01, max: 0.03, rationale: 'Improved access and task completion' });
  // Flow failures: unblock funnels
  const hasFlow = (issues || []).some(i => i.type === 'flow');
  if (hasFlow) comps.push({ key: 'flow', label: 'Stabilize failing user flows', min: 0.05, max: 0.15, rationale: 'Remove blockers and friction' });
  // SEO meta: title/description impact CTR (traffic). We include as separate component; not compounded with CVR.
  const hasSeo = (issues || []).some(i => i.type === 'seo');
  if (hasSeo) comps.push({ key: 'seo_meta', label: 'Improve title/meta descriptions (CTR)', min: 0.02, max: 0.05, rationale: 'Higher CTR from SERPs; traffic effect' });

  // Aggregate conversion uplift: 1 - Π (1 - range), capped at 50%
  function combine(parts: UpliftComponent[], sel: (c: UpliftComponent) => number): number {
    const convParts = parts.filter(c => c.key !== 'seo_meta');
    const prod = convParts.reduce((acc, c) => acc * (1 - sel(c)), 1);
    const val = 1 - prod;
    return Math.min(val, 0.5);
  }
  const aggMin = combine(comps, c => c.min);
  const aggMax = combine(comps, c => c.max);

  const revenueMin = baselineRevenue * aggMin;
  const revenueMax = baselineRevenue * aggMax;

  // Competitor gaps table
  const competitorGaps: CompetitorGap[] = [];
  for (const t of (benchTargets || [])) {
    const p = t.page as any;
    const clcp = getAudit(p, 'largest-contentful-paint');
    const cinp = getAudit(p, 'interactive');
    const ccls = getAudit(p, 'cumulative-layout-shift');
    const ca11y = getA11yCount(p);
    competitorGaps.push({ origin: t.origin, url: t.url, lcp: typeof clcp === 'number' ? Math.round(clcp) : '-', inp: typeof cinp === 'number' ? Math.round(cinp) : '-', cls: typeof ccls === 'number' ? Number(ccls.toFixed(2)) : '-', a11y: ca11y });
  }

  return {
    site: job.url,
    jobId: job.id,
    assumptions: assumptions,
    baseline: { monthlyRevenue: baselineRevenue, monthlyVisitors: assumptions.monthlyVisitors, currentCVR: assumptions.currentCVR, aov: assumptions.aov },
    components: comps,
    aggregated: { min: aggMin, max: aggMax, method: 'independent_caps_50' },
    impact: { monthlyRevenueMin: revenueMin, monthlyRevenueMax: revenueMax },
    competitorGaps
  };
}

export function roiToMarkdown(roi: ROIResult): string {
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const money = (x: number) => '$' + Math.round(x).toLocaleString();
  const lines: string[] = [];
  lines.push(`# Business Case – ${roi.site}`);
  lines.push('');
  lines.push(`Baseline (per month): Visitors ${roi.baseline.monthlyVisitors.toLocaleString()}, CVR ${(roi.baseline.currentCVR*100).toFixed(1)}%, AOV $${roi.baseline.aov}. Revenue ${money(roi.baseline.monthlyRevenue)}.`);
  lines.push('');
  lines.push('## Estimated Uplift (Conversion)');
  roi.components.filter(c => c.key !== 'seo_meta').forEach(c => {
    lines.push(`- ${c.label}: ${pct(c.min)} – ${pct(c.max)} (${c.rationale})`);
  });
  lines.push(`- Aggregated (capped): ${pct(roi.aggregated.min)} – ${pct(roi.aggregated.max)}`);
  lines.push('');
  lines.push(`Estimated revenue impact per month: ${money(roi.impact.monthlyRevenueMin)} – ${money(roi.impact.monthlyRevenueMax)}.`);
  lines.push('');
  lines.push('## Traffic Opportunity (SEO Meta)');
  const seo = roi.components.find(c => c.key === 'seo_meta');
  if (seo) lines.push(`- Improve title/meta description: CTR uplift ${pct(seo.min)} – ${pct(seo.max)} (affects traffic)`);
  else lines.push('- No clear SEO meta opportunities identified.');
  lines.push('');
  lines.push('## Competitor Bench (first page)');
  lines.push('| Site | LCP (ms) | INP (ms) | CLS | A11y Violations |');
  lines.push('|---|---:|---:|---:|---:|');
  roi.competitorGaps.forEach(g => { lines.push(`| ${g.origin} | ${g.lcp ?? '-'} | ${g.inp ?? '-'} | ${g.cls ?? '-'} | ${g.a11y ?? 0} |`); });
  lines.push('');
  lines.push('_Estimates are directional; effects overlap and are capped to avoid double counting._');
  return lines.join('\n');
}

