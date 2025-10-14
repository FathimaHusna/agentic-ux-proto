import fs from 'node:fs/promises';
import path from 'node:path';
import { safeWriteText } from '../util/fs.js';
import type { Job, Issue } from '../jobs/types.js';
import { digestsForIssues, issueDigest } from '../synthesis/digest.js';

const INDEX_PATH = path.resolve('runs', 'index.json');

export type TriageState = 'accepted' | 'wontfix' | 'needs-design' | 'planned' | 'in-progress' | 'done';

export interface TriageMeta {
  state?: TriageState;
  owner?: 'FE' | 'Design' | 'SEO' | 'QA';
  estimateHours?: number;
  notes?: string;
}

export interface RunMeta {
  id: string;
  url: string;
  origin: string;
  createdAt: string;
  status: Job['status'];
  summary?: string;
  counts: { issues: number; pages: number; journeys: number };
  digests: string[];
}

export interface RunsIndex {
  runs: RunMeta[];
  triage: Record<string, TriageMeta | TriageState>;
}

async function ensureDir(p: string) {
  try { await fs.mkdir(p, { recursive: true }); } catch {}
}

async function readIndex(): Promise<RunsIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.runs || !Array.isArray(parsed.runs)) return { runs: [], triage: {} };
    return { runs: parsed.runs, triage: parsed.triage || {} };
  } catch {
    await ensureDir(path.dirname(INDEX_PATH));
    return { runs: [], triage: {} };
  }
}

async function writeIndex(idx: RunsIndex): Promise<void> {
  const js = JSON.stringify(idx, null, 2);
  await safeWriteText(INDEX_PATH, js);
}

export async function recordRun(job: Job): Promise<void> {
  if (!job.outputs) return; // only record completed outputs
  const idx = await readIndex();
  const origin = (() => { try { return new URL(job.url).origin; } catch { return job.url; } })();
  const meta: RunMeta = {
    id: job.id,
    url: job.url,
    origin,
    createdAt: job.createdAt,
    status: job.status,
    summary: job.summary,
    counts: {
      issues: job.outputs.issues?.length || 0,
      pages: job.outputs.pages?.length || 0,
      journeys: job.outputs.journeys?.length || 0
    },
    digests: digestsForIssues(job.outputs.issues || [])
  };
  // replace existing meta for id if present, else push
  const i = idx.runs.findIndex(r => r.id === meta.id);
  if (i >= 0) idx.runs[i] = meta; else idx.runs.push(meta);
  // sort by createdAt desc
  idx.runs.sort((a, b) => (b.createdAt.localeCompare(a.createdAt)));
  await writeIndex(idx);
}

export async function listRuns(origin?: string): Promise<RunMeta[]> {
  const idx = await readIndex();
  const runs = idx.runs || [];
  if (!origin) return runs;
  return runs.filter(r => r.origin === origin);
}

export async function getRunMeta(id: string): Promise<RunMeta | undefined> {
  const idx = await readIndex();
  return idx.runs.find(r => r.id === id);
}

export async function diffRuns(aId: string, bId: string): Promise<{ base?: RunMeta; head?: RunMeta; added: string[]; removed: string[]; unchanged: string[] }>{
  const idx = await readIndex();
  const a = idx.runs.find(r => r.id === aId);
  const b = idx.runs.find(r => r.id === bId);
  if (!a || !b) return { base: a, head: b, added: [], removed: [], unchanged: [] };
  const aSet = new Set(a.digests);
  const bSet = new Set(b.digests);
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const d of bSet) { if (!aSet.has(d)) added.push(d); else unchanged.push(d); }
  for (const d of aSet) { if (!bSet.has(d)) removed.push(d); }
  return { base: a, head: b, added, removed, unchanged };
}

export async function setTriage(digest: string, state: TriageState | null): Promise<void> {
  const idx = await readIndex();
  if (state) idx.triage[digest] = { ...(typeof idx.triage[digest] === 'object' ? idx.triage[digest] as any : {}), state } as TriageMeta; else delete idx.triage[digest];
  await writeIndex(idx);
}

export async function getTriage(digest: string): Promise<TriageState | undefined> {
  const idx = await readIndex();
  const v = idx.triage[digest];
  if (!v) return undefined;
  if (typeof v === 'string') return v as TriageState;
  return (v as TriageMeta).state;
}

export async function getTriageMap(digests: string[]): Promise<Record<string, TriageState>> {
  const idx = await readIndex();
  const out: Record<string, TriageState> = {} as any;
  for (const d of digests) {
    const meta = idx.triage[d];
    const s = typeof meta === 'string' ? (meta as TriageState) : (meta as TriageMeta)?.state;
    if (s) out[d] = s;
  }
  return out;
}

export function computeIssueDigest(i: Issue): string { return issueDigest(i); }

export async function setTriageMeta(digest: string, meta: Partial<TriageMeta>): Promise<void> {
  const idx = await readIndex();
  const cur = idx.triage[digest];
  const curObj: TriageMeta = (typeof cur === 'string') ? { state: cur as TriageState } : (cur || {} as any);
  idx.triage[digest] = { ...curObj, ...meta };
  await writeIndex(idx);
}

export async function getTriageMetaMap(digests: string[]): Promise<Record<string, TriageMeta>> {
  const idx = await readIndex();
  const out: Record<string, TriageMeta> = {};
  for (const d of digests) {
    const cur = idx.triage[d];
    if (!cur) continue;
    out[d] = typeof cur === 'string' ? { state: cur as TriageState } : (cur as TriageMeta);
  }
  return out;
}
