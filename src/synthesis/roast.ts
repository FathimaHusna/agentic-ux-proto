import type { Issue, PageRun, Journey } from '../jobs/types.js';
import { issueDigest } from './digest.js';
import { geminiGenerateText } from '../llm/gemini.js';

export type PersonaId = 'sassy' | 'dev' | 'coach' | 'genz' | 'seo' | 'corp';

export interface RoastOptions {
  intensity?: 1 | 2 | 3; // 1 = mild, 2 = medium, 3 = savage
  personas?: PersonaId[];
  limitPerPersona?: number;
}

export interface PersonaRoast {
  persona: PersonaId;
  lines: string[];
}

function first<T>(arr: T[] | undefined | null): T | undefined {
  return (arr && arr.length) ? arr[0] : undefined;
}

function pickIntensity(intensity: 1|2|3, mild: string, med: string, savage: string): string {
  return intensity === 1 ? mild : intensity === 2 ? med : savage;
}

function parseSelectorFromEvidence(evidence?: string): string | undefined {
  if (!evidence) return undefined;
  const m = evidence.match(/ at ([^\s].*)$/);
  return m ? m[1] : undefined;
}

function stepFromFlowEvidence(evidence?: string): string | undefined {
  if (!evidence) return undefined;
  const m = evidence.match(/Failed at step #(\d+)/i);
  return m ? m[1] : undefined;
}

function friendlyMetric(name?: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('largest-contentful-paint')) return 'page load';
  if (n.includes('interactive')) return 'interaction delay';
  if (n.includes('cumulative-layout-shift')) return 'layout shift';
  return 'performance';
}

function buildLine(persona: PersonaId, i: Issue, intensity: 1|2|3): string {
  const t = i.type;
  if (t === 'perf') {
    const name = friendlyMetric(i.metric?.name);
    const v = i.metric?.value;
    if (persona === 'sassy') {
      const adj = pickIntensity(intensity, 'sleepy', 'sluggish', 'comatose');
      return `Sassy Designer: ${name} feels ${adj} (${v}ms). Speeding up the first screen will help.`;
    }
    if (persona === 'dev') {
      return `Grumpy Dev: ${name}=${v}ms. Inline critical CSS; defer non‑essentials; trim long tasks.`;
    }
    if (persona === 'coach') {
      return `Conversion Coach: ${name}=${v}ms. Faster first screens lift conversion.`;
    }
    if (persona === 'genz') {
      const adj = pickIntensity(intensity, 'kinda mid', 'giving lag', 'giving dial-up vibes');
      return `Gen Z Critic: Bestie, this ${name} is ${adj} (${v}ms). Yikes.`;
    }
    if (persona === 'seo') {
      return `SEO Shark: ${name}=${v}ms. Slow pages bleed rankings and clicks.`;
    }
    if (persona === 'corp') {
      return `Corporate Consultant: Recommend a phased initiative to reduce ${name} via critical‑path optimization.`;
    }
  }
  if (t === 'a11y') {
    const sel = parseSelectorFromEvidence(i.evidence) || '';
    const friendly = humanizeA11y(i);
    if (persona === 'sassy') {
      const adj = pickIntensity(intensity, 'awkward', 'messy', 'tragic');
      return `Sassy Designer: ${friendly}${sel ? ' at '+sel : ''}. Accessibility is ${adj}—fix it.`;
    }
    if (persona === 'dev') {
      return `Grumpy Dev: ${friendly}${sel ? ' at '+sel : ''}. Ship the fix.`;
    }
    if (persona === 'coach') {
      return `Conversion Coach: ${friendly}${sel ? ' at '+sel : ''}. Fix improves reach and task success.`;
    }
    if (persona === 'genz') {
      const adj = pickIntensity(intensity, 'iffy', 'not it', 'a crime');
      return `Gen Z Critic: ${friendly}${sel ? ' at '+sel : ''}? That’s ${adj}.`;
    }
    if (persona === 'seo') {
      return `SEO Shark: ${friendly}${sel ? ' at '+sel : ''}. A11y and SEO swim together—fix it.`;
    }
    if (persona === 'corp') {
      return `Corporate Consultant: Prioritize remediation of ${friendly}${sel ? ' at '+sel : ''} to mitigate compliance risk.`;
    }
  }
  if (t === 'seo') {
    const title = (i.title || '').toLowerCase();
    const which = title.includes('title') ? 'title' : title.includes('h1') ? 'H1' : title.includes('meta') ? 'meta description' : 'SEO signal';
    if (persona === 'sassy') {
      const adj = pickIntensity(intensity, 'meh', 'basic', 'embarrassing');
      return `Sassy Designer: ${which} is ${adj}. Google’s not a mind reader—say something useful.`;
    }
    if (persona === 'dev') {
      return `Grumpy Dev: Missing/weak ${which}. Add it properly and move on.`;
    }
    if (persona === 'coach') {
      return `Conversion Coach: ${which} is weak/missing—clarity costs $0, confusion costs conversions.`;
    }
    if (persona === 'genz') {
      const adj = pickIntensity(intensity, 'mid', 'low-key confusing', 'giving nothing');
      return `Gen Z Critic: ${which} is ${adj}. Spice it up.`;
    }
    if (persona === 'seo') {
      return `SEO Shark: ${which} misconfigured. Unique, intent-driven copy wins SERPs.`;
    }
    if (persona === 'corp') {
      return `Corporate Consultant: Standardize ${which} across templates with a clear messaging framework.`;
    }
  }
  if (t === 'flow') {
    const step = stepFromFlowEvidence(i.evidence) || '?';
    if (persona === 'sassy') {
      const adj = pickIntensity(intensity, 'awkward', 'chaotic', 'catastrophic');
      return `Sassy Designer: User journey face-plants at step ${step}. ${adj} experience—clean the flow.`;
    }
    if (persona === 'dev') {
      return `Grumpy Dev: Flow fails at step ${step}. Repro, logs, fix. Basics.`;
    }
    if (persona === 'coach') {
      return `Conversion Coach: Funnel leak at step ${step}. Remove friction and validate errors clearly.`;
    }
    if (persona === 'genz') {
      return `Gen Z Critic: Step ${step} said “nope”. Big yikes.`;
    }
    if (persona === 'seo') {
      return `SEO Shark: Broken flows waste crawl/engagement—stabilize step ${step}.`;
    }
    if (persona === 'corp') {
      return `Corporate Consultant: Address step ${step} with a cross-functional fix (UX + FE + BE).`;
    }
  }
  // Fallback
  return `${persona}: ${i.title} — ${i.evidence}`;
}

