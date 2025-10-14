export async function fetchMetaHead(url: string): Promise<{ title?: string; h1?: string; description?: string }> {
  const hasCustomExec = !!(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH);
  let puppeteer: any = null;
  try {
    if (hasCustomExec) puppeteer = (await import('puppeteer-core')).default;
    else puppeteer = (await import('puppeteer')).default;
  } catch { try { puppeteer = (await import('puppeteer')).default; } catch { return {}; } }
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
  const headless = process.env.PUPPETEER_HEADLESS === 'false' ? false : true;
  const chromeArgs = ['--headless=new','--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'];
  let browser: any = null;
  try {
    browser = await puppeteer.launch({ headless, args: chromeArgs, executablePath });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const meta = await page.evaluate(() => {
      try {
        const g: any = (globalThis as any);
        const d: any = g && g.document ? g.document : null;
        const getMeta = (name: string) => {
          const s: any = d && d.querySelector ? d.querySelector(`meta[name="${name}"]`) : null;
          return s && s.getAttribute ? s.getAttribute('content') || undefined : undefined;
        };
        const title = d && d.title ? d.title : undefined;
        const h1El: any = d && d.querySelector ? d.querySelector('h1') : null;
        const h1 = h1El ? (h1El.textContent || '').trim() : undefined;
        const description = getMeta('description');
        return { title, h1, description };
      } catch { return {}; }
    });
    await browser.close().catch(() => {});
    return meta || {};
  } catch {
    try { if (browser) await browser.close(); } catch {}
    return {};
  }
}
