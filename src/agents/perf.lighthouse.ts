import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { PageRun } from '../jobs/types.js';

export async function runLighthouseCli(pages: PageRun[], maxPages: number = 3): Promise<void> {
  const targets = pages.slice(0, Math.max(1, maxPages));
  for (const p of targets) {
    let chrome: any;
    try {
      chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
      const options: any = { logLevel: 'error', output: 'json', onlyCategories: ['performance', 'seo'], port: chrome.port };
      const runnerResult: any = await lighthouse(p.url, options);
      const lhr = runnerResult?.lhr;
      if (lhr) {
        const audits = lhr.audits || {};
        const perf = lhr.categories?.performance?.score ?? null;
        p.lhr = {
          audits: {
            'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: audits['largest-contentful-paint']?.numericValue ?? null },
            'interactive': { id: 'interactive', numericValue: audits['interaction-to-next-paint']?.numericValue ?? audits['total-blocking-time']?.numericValue ?? null },
            'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: audits['cumulative-layout-shift']?.numericValue ?? null }
          },
          categories: { performance: { score: perf } }
        };
      }
    } catch {
      // leave page without LHR on error
    } finally {
      if (chrome) {
        try { await chrome.kill(); } catch {}
      }
    }
  }
}