export function buildRoasts(
  issues: Issue[],
  pages: PageRun[],
  journeys: Journey[],
  opts?: RoastOptions
): PersonaRoast[] {
  const intensity = (opts?.intensity ?? 2) as 1|2|3;
  const personas = (opts?.personas && opts?.personas.length ? opts.personas : ['sassy']) as PersonaId[];
  const limit = Math.max(1, Math.min(opts?.limitPerPersona ?? 6, 12));
  let pool = (issues || []).slice(0, limit);
  // Fallback: if no issues detected, synthesize a few SEO/UX hints from page signals so roast isn't empty
  if (!pool.length) {
    const pseudo: Issue[] = [];
    for (const p of (pages || []).slice(0, 3)) {
      const t = p.meta?.title?.trim() || '';
      const h1 = p.meta?.h1?.trim() || '';
      const d = p.meta?.description?.trim() || '';
      if (!t) {
        pseudo.push({ id: 'pz-title', type: 'seo', pageUrl: p.url, title: 'Missing <title>', evidence: 'No <title> found', severity: 3, impact: 2, effort: 2, score: 4, fixSteps: ['Add unique, descriptive title'] });
      } else if (t.length < 15) {
        pseudo.push({ id: 'pz-title-short', type: 'seo', pageUrl: p.url, title: 'Short title', evidence: `Title length=${t.length}`, severity: 2, impact: 2, effort: 2, score: 2, fixSteps: ['Expand title with primary keyphrase'] });
      }
      if (!h1) {
        pseudo.push({ id: 'pz-h1', type: 'seo', pageUrl: p.url, title: 'Missing H1', evidence: 'No <h1> detected', severity: 2, impact: 2, effort: 2, score: 2, fixSteps: ['Add a descriptive H1'] });
      }
      if (!d) {
        pseudo.push({ id: 'pz-desc', type: 'seo', pageUrl: p.url, title: 'Missing meta description', evidence: 'No meta description found', severity: 2, impact: 2, effort: 2, score: 2, fixSteps: ['Add a ~155 char meta description'] });
      }
      if (pseudo.length >= limit) break;
    }
    if (!pseudo.length) {
      // absolute fallback line (kept minimal)
      pseudo.push({ id: 'pz-generic', type: 'seo', title: 'Tighten value prop copy', evidence: 'Consider sharper hero headline and CTA clarity', severity: 2, impact: 2, effort: 2, score: 2, fixSteps: ['Test clearer headline & CTA'] });
    }
    pool = pseudo.slice(0, limit);
  }
  const out: PersonaRoast[] = [];
  for (const p of personas) {
    const lines = pool.map(i => buildLine(p, i, intensity));
    out.push({ persona: p, lines });
  }
  return out;
}

function humanizeA11y(i: Issue): string {
  const id = (i.ruleId || i.title || '').toLowerCase();
  const ev = (i.evidence || '').toLowerCase();
  if (id.includes('h57')) return 'Set page language (html lang)';
  if (id.includes('button.name')) return 'Button lacks accessible name';
  if (id.includes('a.nocontent')) return 'Link has no visible text';
  if (id.includes('f77') || ev.includes('duplicate id')) return 'Duplicate id attributes';
  if (id.includes('g18') || id.includes('g145') || ev.includes('contrast')) return 'Insufficient color contrast';
  return i.title;
}

export async function buildRoastsLLM(personas: PersonaId[], issues: Issue[], pages: PageRun[], journeys: Journey[], intensity: 1|2|3): Promise<PersonaRoast[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const system = 'You are a brand-safe, witty reviewer. Write short roast lines that are helpful and humane. No slurs, no personal attacks, no code names like WCAG or rule IDs. Keep each line under 140 characters.';
  const input = JSON.stringify({ personas, intensity, issues: issues.slice(0, 12), pages: pages.slice(0,3), journeys });
  try {
    const text = await geminiGenerateText({ system, input, json: false });
    // Minimal parse: split into persona sections if present, else assign to first persona
    const lines = String(text).split('\n').map(s => s.trim()).filter(s => s);
    const out: PersonaRoast[] = []; const first = personas[0] || 'sassy';
    out.push({ persona: first, lines });
    return out;
  } catch { return null; }
}
