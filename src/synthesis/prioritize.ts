import { Issue, Journey, PageRun } from '../jobs/types.js';
import { createId } from '../util/id.js';

function severityFromPerf(metric: string, value: number): number {
  if (metric === 'largest-contentful-paint') {
    if (value > 4000) return 5;
    if (value > 2500) return 4;
    return 2;
  }
  if (metric === 'interactive') {
    if (value > 400) return 4;
    if (value > 200) return 3;
    return 2;
  }
  if (metric === 'cumulative-layout-shift') {
    if (value > 0.25) return 4;
    if (value > 0.1) return 3;
    return 1;
  }
  return 2;
}

function effortHeuristic(type: string): number {
  switch (type) {
    case 'perf': return 2; // typical quick wins
    case 'a11y': return 2; // many fixes are localized
    case 'flow': return 3; // may require design/BE
    default: return 2;
  }
}

export function prioritize(pages: PageRun[], journeys: Journey[]): Issue[] {
  const issues: Issue[] = [];

  // Perf issues from LHR
  for (const p of pages) {
    const audits = p.lhr?.audits;
    if (audits) {
      for (const key of ['largest-contentful-paint', 'interactive', 'cumulative-layout-shift'] as const) {
        const a = audits[key];
        if (!a) continue;
        const sev = severityFromPerf(key, a.numericValue);
        if (sev >= 3) {
          const impact = key === 'largest-contentful-paint' ? 5 : key === 'interactive' ? 4 : 3;
          const effort = effortHeuristic('perf');
          const score = sev * impact - effort;
          const title = key === 'largest-contentful-paint' ? 'High LCP (slow hero)' : key === 'interactive' ? 'High INP (slow interactions)' : 'High CLS (layout shifts)';
          const fixSteps = key === 'largest-contentful-paint'
            ? ['Inline critical CSS', 'Preload hero image & font', 'Defer non-critical JS']
            : key === 'interactive'
            ? ['Reduce long tasks (>50ms)', 'Defer analytics until idle', 'Use event delegation']
            : ['Reserve image/ads slots', 'Avoid injecting content above-the-fold'];
          issues.push({
            id: createId(),
            type: 'perf',
            pageUrl: p.url,
            title,
            evidence: `${key}=${a.numericValue}`,
            metric: { name: key, value: a.numericValue },
            severity: sev,
            impact,
            effort,
            score,
            fixSteps
          });
        }
      }
    }
  }

  // Accessibility from axe
  for (const p of pages) {
    const v = p.axe?.violations || [];
    for (const viol of v) {
      const sev = viol.impact === 'critical' ? 5 : viol.impact === 'serious' ? 4 : 3;
      const impact = 4;
      const effort = effortHeuristic('a11y');
      const score = sev * impact - effort;
      issues.push({
        id: createId(),
        type: 'a11y',
        pageUrl: p.url,
        title: viol.id,
        evidence: `${viol.description} at ${viol.nodes[0]?.target?.[0] || 'unknown target'}`,
        ruleId: viol.id,
        wcag: viol.wcag,
        severity: sev,
        impact,
        effort,
        score,
        fixSteps: [
          viol.id === 'image-alt' ? 'Add meaningful alt text to images' : 'Fix contrast to meet 4.5:1',
          'Verify with axe + screen reader'
        ]
      });
    }
  }

  // Journey failures
  for (const j of journeys) {
    if (typeof j.failedAt === 'number') {
      const step = j.steps[j.failedAt];
      const sev = 5; // blocked flow
      const impact = 5; // high-impact user flow
      const effort = effortHeuristic('flow');
      const score = sev * impact - effort;
      issues.push({
        id: createId(),
        type: 'flow',
        title: `Journey failure: ${j.name}`,
        evidence: `Failed at step #${j.failedAt + 1}: ${step.action} (${step.error || 'unknown'})`,
        severity: sev,
        impact,
        effort,
        score,
        fixSteps: ['Reproduce failure', 'Check client-side validation', 'Handle server-side errors gracefully']
      });
    }
  }

  // Rank by score desc
  issues.sort((a, b) => b.score - a.score);
  return issues;
}

