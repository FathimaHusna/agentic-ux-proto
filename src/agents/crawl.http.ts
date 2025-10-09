import { PageRun } from '../jobs/types.js';
import { sameOrigin } from '../util/url.js';

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeHtml(m[1].trim()) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  // Try standard meta description
  let tagMatch = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  // Fallback to common alternates (OpenGraph/Twitter)
  if (!tagMatch) {
    tagMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]*>/i)
            || html.match(/<meta[^>]+name=["']og:description["'][^>]*>/i)
            || html.match(/<meta[^>]+name=["']twitter:description["'][^>]*>/i)
            || html.match(/<meta[^>]+property=["']twitter:description["'][^>]*>/i);
  }
  if (!tagMatch) return undefined;
  const tag = tagMatch[0];
  const c = tag.match(/content=["']([^"']*)["']/i);
  return c ? decodeHtml(c[1].trim()) : undefined;
}

function extractFirstH1(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return undefined;
  const inner = m[1];
  const text = inner
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decodeHtml(text || undefined as any);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hrefRaw = m[1];
    try {
      const abs = new URL(hrefRaw, baseUrl).href;
      out.push(abs);
    } catch {
      // ignore bad URLs
    }
  }
  return Array.from(new Set(out));
}

function decodeHtml(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'AgenticUX-Proto/0.1',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal
    } as any);
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !/text\/html|application\/xhtml\+xml/i.test(ct)) return null;
    const html = await res.text();
    // Cap extremely large pages to keep things snappy
    return html.length > 2_000_000 ? html.slice(0, 2_000_000) : html;
  } catch {
    return null;
  }
}

export async function crawlHttp(startUrl: string, maxDepth: number = 2, maxPages: number = 20): Promise<PageRun[]> {
  const pages: PageRun[] = [];
  const visited = new Set<string>();
  const base = new URL(startUrl);
  base.hash = '';
  const start = base.href;
  const q: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];

  while (q.length) {
    const { url, depth } = q.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    if (!sameOrigin(startUrl, url)) continue;

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    const html = await fetchHtml(url, controller.signal);
    clearTimeout(to);

    let links: string[] = [];
    let title: string | undefined;
    let description: string | undefined;
    let h1: string | undefined;

    if (html) {
      title = extractTitle(html);
      description = extractMetaDescription(html);
      h1 = extractFirstH1(html);
      const rawLinks = extractLinks(html, url).map(h => { try { const u = new URL(h); u.hash = ''; return u.href; } catch { return h; } });
      links = rawLinks
        .filter(Boolean)
        .filter((l) => sameOrigin(base.href, l));
    }

    pages.push({ url, links: Array.from(new Set(links)), meta: { title, description, h1 } });

    if (depth < maxDepth) {
      for (const l of links) {
        if (!visited.has(l)) q.push({ url: l, depth: depth + 1 });
      }
    }
    if (pages.length >= maxPages) break;
  }
  return pages;
}
