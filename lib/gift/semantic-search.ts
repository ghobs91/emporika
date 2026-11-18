'use client';

// ── Semantic intent matching + product reranking (client) ───────────────
//
// Two uses of the local embedding model:
//   1. free text → the best-matching gift intents that the profile did not
//      already select (so "cozy baking afternoon" adds baking searches);
//   2. free text → per-product similarity, fed into the client ranker.
//
// Both degrade to `tokenSimilarity` when the model is unavailable, so the
// feature is additive rather than load-bearing.

import type { RankedProduct } from '@/search/types';
import { giftCorpus, type CorpusEntry } from './corpus';
import { cosineSimilarity, embedTexts, isSemanticReady, tokenSimilarity } from './semantic';

export interface CorpusMatch {
  entry: CorpusEntry;
  /** 0–1 similarity. */
  similarity: number;
}

/** Text embedded for a product: title carries most of the signal. */
function productText(product: RankedProduct): string {
  return `${product.product.title}${product.product.category ? ` ${product.product.category}` : ''}`;
}

/**
 * Rank the corpus against a free-text query.
 *
 * `excludeIds` are intents already selected by the brief (no point searching
 * them twice); `excludeQueries` catches the same query reached by another path.
 */
export async function matchCorpus(
  queryText: string,
  options: {
    excludeIds?: ReadonlySet<string>;
    excludeQueries?: ReadonlySet<string>;
    limit?: number;
    /** Minimum similarity to be worth an extra search. */
    threshold?: number;
  } = {}
): Promise<CorpusMatch[]> {
  const text = queryText.trim();
  if (text.length < 3) return [];

  const entries = giftCorpus();
  const excludeIds = options.excludeIds ?? new Set<string>();
  const excludeQueries = options.excludeQueries ?? new Set<string>();
  const limit = options.limit ?? 2;
  const threshold = options.threshold ?? 0.32;

  const candidates = entries.filter(
    (entry) =>
      !excludeIds.has(entry.id) && !excludeQueries.has(entry.query.trim().toLowerCase())
  );
  if (candidates.length === 0) return [];

  if (isSemanticReady()) {
    const vectors = await embedTexts([text, ...candidates.map((entry) => entry.text)]);
    if (vectors) {
      const queryVector = vectors[0];
      const scored = candidates.map((entry, index) => ({
        entry,
        similarity: cosineSimilarity(queryVector, vectors[index + 1]),
      }));
      return scored
        .filter((match) => match.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((match) => ({ ...match, similarity: Math.max(0, Math.min(1, match.similarity)) }));
    }
  }

  // Fallback: lexical overlap, deliberately stricter so it cannot spam searches.
  return candidates
    .map((entry) => ({ entry, similarity: tokenSimilarity(text, entry.text) }))
    .filter((match) => match.similarity >= 0.4)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Embed product titles for the ranker. Returns `null` when semantic search is
 * off, which the ranker treats as "neutral", not "zero".
 */
export async function embedProducts(
  products: RankedProduct[]
): Promise<Map<string, Float32Array> | null> {
  if (!isSemanticReady() || products.length === 0) return null;

  const vectors = await embedTexts(products.map(productText));
  if (!vectors) return null;

  const map = new Map<string, Float32Array>();
  products.forEach((product, index) => {
    map.set(product.product.canonicalId, vectors[index]);
  });
  return map;
}

/** Embed the shopper's free-text query. */
export async function embedQuery(queryText: string): Promise<Float32Array | null> {
  if (!isSemanticReady() || queryText.trim().length < 3) return null;
  const vectors = await embedTexts([queryText.trim()]);
  return vectors?.[0] ?? null;
}
