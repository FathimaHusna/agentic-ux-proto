import fs from 'node:fs/promises';
import path from 'node:path';
type Browser = any;
import { Journey, JourneyStep } from '../jobs/types.js';

type FlowStep =
  | { action: 'visit'; url?: string }
  | { action: 'click'; selector: string }
  | { action: 'type'; selector: string; value: string }
  | { action: 'wait'; ms: number }
  | { action: 'assertText'; selector: string; contains: string }
  | { action: 'assertVisible'; selector: string };

interface FlowDef { name: string; steps: FlowStep[] }

async function readFlows(configPath: string): Promise<FlowDef[]> {
  const raw = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Flows JSON must be an array');
  return parsed;
}

async function ensureDir(dir: string): Promise<void> {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

async function takeScreenshot(page: any, filePath: string) {
  try {
    await ensureDir(path.dirname(filePath));
    await page.screenshot({ path: filePath, fullPage: false });
  } catch {}
}

export async function runJourneysPuppeteer(baseUrl: string, jobId: string, flowsPath?: string): Promise<Journey[]> {
  let flows: FlowDef[];
  const defaultFlows: FlowDef[] = [
    { name: 'smoke: visit and check body', steps: [ { action: 'visit' }, { action: 'assertVisible', selector: 'body' } ] }
  ];
  if (flowsPath) {
    try {
      flows = await readFlows(path.resolve(flowsPath));
    } catch {
      flows = defaultFlows;
    }
  } else {
    flows = defaultFlows;
  }
  if (!Array.isArray(flows) || flows.length === 0) {
    flows = defaultFlows;
  }

  let browser: Browser | null = null;
  let launchError: any = null;
  const journeys: Journey[] = [];
  try {
    // Dynamically import puppeteer-core, fallback to puppeteer
    let puppeteerMod: any;
    try {
      const mod: any = await import('puppeteer-core');
      puppeteerMod = mod.default ?? mod;
    } catch {
      const mod: any = await import('puppeteer');
      puppeteerMod = mod.default ?? mod;
    }

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
    const headless = process.env.PUPPETEER_HEADLESS === 'false' ? false : true;
    const chromeArgs = [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ];
    browser = await puppeteerMod.launch({ headless, args: chromeArgs, executablePath });
    const context = await browser.createIncognitoBrowserContext();

    for (const flow of flows) {
      const page = await context.newPage();
      const steps: JourneyStep[] = [];
      let failedAt: number | undefined;
      const start = Date.now();
      try {
        for (let i = 0; i < flow.steps.length; i++) {
          const s: any = flow.steps[i];
          const t0 = Date.now();
          try {
            if (s.action === 'visit') {
              const target = s.url || baseUrl;
              await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
              try {
                const anyPage: any = page as any;
                if (typeof anyPage.waitForNetworkIdle === 'function') {
                  await anyPage.waitForNetworkIdle({ idleTime: 500, timeout: 5000 });
                } else {
                  await page.waitForTimeout(500);
                }
              } catch {}
              steps.push({ action: `visit ${target}`, selector: target, ok: true, t: Date.now() - t0 });
            } else if (s.action === 'click') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true }).catch(() => {});
              await page.click(s.selector);
              steps.push({ action: 'click', selector: s.selector, ok: true, t: Date.now() - t0 });
            } else if (s.action === 'type') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true }).catch(() => {});
              await page.type(s.selector, s.value ?? '', { delay: 10 });
              steps.push({ action: `type ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 });
            } else if (s.action === 'wait') {
              await page.waitForTimeout(s.ms || 200);
              steps.push({ action: 'wait', selector: '', ok: true, t: Date.now() - t0 });
            } else if (s.action === 'assertText') {
              await page.waitForSelector(s.selector, { timeout: 10000 });
              const txt = await page.$eval(s.selector, el => (el.textContent || '').trim());
              if (!txt.includes(s.contains)) throw new Error(`Text not found: ${s.contains}`);
              steps.push({ action: `assertText ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 });
            } else if (s.action === 'assertVisible') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true });
              steps.push({ action: `assertVisible ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 });
            }
          } catch (err: any) {
            failedAt = i;
            const screenshot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
            await takeScreenshot(page, screenshot);
            steps.push({ action: s.action, selector: s.selector || '', ok: false, t: Date.now() - t0, error: err?.message || 'step failed', screenshotPath: screenshot });
            break;
          }
        }
      } finally {
        const totalTime = Date.now() - start;
        journeys.push({ name: flow.name, steps, totalTime, failedAt });
        await page.close().catch(() => {});
      }
    }
  } catch (e: any) {
    launchError = e;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    } else {
      // best-effort write a hint if browser failed to launch
      try {
        const logPath = path.join('runs', jobId, 'journeys', 'error.log');
        await ensureDir(path.dirname(logPath));
        const msg = `Puppeteer failed to launch or run flows.\n` +
                    `Tried executable: ${process.env.PUPPETEER_EXECUTABLE_PATH || '(bundled)'}\n` +
                    `Hints: export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome and restart.\n` +
                    `${launchError ? 'Error: ' + (launchError.message || String(launchError)) + '\n' : ''}`;
        await fs.writeFile(logPath, msg, 'utf-8');
      } catch {}
    }
    try {
      const outPath = path.join('runs', jobId, 'journeys', 'results.json');
      await ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, JSON.stringify(journeys, null, 2), 'utf-8');
    } catch {}
  }
  return journeys;
}
