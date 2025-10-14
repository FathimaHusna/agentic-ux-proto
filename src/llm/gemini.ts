import 'dotenv/config';
import process from 'node:process';

interface GenArgs {
  model?: string;
  system?: string;
  input: string;
  json?: boolean;
}

export async function geminiGenerateText(args: GenArgs): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const model = args.model || 'gemini-1.5-pro-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body: any = {
    contents: [
      { role: 'user', parts: [{ text: args.input }] }
    ]
  };
  if (args.system) {
    (body as any).systemInstruction = { role: 'system', parts: [{ text: args.system }] };
  }
  if (args.json) {
    (body as any).generationConfig = { responseMimeType: 'application/json' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${txt}`);
  }
  const j: any = await res.json();
  const cand = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof cand === 'string') return cand;
  // Some responses place JSON in inline code blocks or alternative fields; try other parts
  const parts = j?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) { if (typeof p?.text === 'string') return p.text; }
  // Fallback to raw string
  return JSON.stringify(j);
}
