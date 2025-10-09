import fs from 'node:fs/promises';
import path from 'node:path';

export async function safeWriteText(p: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf-8');
  } catch {
    // ignore (environment may be read-only)
  }
}

