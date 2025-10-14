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
  let runError: any = null;
  const journeys: Journey[] = [];
  try {
    // Dynamically import Puppeteer. Prefer full 'puppeteer' unless a custom
    // executable is provided via env (then prefer 'puppeteer-core').
    let puppeteerMod: any;
    const hasCustomExec = !!(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH);
    if (!hasCustomExec) {
      try {
        const modAny: any = await import('puppeteer');
        puppeteerMod = modAny.default ?? modAny;
      } catch { /* fall back to core */ }
    }
    if (!puppeteerMod) {
      try {
        const modAny: any = await import('puppeteer-core');
        puppeteerMod = modAny.default ?? modAny;
      } catch {
        throw new Error('Neither puppeteer nor puppeteer-core is available');
      }
    }

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
    const headless = process.env.PUPPETEER_HEADLESS === 'false' ? false : true;
    const screenshotAll = String(process.env.JOURNEY_SCREENSHOTS || '').toLowerCase() === 'all';
    const chromeArgs = [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ];
    browser = await puppeteerMod.launch({ headless, args: chromeArgs, executablePath });
    // Create an isolated context if supported; fall back to default
    let context: any = null;
    let useBrowserDirect = false;
    try {
      if (browser && typeof (browser as any).createIncognitoBrowserContext === 'function') {
        context = await (browser as any).createIncognitoBrowserContext();
      } else if (browser && typeof (browser as any).createBrowserContext === 'function') {
        context = await (browser as any).createBrowserContext();
      } else {
        useBrowserDirect = true;
      }
    } catch {
      useBrowserDirect = true;
      context = null;
    }

    for (const flow of flows) {
      let page: any | null = null;
      try {
        page = useBrowserDirect ? await (browser as any).newPage() : await context.newPage();
      } catch (e: any) {
        const start = Date.now();
        const steps: JourneyStep[] = [
          { action: 'newPage', selector: '', ok: false, t: 0, error: e?.message || 'failed to open page' }
        ];
        const totalTime = Date.now() - start;
        journeys.push({ name: flow.name, steps, totalTime, failedAt: 0 });
        // Skip executing steps for this flow
        continue;
      }
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
              const okStep: JourneyStep = { action: `visit ${target}`, selector: target, ok: true, t: Date.now() - t0 };
              if (screenshotAll) {
                const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                await takeScreenshot(page, shot);
                okStep.screenshotPath = shot;
              }
              steps.push(okStep);
            } else if (s.action === 'click') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true }).catch(() => {});
              await page.click(s.selector);
              const okStep: JourneyStep = { action: 'click', selector: s.selector, ok: true, t: Date.now() - t0 };
              if (screenshotAll) {
                const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                await takeScreenshot(page, shot);
                okStep.screenshotPath = shot;
              }
              steps.push(okStep);
            } else if (s.action === 'type') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true }).catch(() => {});
              await page.type(s.selector, s.value ?? '', { delay: 10 });
              const okStep: JourneyStep = { action: `type ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 };
              if (screenshotAll) {
                const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                await takeScreenshot(page, shot);
                okStep.screenshotPath = shot;
              }
              steps.push(okStep);
            } else if (s.action === 'wait') {
              const ms = s.ms || 200;
              try {
                if (typeof (page as any).waitForTimeout === 'function') {
                  await (page as any).waitForTimeout(ms);
                } else {
                  await new Promise<void>(r => setTimeout(r, ms));
                }
                const okStep: JourneyStep = { action: 'wait', selector: '', ok: true, t: Date.now() - t0 };
                if (screenshotAll) {
                  const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                  await takeScreenshot(page, shot);
                  okStep.screenshotPath = shot;
                }
                steps.push(okStep);
              } catch (e: any) {
                steps.push({ action: 'wait', selector: '', ok: false, t: Date.now() - t0, error: e?.message || 'wait failed' });
                throw e;
              }
            } else if (s.action === 'assertText') {
              await page.waitForSelector(s.selector, { timeout: 10000 });
              const txt = await page.$eval(s.selector, (el: any) => (el.textContent || '').trim());
              if (!txt.includes(s.contains)) throw new Error(`Text not found: ${s.contains}`);
              const okStep: JourneyStep = { action: `assertText ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 };
              if (screenshotAll) {
                const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                await takeScreenshot(page, shot);
                okStep.screenshotPath = shot;
              }
              steps.push(okStep);
            } else if (s.action === 'assertVisible') {
              await page.waitForSelector(s.selector, { timeout: 10000, visible: true });
              const okStep: JourneyStep = { action: `assertVisible ${s.selector}`, selector: s.selector, ok: true, t: Date.now() - t0 };
              if (screenshotAll) {
                const shot = `runs/${jobId}/journeys/${flow.name.replace(/[^a-z0-9_-]+/gi,'_')}-step${i+1}.png`;
                await takeScreenshot(page, shot);
                okStep.screenshotPath = shot;
              }
              steps.push(okStep);
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
    runError = e;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    // best-effort write a hint if we encountered any error (including after launch)
    if (launchError || runError) {
      try {
        const logPath = path.join('runs', jobId, 'journeys', 'error.log');
        await ensureDir(path.dirname(logPath));
        const msg = `Puppeteer failed to launch or run flows.\n` +
                    `Tried executable: ${process.env.PUPPETEER_EXECUTABLE_PATH || '(bundled)'}\n` +
                    `Hints: export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome and restart.\n` +
                    `${launchError ? 'Launch error: ' + (launchError.message || String(launchError)) + '\n' : ''}` +
                    `${runError && !launchError ? 'Run error: ' + (runError.message || String(runError)) + '\n' : ''}`;
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
