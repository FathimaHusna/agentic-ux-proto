import { PageRun, AxeViolation } from '../jobs/types.js';

function mapTypeToImpact(type: string | number | undefined): 'minor' | 'moderate' | 'serious' | 'critical' {
  // pa11y types are often 'error' | 'warning' | 'notice' or numeric codes
  const t = typeof type === 'string' ? type.toLowerCase() : String(type);
  if (t.includes('error') || t === '1') return 'serious';
  if (t.includes('warning') || t === '2') return 'moderate';
  return 'minor';
}

function extractWcag(code?: string): string | undefined {
  if (!code) return undefined;
  // Try to pull out a guideline like 1.1.1 from code such as WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
  const m = code.match(/(\d\.\d\.\d)/);
  return m ? `WCAG ${m[1]}` : undefined;
}

export async function runPa11y(pages: PageRun[], maxPages: number = 3): Promise<void> {
  let pa11yFn: any;
  try {
    const mod: any = await import('pa11y');
    pa11yFn = mod.default ?? mod;
  } catch {
    // Pa11y not installed; skip gracefully
    return;
  }

  const targets = pages.slice(0, Math.max(1, maxPages));
  for (const p of targets) {
    try {
      const res = await pa11yFn(p.url, {
        standard: 'WCAG2AA',
        chromeLaunchConfig: { args: ['--no-sandbox', '--headless=new'] },
        timeout: 30000
      });
      const violations: AxeViolation[] = (res?.issues || []).map((i: any) => ({
        id: String(i?.code || i?.type || 'a11y-issue'),
        impact: mapTypeToImpact(i?.type),
        description: String(i?.message || 'Accessibility issue'),
        helpUrl: '',
        nodes: [{ target: [String(i?.selector || '')].filter(Boolean) }],
        wcag: extractWcag(String(i?.code || ''))
      }));
      p.axe = { violations };
    } catch {
      // Leave page without pa11y results if it fails
      if (!p.axe) p.axe = { violations: [] };
    }
  }
}

