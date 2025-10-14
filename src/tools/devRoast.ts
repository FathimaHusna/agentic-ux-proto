import { buildRoasts } from '../synthesis/roast.js';
import type { Issue, PageRun, Journey } from '../jobs/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function readOutputs(jobId: string): Promise<{ issues: Issue[]; pages: PageRun[]; journeys: Journey[] } | null> {
  try {
    const p = path.resolve('runs', jobId, 'outputs.json');
    const raw = await fs.readFile(p, 'utf-8');
    const j = JSON.parse(raw);
    return { issues: j.issues || [], pages: j.pages || [], journeys: j.journeys || [] };
  } catch {
    return null;
  }
}

function sample(): { issues: Issue[]; pages: PageRun[]; journeys: Journey[] } {
  const issues: Issue[] = [
    {
      id: 'i1', type: 'perf', pageUrl: 'https://example.com',
      title: 'High LCP (slow hero)', evidence: 'largest-contentful-paint=4200',
      metric: { name: 'largest-contentful-paint', value: 4200 },
      severity: 5, impact: 5, effort: 2, score: 23,
      fixSteps: ['Inline critical CSS', 'Preload hero image & font', 'Defer non-critical JS']
    },
    {
      id: 'i2', type: 'a11y', pageUrl: 'https://example.com',
      title: 'image-alt', evidence: 'Image without alt at img.hero', ruleId: 'image-alt', wcag: 'WCAG 1.1.1',
      severity: 4, impact: 4, effort: 2, score: 14, fixSteps: ['Add alt text', 'Verify with screen reader']
    },
    {
      id: 'i3', type: 'seo', pageUrl: 'https://example.com/pricing',
      title: 'Missing <title>', evidence: 'Page lacks a <title> tag',
      severity: 4, impact: 3, effort: 2, score: 10, fixSteps: ['Add clear, unique title']
    },
    {
      id: 'i4', type: 'flow', pageUrl: 'https://example.com/checkout',
      title: 'Journey failure: checkout', evidence: 'Failed at step #2: click (element not found)',
      severity: 5, impact: 5, effort: 3, score: 22, fixSteps: ['Reproduce', 'Fix selector', 'Better error handling']
    }
  ];
  const pages: PageRun[] = [{ url: 'https://example.com', links: [], meta: { title: 'Example', h1: 'Hello', description: 'Demo' } }];
  const journeys: Journey[] = [];
  return { issues, pages, journeys };
}

async function main() {
  const jobId = process.argv.find(a => a.startsWith('--job='))?.split('=')[1] || '';
  const personasArg = process.argv.find(a => a.startsWith('--personas='))?.split('=')[1] || 'sassy,dev,coach';
  const intensityArg = Number(process.argv.find(a => a.startsWith('--intensity='))?.split('=')[1] || '2');
  let data = jobId ? (await readOutputs(jobId)) : null;
  if (!data) data = sample();
  const personas = personasArg.split(',').map(s => s.trim()).filter(Boolean) as any;
  const roasts = buildRoasts(data.issues, data.pages, data.journeys, { personas, intensity: Math.max(1, Math.min(intensityArg || 2, 3)) as any, limitPerPersona: 6 });
  for (const block of roasts) {
    const title = block.persona;
    console.log(`\n=== ${title.toUpperCase()} ===`);
    for (const line of block.lines) console.log('- ' + line);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

