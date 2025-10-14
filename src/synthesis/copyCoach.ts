import type { Job, PageRun } from '../jobs/types.js';
import { geminiGenerateText } from '../llm/gemini.js';

export interface CopySuggestion { url: string; title?: string; meta?: string; rationale?: string }
export interface CopyCoachResult { site: string; suggestions: CopySuggestion[] }

export type CopyStrategy = 'refine' | 'rewrite' | 'shorten' | 'expand';
export interface CopyOptions {
  strategy?: CopyStrategy;
  brand?: string;
  keywords?: string[];
  locale?: string; // e.g., en-LK
  tone?: 'professional' | 'playful' | 'direct' | 'friendly';
  forceDifferent?: boolean; // avoid output identical to input
}

function suggestTitleFromH1(h1?: string): string | undefined {
  if (!h1) return undefined;
  const s = h1.trim().replace(/\s+/g, ' ');
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

function hostFrom(url: string): string { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return 'your site'; } }

function improveTitle(existing?: string, h1?: string, url?: string, opts?: CopyOptions): string {
  const brand = opts?.brand || hostFrom(url || '');
  let base = (h1 || existing || '').trim();
  if (!base) return `Stream movies & TV fast | ${brand}`;
  // Remove excessive punctuation and trim
  base = base.replace(/\s+/g,' ').replace(/[\|·]+/g,'-').trim();
  if (opts?.strategy === 'shorten' && base.length > 55) return base.slice(0, 52) + '…';
  if (opts?.strategy === 'expand' && base.length < 40) return `${base} | ${brand}`.slice(0, 60);
  if (base.length > 60) return base.slice(0, 57) + '…';
  if (base.length < 35) return `${base} | ${brand}`.slice(0, 60);
  return base;
}

function improveDesc(existing?: string, url?: string, opts?: CopyOptions): string {
  const brand = opts?.brand || hostFrom(url || '');
  const d = (existing || '').trim();
  if (!d) return `Watch favorites on ${brand}. Unlimited entertainment with flexible plans. Start in minutes.`;
  const clean = d.replace(/\s+/g,' ').trim();
  if (opts?.strategy === 'shorten' && clean.length > 140) return clean.slice(0, 135) + '…';
  if (opts?.strategy === 'expand' && clean.length < 120) return `${clean} Start watching in minutes.`.slice(0, 160);
  if (clean.length > 180) return clean.slice(0, 175) + '…';
  if (clean.length < 110) return `${clean} Start watching in minutes.`.slice(0, 160);
  return clean;
}

export function buildCopySuggestionsFallback(job: Job, pages: PageRun[], opts?: CopyOptions): CopyCoachResult {
  const out: CopySuggestion[] = [];
  for (const p of pages.slice(0,3)) {
    const currentTitle = (p.meta?.title || '').trim();
    const currentDesc = (p.meta?.description || '').trim();
    const suggestion: CopySuggestion = {
      url: p.url,
      title: improveTitle(currentTitle, p.meta?.h1, p.url, opts),
      meta: improveDesc(currentDesc, p.url, opts),
      rationale: !currentTitle || !currentDesc ? 'Add missing metadata to improve CTR and clarity.' : 'Refine metadata for clarity and CTR.'
    };
    // If forceDifferent and suggestion equals existing, tweak
    if (opts?.forceDifferent !== false) {
      if (suggestion.title && eqLoose(suggestion.title, currentTitle)) {
        suggestion.title = altTitleVariant(currentTitle, p.meta?.h1, hostFrom(p.url));
      }
      if (suggestion.meta && suggestion.meta === currentDesc) {
        suggestion.meta = improveDesc(currentDesc + ' Flexible plans. Start today.', p.url, { ...opts, strategy: 'refine' });
      }
    }
    out.push(suggestion);
  }
  return { site: job.url, suggestions: out };
}

