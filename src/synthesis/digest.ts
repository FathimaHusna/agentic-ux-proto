import crypto from 'node:crypto';
import type { Issue } from '../jobs/types.js';

function normUrl(u?: string): string {
  if (!u) return '';
  try {
    const x = new URL(u);
    x.hash = '';
    // For stability across runs, ignore querystrings for now
    x.search = '';
    return x.href;
  } catch {
    return u;
  }
}

function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export function issueDigest(i: Issue): string {
  const type = i.type;
  const page = normUrl(i.pageUrl || '');
  const keyParts: string[] = [type, page];
  // Use the most stable discriminator per type
  if (i.type === 'a11y') {
    keyParts.push(i.ruleId || '');
    keyParts.push(i.wcag || '');
  } else if (i.type === 'perf') {
    keyParts.push(i.metric?.name || '');
  } else if (i.type === 'seo') {
    // Normalize by short title/evidence hint to capture rule-like meaning
    keyParts.push((i.title || '').toLowerCase().slice(0, 48));
  } else if (i.type === 'flow') {
    keyParts.push((i.title || '').toLowerCase().slice(0, 48));
  }
  const raw = keyParts.join('|');
  return hash(raw);
}

export function digestsForIssues(issues: Issue[]): string[] {
  return Array.from(new Set((issues || []).map(issueDigest)));
}

