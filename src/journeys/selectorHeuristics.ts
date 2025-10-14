import puppeteerModule from 'puppeteer';

function pickPuppeteer() {
  const hasCustomExec = !!(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH);
  return hasCustomExec ? require('puppeteer-core') : puppeteerModule;
}

export interface SelectorCandidate {
  type: 'css' | 'xpath';
  selector: string;
  score: number; // higher = better
  reason: string;
}

export interface SuggestRequest {
  url: string;
  selector: string;
  timeoutMs?: number;
}

export interface SuggestResult {
  ok: boolean;
  error?: string;
  candidates?: SelectorCandidate[];
}

export async function suggestSelectors(req: SuggestRequest): Promise<SuggestResult> {
  const puppeteer: any = pickPuppeteer();
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
  const headless = process.env.PUPPETEER_HEADLESS === 'false' ? false : true;
  const chromeArgs = [ '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote' ];
  let browser: any = null;
  try {
    browser = await puppeteer.launch({ headless, args: chromeArgs, executablePath });
    const page = await browser.newPage();
    await page.goto(req.url, { waitUntil: 'domcontentloaded', timeout: Math.max(10000, req.timeoutMs || 15000) });
    const el = await page.$(req.selector);
    if (!el) return { ok: false, error: 'selector not found' };
    const info: any = await page.evaluate((node: any) => {
      const attrs: Record<string, string> = {} as any;
      try {
        if (!node || typeof node.getAttributeNames !== 'function') return {} as any;
        for (const a of node.getAttributeNames()) { attrs[a] = node.getAttribute(a) || ''; }
        const text = (node.innerText || node.textContent || '');
        const tag = (node.tagName ? String(node.tagName).toLowerCase() : '');
        const cls = Array.from((node.classList || []));
        return { attrs, text: String(text).trim(), tag, cls };
      } catch { return {} as any; }
    }, el as any);
    const cands: SelectorCandidate[] = [];
    const a = info.attrs || {};
    const push = (type: 'css'|'xpath', selector: string, score: number, reason: string) => { if (selector) cands.push({ type, selector, score, reason }); };
    // Strong IDs
    if (a.id && /^[A-Za-z_][A-Za-z0-9_\-:.]*$/.test(a.id)) push('css', `#${a.id}`, 100, 'id attribute');
    // Test IDs
    for (const key of ['data-testid','data-test','data-qa','data-cy']) { if (a[key]) push('css', `[${key}="${cssEscape(a[key])}"]`, 95, key); }
    // Aria labels
    if (a['aria-label']) push('css', `[aria-label="${cssEscape(a['aria-label'])}"]`, 90, 'aria-label');
    // Name/type for inputs
    if (info.tag === 'input' && a.name) push('css', `input[name="${cssEscape(a.name)}"]`, 85, 'input by name');
    // Role (heuristic)
    if (a.role) push('css', `[role="${cssEscape(a.role)}"]`, 70, 'role attribute');
    // Tag with short unique class
    if (info.cls && info.cls.length) {
      const cls = info.cls.filter((c: string) => c.length <= 20).slice(0, 2).map(cssEscape).join('.');
      if (cls) push('css', `${info.tag}.${cls}`, 60, 'tag + class');
    }
    // Text content (XPath)
    if (info.text && info.text.length <= 60) {
      const norm = info.text.replace(/\s+/g, ' ').trim();
      push('xpath', `//*[normalize-space(text())='${xpathEscape(norm)}']`, 75, 'exact text');
      push('xpath', `//*[contains(normalize-space(text()), '${xpathEscape(norm.slice(0, 20))}')]`, 65, 'partial text');
    }
    // Fallback: original selector
    push('css', req.selector, 10, 'original');
    // Sort by score desc
    cands.sort((x, y) => y.score - x.score);
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    return { ok: true, candidates: cands };
  } catch (e: any) {
    try { if (browser) await browser.close(); } catch {}
    return { ok: false, error: e?.message || 'error' };
  }
}

function cssEscape(s: string): string {
  return String(s).replace(/"/g, '\\"').replace(/\\/g, '\\\\');
}
function xpathEscape(s: string): string {
  return String(s).replace(/"/g, '\\"');
}