export async function buildCopySuggestionsLLM(job: Job, pages: PageRun[], opts?: CopyOptions): Promise<CopyCoachResult | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const system = 'You are a seasoned product copywriter. Suggest concise, benefit-driven page titles (~50–60 chars) and meta descriptions (120–160 chars). No jargon. Do not repeat the existing title/description verbatim; propose alternatives optimized for CTR in the specified locale and tone. Avoid using the exact phrase "Unlimited movies, TV shows, and more" unless strategy is refine and forceDifferent=false.';
  const input = JSON.stringify({
    site: job.url,
    options: { strategy: opts?.strategy || 'refine', brand: opts?.brand || hostFrom(job.url), keywords: opts?.keywords || [], locale: opts?.locale || 'en', tone: opts?.tone || 'professional', forceDifferent: opts?.forceDifferent !== false },
    pages: pages.slice(0,3).map(p => ({ url: p.url, currentTitle: p.meta?.title, h1: p.meta?.h1, currentDescription: p.meta?.description, disallowPhrases: [p.meta?.title, p.meta?.h1].filter(Boolean) }))
  });
  try {
    const text = await geminiGenerateText({ system, input, json: true });
    const clean = stripCodeFence(text);
    const parsed = JSON.parse(clean);
    if (parsed && Array.isArray(parsed.suggestions)) {
      // Post-process to ensure difference when requested
      const byUrl: Record<string, { title?: string; h1?: string; description?: string }> = {};
      for (const p of pages.slice(0,3)) byUrl[p.url] = { title: p.meta?.title, h1: p.meta?.h1, description: p.meta?.description };
      const out: CopyCoachResult = { site: job.url, suggestions: [] };
      for (const s of parsed.suggestions) {
        const url = s.url || (pages[0]?.url || job.url);
        const cur = byUrl[url] || { title: pages[0]?.meta?.title, h1: pages[0]?.meta?.h1, description: pages[0]?.meta?.description };
        let title = (s.title || '').trim();
        let meta = (s.meta || '').trim();
        if (opts?.forceDifferent !== false) {
          const canonical = 'unlimited movies, tv shows, and more';
          if (!title || eqLoose(title, cur.title) || eqLoose(title, cur.h1) || title.toLowerCase().includes(canonical)) {
            title = altTitleVariant(cur.title, cur.h1, hostFrom(url));
          }
          if (!meta || eqLoose(meta, cur.description)) {
            meta = improveDesc(cur.description ? cur.description + ' Flexible plans. Start today.' : '', url, { ...opts, strategy: 'refine' });
          }
        }
        out.suggestions.push({ url, title, meta, rationale: s.rationale || 'Refine metadata for clarity and CTR.' });
      }
      return out;
    }
    // try to coerce simple formats
    return null;
  } catch { return null; }
}

function stripCodeFence(s: string): string {
  const t = String(s).trim();
  if (t.startsWith('```')) {
    const inner = t.replace(/^```json\s*/i,'').replace(/^```\s*/,'');
    const idx = inner.lastIndexOf('```');
    return idx !== -1 ? inner.slice(0, idx).trim() : inner.trim();
  }
  return t;
}

function eqLoose(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase().replace(/\s+/g,' ');
  const nb = b.trim().toLowerCase().replace(/\s+/g,' ');
  return na === nb;
}

function altTitleVariant(existing?: string, h1?: string, brand?: string): string {
  const b = brand || 'your site';
  const variants = [
    `Stream movies & TV instantly | ${b}`,
    `Watch on any device — unlimited entertainment | ${b}`,
    `Entertainment for everyone | ${b}`,
    `Start watching in minutes | ${b}`
  ];
  // Pick a variant that isn't too close to existing/h1
  const lo = (s?: string) => (s||'').toLowerCase();
  for (const v of variants) {
    if (!eqLoose(v, existing) && !eqLoose(v, h1)) return v;
  }
  return `${(existing || h1 || 'Watch now').split('|')[0].trim()} | ${b}`.slice(0, 60);
}
