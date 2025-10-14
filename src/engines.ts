import type { PageRun, Journey } from './jobs/types.js';
import { safeWriteText } from './util/fs.js';

// Engines: HTTP crawler and Pa11y (no stub fallbacks).
export async function runCrawler(startUrl: string, maxDepth: number, _mode?: 'http'): Promise<PageRun[]> {
  const http = await import('./agents/crawl.http.js');
  return http.crawlHttp(startUrl, maxDepth);
}

export async function runLighthouseAudit(pages: PageRun[]): Promise<void> {
  try {
    const perf = await import('./agents/perf.lighthouse.js');
    return perf.runLighthouseCli(pages, 3);
  } catch {
    // Lighthouse not available; skip silently
    return;
  }
}

export async function runAxeAudit(pages: PageRun[], _mode?: 'pa11y'): Promise<void> {
  try {
    const pa = await import('./agents/a11y.pa11y.js');
    return pa.runPa11y(pages, 3);
  } catch {
    // Pa11y unavailable; skip (no stub fallback).
    return;
  }
}
// Journeys disabled until a real adapter is added.
export async function runJourneysAgent(baseUrl: string, jobId: string): Promise<Journey[]> {
  try {
    // Support both built (.js) and ts-node dev (.ts) imports
    let mod: any;
    try {
      mod = await import('./agents/journeys.puppeteer.js');
    } catch {
      const tsPath = './agents/' + 'journeys.puppeteer.ts';
      mod = await import(tsPath as any);
    }
    const flowsPath = process.env.FLOWS_PATH as string | undefined;
    return mod.runJourneysPuppeteer(baseUrl, jobId, flowsPath);
  } catch (e: any) {
    const msg = 'Failed to import journeys adapter. Ensure dependencies are installed.\n' +
      (e && e.message ? `Error: ${e.message}\n` : '');
    try { await safeWriteText(`runs/${jobId}/journeys/error.log`, msg); } catch {}
    return [];
  }
}

// Minimal competitor benchmarking: crawl root page only, then run audits on that page.
export async function runBenchmarkTargets(urls: string[]): Promise<Array<{ url: string; origin: string; page?: PageRun }>> {
  const results: Array<{ url: string; origin: string; page?: PageRun }> = [];
  const uniq = Array.from(new Set((urls || []).filter(u => /^https?:\/\//i.test(String(u))))).slice(0, 3);
  for (const u of uniq) {
    try {
      const origin = new URL(u).origin;
      const pages = await runCrawler(u, 0, 'http' as any);
      const first = pages[0];
      if (first) {
        // Run lightweight audits on this single page
        await runLighthouseAudit([first]);
        await runAxeAudit([first]);
      }
      results.push({ url: u, origin, page: first });
    } catch {
      try { results.push({ url: u, origin: u, page: undefined }); } catch { results.push({ url: u, origin: u }); }
    }
  }
  return results;
}
