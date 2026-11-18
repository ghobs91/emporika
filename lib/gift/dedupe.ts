// ── Client-side deduplication ───────────────────────────────────────────
//
// The server already collapses exact duplicates by canonical id, but the same
// product routinely arrives under different titles from different intents
// ("Milwaukee 2606-20 Cordless Drill Driver" vs "Milwaukee M12 3/8\" Drill"),
// and near-identical marketplace listings differ only by seller noise.
//
// Everything here is string math on the card data — no network, no model.

import type { RankedProduct } from '@/search/types';

export interface Dedupeable {
  product: RankedProduct;
  /** Anything stable and unique for the listing (canonicalId by default). */
  key: string;
}

const NOISE_TOKENS = new Set([
  'new', 'sealed', 'genuine', 'oem', 'original', 'authentic', 'free', 'shipping',
  'with', 'and', 'for', 'the', 'a', 'an', 'of', 'in', 'on', 'by',
  'pack', 'set', 'pcs', 'pc', 'piece', 'count', 'ct',
]);

/** Strip marketplace noise and unit noise, keep product tokens. */
export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !NOISE_TOKENS.has(token) && !/^\d{1,2}x?$/.test(token));
}

/** Jaccard similarity over token sets, with containment credit. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a));
  const right = new Set(normalizeTitle(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;

  const union = left.size + right.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  const containment = shared / Math.min(left.size, right.size);

  // Short titles need stricter evidence: "drill" vs "drill" is not a duplicate.
  const weight = Math.min(left.size, right.size) < 3 ? 0.9 : 0.75;
  return Math.max(jaccard, containment * weight);
}

/** Similarity above which two listings are treated as the same gift. */
export const DUPLICATE_THRESHOLD = 0.82;

/** Identity keys that prove two listings are the same product. */
function identityKeys(product: RankedProduct): string[] {
  const identity = product.product.identity;
  return [identity.upc, identity.ean, identity.gtin, identity.mpn]
    .filter((value): value is string => typeof value === 'string' && value.length >= 6);
}

export interface DedupeResult<T extends Dedupeable> {
  kept: T[];
  removed: Array<{ item: T; duplicateOf: T; similarity: number }>;
}

/**
 * Remove near-duplicates, keeping the first (highest-ranked) occurrence.
 *
 * Exact identity matches (UPC/EAN/GTIN/MPN) win over title similarity, which is
 * why both checks run: identity is cheap and definitive, titles are the fallback
 * for marketplace listings with no structured identity.
 */
export function dedupeListings<T extends Dedupeable>(items: T[]): DedupeResult<T> {
  const kept: T[] = [];
  const removed: DedupeResult<T>['removed'] = [];
  const seenIdentity = new Map<string, T>();

  for (const item of items) {
    const identities = identityKeys(item.product);
    const identityHit = identities.find((key) => seenIdentity.has(key));
    if (identityHit) {
      removed.push({ item, duplicateOf: seenIdentity.get(identityHit)!, similarity: 1 });
      continue;
    }

    let duplicateOf: T | undefined;
    let similarity = 0;
    for (const candidate of kept) {
      const score = titleSimilarity(item.product.product.title, candidate.product.product.title);
      if (score >= DUPLICATE_THRESHOLD) {
        duplicateOf = candidate;
        similarity = score;
        break;
      }
    }

    if (duplicateOf) {
      removed.push({ item, duplicateOf, similarity });
      continue;
    }

    kept.push(item);
    for (const identity of identities) seenIdentity.set(identity, item);
  }

  return { kept, removed };
}
