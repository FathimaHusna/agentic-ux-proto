import { JobStore } from './jobStore.js';
import { Job, PageRun, Journey } from './types.js';
import { runCrawler, runLighthouseAudit, runAxeAudit, runJourneysAgent, runBenchmarkTargets } from '../engines.js';
import { prioritize } from '../synthesis/prioritize.js';
import { buildStoryboardHtml } from '../synthesis/storyboard.js';
import { safeWriteText } from '../util/fs.js';
import { recordRun } from '../store/jsonStore.js';

export function enqueueJob(store: JobStore, id: string) {
  setImmediate(async () => {
    const job = store.getJob(id);
    if (!job) return;
    try {
      store.updateJob(id, { status: 'running', progress: 1, stage: 'crawl' });

      // 1) Crawl
      const pages: PageRun[] = await runCrawler(job.url, job.options.maxDepth, job.options.engines?.crawler);
      store.updateJob(id, { progress: 25, stage: 'perf' });

      // 1b) Enrich metadata with browser render if missing (first page)
      try {
        const first = pages && pages.length ? pages[0] : undefined;
        if (first && (!first.meta || (!first.meta.title && !first.meta.h1 && !first.meta.description))) {
          try {
            const mod: any = await import('../agents/meta.puppeteer.js');
            const m = await mod.fetchMetaHead(first.url);
            const meta: any = (first as any).meta || ((first as any).meta = {});
            meta.title = meta.title || m.title;
            meta.h1 = meta.h1 || m.h1;
            meta.description = meta.description || m.description;
          } catch {}
        }
      } catch {}

      // 2) Audits
      await runLighthouseAudit(pages); // no-op placeholder
      store.updateJob(id, { progress: 45, stage: 'a11y' });
      await runAxeAudit(pages, job.options.engines?.a11y);
      store.updateJob(id, { progress: 65, stage: 'bench' });

      // 2b) Competitor benchmarking (first page only)
      let benchTargets: Array<{ url: string; origin: string; page?: PageRun }> = [];
      if (job.options?.competitors && job.options.competitors.length) {
        try {
          benchTargets = await runBenchmarkTargets(job.options.competitors);
        } catch { benchTargets = []; }
      }
      store.updateJob(id, { progress: 70, stage: 'journeys' });

      // 3) Journeys (puppeteer)
      const journeys: Journey[] = await runJourneysAgent(job.url, job.id);
      store.updateJob(id, { progress: 85, stage: 'synthesis' });

      // 4) Synthesis
      const issues = prioritize(pages, journeys);
      const html = buildStoryboardHtml(job, pages, journeys, issues, benchTargets);

      const outputs = {
        pages,
        issues,
        journeys,
        artifacts: { reportHtml: html as string },
        bench: benchTargets && benchTargets.length ? { targets: benchTargets } : undefined
      };

      // best-effort write
      await safeWriteText(`runs/${job.id}/report.html`, html);
      try {
        await safeWriteText(`runs/${job.id}/outputs.json`, JSON.stringify({ pages, issues, journeys }, null, 2));
      } catch {}

      store.updateJob(id, {
        status: 'done',
        progress: 100,
        stage: 'done',
        outputs,
        summary: `${issues.length} issues across ${pages.length} pages; ${journeys.length} journeys analyzed.`
      });
      // Persist lightweight run meta for history/diffs
      try { await recordRun(store.getJob(id)!); } catch {}
    } catch (e: any) {
      store.updateJob(id, { status: 'error', stage: 'error', error: e?.message || String(e) });
    }
  });
}
