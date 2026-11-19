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

/**
 * Local embedding models, measured by `scripts/bench-embedding-models.ts` on
 * this app's own task (28 free-text → intent queries, 12 product rankings).
 *
 * `arctic-xs` is the default because it is the *same download size* as the
 * original MiniLM (22.6 MB) and beats it on every retrieval metric. `gte-small`
 * is the accuracy option (+10.5 MB, best recall@3). Full numbers live in
 * `docs/embedding-bench.json`.
 */
export interface EmbeddingModel {
  /** Registry key, also the env value for NEXT_PUBLIC_GIFT_EMBEDDING_MODEL. */
  key: string;
  /** Transformers.js model id. */
  id: string;
  dtype: 'q8' | 'fp16' | 'fp32';
  dimensions: number;
  /** Prefix applied to *queries* only (retrieval-tuned models expect one). */
  queryPrefix: string;
  /** Prefix applied to documents/passages (few models need one). */
  docPrefix: string;
  /** Measured download size of the quantized weights, MB. */
  sizeMB: number;
  label: string;
  /** Measured quality on this app's task: 0.6·recall@3 + 0.4·product top-1. */
  quality: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  'arctic-xs': {
    key: 'arctic-xs',
    id: 'Snowflake/snowflake-arctic-embed-xs',
    dtype: 'q8',
    dimensions: 384,
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    docPrefix: '',
    sizeMB: 22.6,
    label: 'Arctic Embed XS',
    quality: 0.686,
  },
  'gte-small': {
    key: 'gte-small',
    id: 'Xenova/gte-small',
    dtype: 'q8',
    dimensions: 384,
    queryPrefix: '',
    docPrefix: '',
    sizeMB: 33.1,
    label: 'GTE Small',
    quality: 0.762,
  },
  'minilm-l6': {
    key: 'minilm-l6',
    id: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'q8',
    dimensions: 384,
    queryPrefix: '',
    docPrefix: '',
    sizeMB: 22.6,
    label: 'MiniLM L6 (previous default)',
    quality: 0.621,
  },
};

export const DEFAULT_EMBEDDING_MODEL = 'arctic-xs';

/**
 * Which model this build uses. Overridable so a deployment can opt into the
 * larger model without a code change:
 *   NEXT_PUBLIC_GIFT_EMBEDDING_MODEL=gte-small
 */
export function activeEmbeddingModel(): EmbeddingModel {
  const requested = process.env.NEXT_PUBLIC_GIFT_EMBEDDING_MODEL;
  return (
    (requested ? EMBEDDING_MODELS[requested] : undefined) ??
    EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL]
  );
}

const ACTIVE = activeEmbeddingModel();

export const SEMANTIC_MODEL_ID = ACTIVE.id;
export const SEMANTIC_DIMENSIONS = ACTIVE.dimensions;

export type SemanticStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface SemanticState {
  status: SemanticStatus;
  /** 0–1 while loading. */
  progress: number;
  error?: string;
  /** 'webgpu' or 'wasm' once loaded. */
  backend?: 'webgpu' | 'wasm';
  /** Model that is (being) loaded. */
  model?: { key: string; label: string; sizeMB: number; id: string };
}

/** The model this build will load. */
export function activeModelSummary(): NonNullable<SemanticState['model']> {
  return { key: ACTIVE.key, label: ACTIVE.label, sizeMB: ACTIVE.sizeMB, id: ACTIVE.id };
}

let state: SemanticState = { status: 'idle', progress: 0 };
const listeners = new Set<() => void>();
let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<void> | null = null;

/** Keyed by model id + kind + text, so switching models cannot mix vectors. */
const cache = new Map<string, Float32Array>();
const MAX_CACHE_ENTRIES = 2000;

function cacheKey(kind: 'query' | 'doc', text: string): string {
  return `${SEMANTIC_MODEL_ID}\u0000${kind}\u0000${text}`;
}

/**
 * Text as the model expects it. Retrieval-tuned models (arctic, bge, e5) were
 * trained with an instruction on the *query* side only; embedding a question
 * exactly like a passage measurably hurts recall.
 */
export function prefixedText(text: string, kind: 'query' | 'doc'): string {
  const prefix = kind === 'query' ? ACTIVE.queryPrefix : ACTIVE.docPrefix;
  return `${prefix}${text}`;
}

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

      extractor = (await pipeline('feature-extraction', ACTIVE.id, {
        device,
        dtype: ACTIVE.dtype,
        progress_callback: (event: { status?: string; progress?: number }) => {
          if (event.status === 'progress' && typeof event.progress === 'number') {
            notify({ progress: Math.min(0.99, Math.max(0, event.progress / 100)) });
          }
        },
      })) as FeatureExtractionPipeline;

      notify({
        status: 'ready',
        progress: 1,
        backend: useWebGPU ? 'webgpu' : 'wasm',
        model: activeModelSummary(),
      });
    } catch (error) {
      extractor = null;
      notify({
        status: 'failed',
        progress: 0,
        error:
          error instanceof Error
            ? `${ACTIVE.label}: ${error.message}`
            : `${ACTIVE.label} failed to load`,
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
async function embedPrefixed(
  texts: readonly string[],
  kind: 'query' | 'doc'
): Promise<Float32Array[] | null> {
  if (!extractor) return null;
  if (texts.length === 0) return [];

  const keys = texts.map((text) => cacheKey(kind, text));
  const missing = texts
    .map((text, index) => ({ text, key: keys[index] }))
    .filter((entry) => !cache.has(entry.key));

  if (missing.length > 0) {
    const output = await extractor(
      missing.map((entry) => prefixedText(entry.text, kind)),
      { pooling: 'mean', normalize: true }
    );
    const rows = output.tolist() as number[][];
    missing.forEach((entry, index) => {
      const vector = Float32Array.from(rows[index] ?? []);
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(entry.key, vector);
    });
  }

  return keys.map((key) => cache.get(key) ?? new Float32Array(SEMANTIC_DIMENSIONS));
}

/**
 * Embed a shopper's query. Applies the model's query prefix, which
 * retrieval-tuned models (arctic, bge, e5) were trained with — embedding a
 * question the same way as a document measurably hurts recall.
 */
export function embedQuery(text: string): Promise<Float32Array[] | null> {
  return embedPrefixed([text], 'query');
}

/** Embed documents/passages/titles. Applies the model's document prefix. */
export function embedDocuments(texts: readonly string[]): Promise<Float32Array[] | null> {
  return embedPrefixed(texts, 'doc');
}

/** @deprecated Prefer `embedDocuments`/`embedQuery` so prefixes are correct. */
export function embedTexts(texts: readonly string[]): Promise<Float32Array[] | null> {
  return embedPrefixed(texts, 'doc');
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
