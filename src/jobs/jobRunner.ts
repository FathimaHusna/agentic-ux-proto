import { JobStore } from './jobStore.js';
import { Job, PageRun, Journey } from './types.js';
import { runCrawler, runLighthouseAudit, runAxeAudit, runJourneysAgent } from '../engines.js';
import { prioritize } from '../synthesis/prioritize.js';
import { buildStoryboardHtml } from '../synthesis/storyboard.js';
import { safeWriteText } from '../util/fs.js';

export function enqueueJob(store: JobStore, id: string) {
  setImmediate(async () => {
    const job = store.getJob(id);
    if (!job) return;
    try {
      store.updateJob(id, { status: 'running', progress: 1 });

      // 1) Crawl
      const pages: PageRun[] = await runCrawler(job.url, job.options.maxDepth, job.options.engines?.crawler);
      store.updateJob(id, { progress: 25 });

      // 2) Audits (perf disabled for now)
      await runLighthouseAudit(pages); // no-op placeholder
      store.updateJob(id, { progress: 45 });
      await runAxeAudit(pages, job.options.engines?.a11y);
      store.updateJob(id, { progress: 70 });

      // 3) Journeys (puppeteer)
      const journeys: Journey[] = await runJourneysAgent(job.url, job.id);
      store.updateJob(id, { progress: 85 });

      // 4) Synthesis
      const issues = prioritize(pages, journeys);
      const html = buildStoryboardHtml(job, pages, journeys, issues);

      const outputs = {
        pages,
        issues,
        journeys,
        artifacts: { reportHtml: html as string }
      };

      // best-effort write
      await safeWriteText(`runs/${job.id}/report.html`, html);

      store.updateJob(id, {
        status: 'done',
        progress: 100,
        outputs,
        summary: `${issues.length} issues across ${pages.length} pages; ${journeys.length} journeys analyzed.`
      });
    } catch (e: any) {
      store.updateJob(id, { status: 'error', error: e?.message || String(e) });
    }
  });
}
