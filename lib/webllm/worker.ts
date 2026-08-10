// ── WebLLM inference worker ────────────────────────────────────────────
//
// Runs in a dedicated Web Worker so GPU inference never blocks the
// main UI thread. Communicates via postMessage.

import { CreateMLCEngine, MLCEngine } from '@mlc-ai/web-llm';

let engine: MLCEngine | null = null;

type WorkerMessage =
  | { type: 'init'; modelId: string }
  | { type: 'generate'; id: number; prompt: string; temperature?: number }
  | { type: 'abort'; id: number };

type WorkerResponse =
  | { type: 'progress'; progress: number; text: string }
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'aborted'; id: number };

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      engine = await CreateMLCEngine(msg.modelId, {
        initProgressCallback: (report) => {
          post({ type: 'progress', progress: report.progress, text: report.text });
        },
      });
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === 'generate') {
    if (!engine) {
      post({ type: 'error', error: 'Engine not initialized' });
      return;
    }

    try {
      const reply = await engine.chat.completions.create({
        messages: [
          { role: 'user', content: msg.prompt },
        ],
        temperature: msg.temperature ?? 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      const text = reply.choices[0]?.message?.content ?? '';
      post({ type: 'result', id: msg.id, text });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        post({ type: 'aborted', id: msg.id });
      } else {
        post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
    return;
  }
};
