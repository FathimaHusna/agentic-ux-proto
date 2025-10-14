import puppeteerModule from 'puppeteer';

function pickPuppeteer() {
  const hasCustomExec = !!(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH);
  try { return hasCustomExec ? require('puppeteer-core') : puppeteerModule; } catch { return puppeteerModule; }
}

export interface FlowStep {
  action: 'visit' | 'click' | 'type' | 'wait' | 'assertText' | 'assertVisible';
  url?: string;
  selector?: string;
  value?: string;
  contains?: string;
  ms?: number;
}

export interface FlowDef { name: string; steps: FlowStep[] }

export interface FlowRunStep {
  i: number;
  action: string;
  ok: boolean;
  t: number;
  error?: string;
  selector?: string;
  suggestions?: Array<{ type: 'css'|'xpath'; selector: string; reason: string; score: number }>
}

export interface FlowRunResult {
  name: string;
  ok: boolean;
  steps: FlowRunStep[];
  failedAt?: number;
  totalTime: number;
}

export async function runFlow(def: FlowDef): Promise<FlowRunResult> {
  const puppeteer: any = pickPuppeteer();
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
  const headless = process.env.PUPPETEER_HEADLESS === 'false' ? false : true;
  const chromeArgs = [ '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote' ];
  let browser: any = null;
  const steps: FlowRunStep[] = [];
  let failedAt: number | undefined;
  const start = Date.now();
  try {
    browser = await puppeteer.launch({ headless, args: chromeArgs, executablePath });
    const page = await browser.newPage();
    for (let i = 0; i < def.steps.length; i++) {
      const s = def.steps[i];
      const t0 = Date.now();
      try {
        if (s.action === 'visit') {
          await page.goto(s.url || 'about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 });
          steps.push({ i, action: 'visit', ok: true, t: Date.now() - t0 });
        } else if (s.action === 'click') {
          await page.waitForSelector(s.selector!, { timeout: 10000, visible: true }).catch(() => {});
          await page.click(s.selector!);
          steps.push({ i, action: 'click', ok: true, t: Date.now() - t0, selector: s.selector });
        } else if (s.action === 'type') {
          await page.waitForSelector(s.selector!, { timeout: 10000, visible: true }).catch(() => {});
          await page.type(s.selector!, s.value ?? '', { delay: 10 });
          steps.push({ i, action: `type ${s.selector}`, ok: true, t: Date.now() - t0, selector: s.selector });
        } else if (s.action === 'wait') {
          if (typeof (page as any).waitForTimeout === 'function') await (page as any).waitForTimeout(s.ms || 200); else await new Promise(r => setTimeout(r, s.ms || 200));
          steps.push({ i, action: 'wait', ok: true, t: Date.now() - t0 });
        } else if (s.action === 'assertText') {
          await page.waitForSelector(s.selector!, { timeout: 10000 });
          const txt = await page.$eval(s.selector!, (el: any) => (el.textContent || '').trim());
          if (!txt.includes(s.contains!)) throw new Error('text not found');
          steps.push({ i, action: `assertText ${s.selector}`, ok: true, t: Date.now() - t0, selector: s.selector });
        } else if (s.action === 'assertVisible') {
          await page.waitForSelector(s.selector!, { timeout: 10000, visible: true });
          steps.push({ i, action: `assertVisible ${s.selector}`, ok: true, t: Date.now() - t0, selector: s.selector });
        }
      } catch (e: any) {
        failedAt = i;
        // Suggest better selectors when failure is selector-related
        let suggestions: FlowRunStep['suggestions'];
        try {
          if (s.selector) {
            const { suggestSelectors } = await import('./selectorHeuristics.js');
            const sug = await suggestSelectors({ url: (await page.url()) || s.url || 'about:blank', selector: s.selector });
            if (sug.ok && sug.candidates) suggestions = sug.candidates?.slice(0, 5) as any;
          }
        } catch {}
        steps.push({ i, action: s.action, ok: false, t: Date.now() - t0, error: e?.message || 'step failed', selector: s.selector, suggestions });
        break;
      }
    }
    const totalTime = Date.now() - start;
    await browser.close().catch(() => {});
    return { name: def.name, ok: typeof failedAt !== 'number', steps, failedAt, totalTime };
  } catch (e: any) {
    try { if (browser) await browser.close(); } catch {}
    return { name: def.name, ok: false, steps, failedAt: 0, totalTime: Date.now() - start };
  }
}

