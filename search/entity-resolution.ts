// ── Cross-retailer entity resolution ────────────────────────────────────
//
// Groups NormalizedOffer objects into CanonicalProducts by matching
// product identities across different retailers.

import type {
  CanonicalProduct,
  NormalizedOffer,
  ProviderId,
} from './types';

// ── Normalization helpers ──────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBrand(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function normalizeMpn(mpn: string): string {
  return mpn.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Token-based title similarity (Jaccard-like, simplified).
 * Returns a score between 0 and 1.
 */
function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeTitle(a).split(/\s+/).filter(t => t.length > 1));
  const tokensB = new Set(normalizeTitle(b).split(/\s+/).filter(t => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

// ── Identifier extraction ──────────────────────────────────────────────

interface OfferIdentity {
  offer: NormalizedOffer;
  gtin?: string;
  upc?: string;
  ean?: string;
  mpn?: string;
  brand?: string;
  model?: string;
  shopifyUpid?: string;
  normalizedTitle: string;
}

function extractIdentity(offer: NormalizedOffer): OfferIdentity {
  // ProviderProductCandidate includes canonicalProductHints;
  // we store those hints on the offer via evidence, so we extract from
  // the underlying provider product ID structure.
  return {
    offer,
    normalizedTitle: normalizeTitle(offer.title),
  };
}

// ── Main entity resolution ─────────────────────────────────────────────

/**
 * Group a flat list of normalized offers into canonical products.
 *
 * Resolution strategy (in priority order):
 * 1. Shopify UPID — within Shopify, use UPID as primary grouping key
 * 2. Exact GTIN match
 * 3. Exact UPC match
 * 4. Exact EAN match
 * 5. Exact MPN + normalized brand + model match
 * 6. Normalized title similarity (lower confidence, only if > 0.75 threshold)
 *
 * Never merges different generations, model years, sizes, variants, conditions.
 */
export function resolveEntities(
  offers: NormalizedOffer[]
): CanonicalProduct[] {
  if (offers.length === 0) return [];

  // ── Pass 1: Build identity lookup for each offer ──────────────────────
  // We extract identifiers from the offer's evidence and provider-specific
  // fields. For this implementation, we work with the evidence fields provided.

  // ── Pass 2: Cluster by matching strategy ──────────────────────────────

  const used = new Set<number>();
  const products: CanonicalProduct[] = [];
  let canonicalIdCounter = 0;

  for (let i = 0; i < offers.length; i++) {
    if (used.has(i)) continue;

    const cluster: NormalizedOffer[] = [offers[i]];
    used.add(i);
    // Method/confidence of the first successful join into this cluster.
    let clusterMethod: CanonicalProduct['identity']['matchMethod'] = 'unmatched';
    let clusterConfidence: 'high' | 'medium' | 'low' = 'high';

    for (let j = i + 1; j < offers.length; j++) {
      if (used.has(j)) continue;

      const matchResult = matchOffers(offers[i], offers[j]);
      if (matchResult.matched) {
        if (cluster.length === 1) {
          clusterMethod = matchResult.method;
          clusterConfidence = matchResult.confidence;
        }
        cluster.push(offers[j]);
        used.add(j);
      }
    }

    products.push(buildCanonicalProduct(cluster, ++canonicalIdCounter, offers[i], clusterMethod, clusterConfidence));
  }

  return products;
}

interface MatchResult {
  matched: boolean;
  method: CanonicalProduct['identity']['matchMethod'];
  confidence: 'high' | 'medium' | 'low';
}

function matchOffers(a: NormalizedOffer, b: NormalizedOffer): MatchResult {
  // Same provider same product — auto-match
  if (a.providerId === b.providerId && a.providerProductId === b.providerProductId) {
    return { matched: true, method: 'shopify_upid', confidence: 'high' };
  }

  const ha = a.identityHints ?? {};
  const hb = b.identityHints ?? {};

  const sameId = (x?: string, y?: string) =>
    !!x && !!y && x.trim().toLowerCase() === y.trim().toLowerCase();

  // Shopify UPID: same product across variant-level offers
  if (sameId(ha.shopifyUpid, hb.shopifyUpid)) {
    return { matched: true, method: 'shopify_upid', confidence: 'high' };
  }

  // Exact GTIN / UPC / EAN matches are high-confidence cross-retailer identity
  if (sameId(ha.gtin, hb.gtin)) {
    return { matched: true, method: 'gtin', confidence: 'high' };
  }
  if (sameId(ha.upc, hb.upc)) {
    return { matched: true, method: 'upc', confidence: 'high' };
  }
  if (sameId(ha.ean, hb.ean)) {
    return { matched: true, method: 'ean', confidence: 'high' };
  }

  // MPN match requires brand agreement (MPNs are only unique per brand)
  if (
    sameId(ha.mpn, hb.mpn) &&
    ha.brand !== undefined && hb.brand !== undefined &&
    normalizeBrand(ha.brand) === normalizeBrand(hb.brand)
  ) {
    return { matched: true, method: 'mpn_brand_model', confidence: 'high' };
  }

  // ── Title-similarity fallback with vetoes ────────────────────────────

  // Brand veto: both brands known and different → different products,
  // no matter how similar the titles ("Sony headphones" vs "Bose headphones").
  if (
    ha.brand !== undefined && hb.brand !== undefined &&
    normalizeBrand(ha.brand) !== normalizeBrand(hb.brand)
  ) {
    return { matched: false, method: 'unmatched', confidence: 'low' };
  }

  // Identical modulo punctuation/spacing/case ("WH-1000XM5" vs "WH1000XM5",
  // "128 GB" vs "128GB") — same product even when token sets differ.
  const alnum = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (alnum(a.title) === alnum(b.title)) {
    return { matched: true, method: 'normalized_title', confidence: 'medium' };
  }

  // Model-token veto: both titles carry model-like tokens (letters+digits,
  // e.g. XM4/XM5, 128GB/256GB) with no overlap → different generations or
  // variants of the same family. Never merge those.
  const modelsA = modelTokens(a.title);
  const modelsB = modelTokens(b.title);
  if (modelsA.size > 0 && modelsB.size > 0) {
    let overlap = false;
    for (const t of modelsA) {
      if (modelsB.has(t)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      return { matched: false, method: 'unmatched', confidence: 'low' };
    }
  }

  const sim = titleSimilarity(a.title, b.title);

  if (sim > 0.90) {
    return { matched: true, method: 'normalized_title', confidence: 'medium' };
  }

  if (sim > 0.75) {
    return { matched: true, method: 'normalized_title', confidence: 'low' };
  }

  return { matched: false, method: 'unmatched', confidence: 'low' };
}

/**
 * Model-like tokens: contain both letters and digits (XM5, 1000XM4, 128GB,
 * 55IN). Compared after stripping non-alphanumerics so "WH-1000XM5" and
 * "WH1000XM5" still agree.
 */
function modelTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    if (raw.length >= 3 && /[a-z]/.test(raw) && /\d/.test(raw)) {
      tokens.add(raw);
    }
  }
  return tokens;
}

// ── Canonical product builder ──────────────────────────────────────────

function buildCanonicalProduct(
  offers: NormalizedOffer[],
  index: number,
  primaryOffer: NormalizedOffer,
  matchMethod: CanonicalProduct['identity']['matchMethod'],
  matchConfidence: 'high' | 'medium' | 'low'
): CanonicalProduct {
  const sourceProviders = [...new Set(offers.map(o => o.providerId))];
  const sourceSearches = [...new Set(offers.flatMap(o => o.evidence.sourceSearches))];

  // Canonical identity comes from the primary offer's hints (falling back
  // to the first defined value in the cluster). This also powers
  // brand-exclusion filtering downstream — previously always undefined.
  const primaryHints = primaryOffer.identityHints ?? {};
  const firstHint = (key: 'gtin' | 'upc' | 'ean' | 'mpn' | 'brand' | 'model') =>
    primaryHints[key] ?? offers.map(o => o.identityHints?.[key]).find(v => v !== undefined);

  // Collect unique warnings / missing data
  const warnings = [...new Set(offers.flatMap(o => {
    const w: string[] = [];
    if (o.uncertaintyFlags.includes('price_missing')) w.push('Price missing for some offers');
    if (o.uncertaintyFlags.includes('availability_unknown')) w.push('Availability unverified for some offers');
    if (o.uncertaintyFlags.includes('shipping_unverified')) w.push('Shipping data incomplete');
    return w;
  }))];

  const missingData = offers.flatMap(o => o.uncertaintyFlags);

  // Best images from any offer
  const imageUrls = offers
    .flatMap(o => o.imageUrls || [])
    .filter(Boolean) as string[];

  return {
    canonicalId: `cp-${index}`,
    identity: {
      gtin: firstHint('gtin'),
      upc: firstHint('upc'),
      ean: firstHint('ean'),
      mpn: firstHint('mpn'),
      brand: firstHint('brand'),
      model: firstHint('model'),
      title: primaryOffer.title,
      confidence: matchConfidence,
      matchMethod,
    },
    title: primaryOffer.title,
    description: undefined,
    brand: firstHint('brand'),
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    offers,
    sourceProviders,
    sourceSearches,
    matchedFeatures: [],
    missingData: [...new Set(missingData)],
    warnings,
  };
}
