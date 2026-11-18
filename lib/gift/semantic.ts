'use client';

// ── Client-side semantic search (Transformers.js) ───────────────────────
//
// Runs a small sentence-embedding model (all-MiniLM-L6-v2, 384 dims) entirely
// in the browser, via WebGPU when available and WASM otherwise. Nothing is sent
// anywhere: the model is fetched once from the Hugging Face CDN, then every
// query, gift-intent and product title is embedded on the device.
//
// Progressive enhancement, like the rest of this app:
//   • the model is never downloaded automatically (~23 MB) — the shopper opts
//     in with a button;
//   • if it fails to load, `tokenSimilarity` keeps "cozy baking" working,
//     just less gracefully;
//   • embeddings are cached in memory per session (a 600-intent corpus is a few
//     seconds of work once).

import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const SEMANTIC_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const SEMANTIC_DIMENSIONS = 384;

export type SemanticStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface SemanticState {
  status: SemanticStatus;
  /** 0–1 while loading. */
  progress: number;
  error?: string;
  /** 'webgpu' or 'wasm' once loaded. */
  backend?: 'webgpu' | 'wasm';
}

let state: SemanticState = { status: 'idle', progress: 0 };
const listeners = new Set<() => void>();
let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<void> | null = null;

const cache = new Map<string, Float32Array>();
const MAX_CACHE_ENTRIES = 2000;

function notify(next: Partial<SemanticState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeSemantic(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSemanticState(): SemanticState {
  return state;
}

export function isSemanticReady(): boolean {
  return state.status === 'ready' && extractor !== null;
}

async function supportsWebGPU(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) return false;
    return (await nav.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/**
 * Load the embedding model. Safe to call repeatedly; concurrent calls share one
 * download. Resolves even on failure — check `getSemanticState()`.
 */
export async function loadSemanticModel(): Promise<void> {
  if (state.status === 'ready') return;
  if (loading) return loading;

  notify({ status: 'loading', progress: 0, error: undefined });

  loading = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      // Browser-only: never try to read a local model directory.
      env.allowLocalModels = false;

      const useWebGPU = await supportsWebGPU();
      const device = useWebGPU ? 'webgpu' : 'wasm';

      extractor = (await pipeline('feature-extraction', SEMANTIC_MODEL_ID, {
        device,
        dtype: 'q8',
        progress_callback: (event: { status?: string; progress?: number }) => {
          if (event.status === 'progress' && typeof event.progress === 'number') {
            notify({ progress: Math.min(0.99, Math.max(0, event.progress / 100)) });
          }
        },
      })) as FeatureExtractionPipeline;

      notify({ status: 'ready', progress: 1, backend: useWebGPU ? 'webgpu' : 'wasm' });
    } catch (error) {
      extractor = null;
      notify({
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Model failed to load',
      });
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * Embed texts. Returns `null` when the model is not ready, so callers can fall
 * back without branching on the state machine themselves.
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[] | null> {
  if (!extractor) return null;
  if (texts.length === 0) return [];

  const missing = texts.filter((text) => !cache.has(text));
  if (missing.length > 0) {
    const output = await extractor(missing, { pooling: 'mean', normalize: true });
    const rows = output.tolist() as number[][];
    missing.forEach((text, index) => {
      const vector = Float32Array.from(rows[index] ?? []);
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(text, vector);
    });
  }

  return texts.map((text) => cache.get(text) ?? new Float32Array(SEMANTIC_DIMENSIONS));
}

/** Dot product of two normalized vectors == cosine similarity. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * Cosine mapped to [0, 1]. Sentence embeddings of unrelated short phrases sit
 * around 0.0–0.2, so raw cosine compresses the useful range; this rescales it
 * to something the ranker can add to other 0–1 scores.
 */
export function semanticScore(a: Float32Array, b: Float32Array): number {
  return Math.max(0, Math.min(1, (cosineSimilarity(a, b) + 0.1) / 0.8));
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'is',
  'some', 'something', 'that', 'this', 'it', 'they', 'their', 'would', 'like',
  'loves', 'love', 'really', 'very', 'into', 'who', 'get', 'gift', 'want',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  );
}

/**
 * Deterministic fallback used when the model is unavailable.
 * Overlap coefficient, lightly weighted, in [0, 1].
 */
export function tokenSimilarity(query: string, text: string): number {
  const left = tokens(query);
  const right = tokens(text);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (shared / left.size) * 0.8;
}
