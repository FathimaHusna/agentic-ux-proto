import { runCrawler, runLighthouseAudit, runAxeAudit, runJourneysAgent } from '../engines.js';
import { prioritize } from '../synthesis/prioritize.js';
import { buildStoryboardHtml } from '../synthesis/storyboard.js';
import { buildRoasts } from '../synthesis/roast.js';
import { safeWriteText } from '../util/fs.js';
import { createId } from '../util/id.js';

async function main() {
  const args = process.argv.slice(2);
  const urlArg = (args.find(a => a.startsWith('--url=')) || '').split('=')[1] || 'https://example.com/';
  const depth = Number((args.find(a => a.startsWith('--depth=')) || '').split('=')[1] || '1');
  const personasArg = (args.find(a => a.startsWith('--personas=')) || '').split('=')[1] || 'sassy,dev';
  const intensity = Number((args.find(a => a.startsWith('--honesty=')) || '').split('=')[1] || '2');

  const id = createId();
  console.log('Analyze demo start:', { url: urlArg, depth, id });

  const pages = await runCrawler(urlArg, Math.max(0, Math.min(depth, 2)), 'http' as any);
  await runLighthouseAudit(pages); // if Chrome unavailable, silently skipped
  await runAxeAudit(pages, 'pa11y' as any); // if pa11y unavailable, silently skipped
  const journeys = await runJourneysAgent(urlArg, id); // best-effort; returns [] on failure
  const issues = prioritize(pages, journeys);

  // Create a pseudo-job for HTML synthesis
  const job = {
    id,
    url: urlArg,
    options: { maxDepth: depth, engines: { crawler: 'http', a11y: 'pa11y' } },
    status: 'done', progress: 100,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    summary: `${issues.length} issues across ${pages.length} pages; ${journeys.length} journeys analyzed.`
  } as any;
  const html = buildStoryboardHtml(job, pages, journeys, issues);
  await safeWriteText(`runs/${id}/report.html`, html);
  await safeWriteText(`runs/${id}/outputs.json`, JSON.stringify({ pages, issues, journeys }, null, 2));

  // Build roasts
  const personas = personasArg.split(',').map(s => s.trim()).filter(Boolean) as any;
  const roasts = buildRoasts(issues, pages, journeys, { personas, intensity: Math.max(1, Math.min(intensity || 2, 3)) as any, limitPerPersona: 6 });
  console.log('Roasts:');
  for (const block of roasts) {
    console.log(`\n=== ${block.persona.toUpperCase()} ===`);
    for (const line of block.lines) console.log('- ' + line);
  }
  console.log(`\nArtifacts written under runs/${id}`);
}

main().catch(e => { console.error(e); process.exit(1); });

