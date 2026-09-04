// ── Candidate normalization ─────────────────────────────────────────────
//
// Transforms ProviderProductCandidates from diverse providers into
// NormalizedOffer objects suitable for entity resolution and ranking.

import type {
  ProviderProductCandidate,
  NormalizedOffer,
  ProviderId,
} from './types';

let offerIdCounter = 0;

export function normalizeCandidate(
  candidate: ProviderProductCandidate,
  sourceSearch: string
): NormalizedOffer {
  const offerId = `offer-${candidate.providerId}-${++offerIdCounter}`;

  const fieldsProvided: string[] = [];
  if (candidate.title) fieldsProvided.push('title');
  if (candidate.price) fieldsProvided.push('price');
  if (candidate.listPrice) fieldsProvided.push('listPrice');
  if (candidate.imageUrls?.length) fieldsProvided.push('image');
  if (candidate.productUrl) fieldsProvided.push('url');
  if (candidate.brand) fieldsProvided.push('brand');
  if (candidate.description) fieldsProvided.push('description');
  if (candidate.availability && candidate.availability !== 'unknown') fieldsProvided.push('availability');
  if (candidate.condition && candidate.condition !== 'unknown') fieldsProvided.push('condition');
  if (candidate.seller) fieldsProvided.push('seller');
  if (candidate.fulfillment) fieldsProvided.push('fulfillment');
  if (candidate.returnPolicy) fieldsProvided.push('returnPolicy');
  if (candidate.categoryPath) fieldsProvided.push('categoryPath');

  // Detect uncertainty / missing data
  const uncertaintyFlags: string[] = [];
  if (!candidate.price) uncertaintyFlags.push('price_missing');
  if (!candidate.availability || candidate.availability === 'unknown') uncertaintyFlags.push('availability_unknown');
  if (!candidate.condition || candidate.condition === 'unknown') uncertaintyFlags.push('condition_unknown');
  if (!candidate.brand) uncertaintyFlags.push('brand_missing');
  if (!candidate.fulfillment?.shippingSupported && candidate.fulfillment?.shippingSupported !== false) {
    uncertaintyFlags.push('shipping_unverified');
  }
  if (candidate.providerId !== 'shopify' && !candidate.canonicalProductHints?.gtin && !candidate.canonicalProductHints?.upc) {
    uncertaintyFlags.push('no_gtin_upc');
  }

  // Carry identity hints forward for entity resolution (first values only).
  const hints = candidate.canonicalProductHints;
  const identityHints =
    hints || candidate.brand
      ? {
          ...(hints?.shopifyUpid ? { shopifyUpid: hints.shopifyUpid } : {}),
          ...(hints?.gtin?.[0] ? { gtin: hints.gtin[0] } : {}),
          ...(hints?.upc?.[0] ? { upc: hints.upc[0] } : {}),
          ...(hints?.ean?.[0] ? { ean: hints.ean[0] } : {}),
          ...(hints?.mpn?.[0] ? { mpn: hints.mpn[0] } : {}),
          ...(candidate.brand || hints?.brand ? { brand: candidate.brand ?? hints!.brand } : {}),
          ...(hints?.model ? { model: hints.model } : {}),
        }
      : undefined;

  return {
    offerId,
    providerId: candidate.providerId,
    providerProductId: candidate.providerProductId,
    providerOfferId: candidate.providerOfferId,
    productUrl: candidate.productUrl,
    title: candidate.title,
    condition: candidate.condition || 'unknown',
    identityHints,
    comparableVariant: candidate.variants?.[0] ? {
      id: candidate.variants[0].providerVariantId,
      selectedOptions: candidate.variants[0].selectedOptions || [],
      comparability: 'unknown',
    } : undefined,
    imageUrls: candidate.imageUrls,
    price: candidate.price,
    listPrice: candidate.listPrice,
    availability: candidate.availability || 'unknown',
    fulfillment: candidate.fulfillment,
    seller: candidate.seller,
    returnPolicy: candidate.returnPolicy,
    evidence: {
      fieldsProvided,
      sourceSearches: [sourceSearch, ...(candidate.sourceSearches || [])],
    },
    uncertaintyFlags,
  };
}

/**
 * Normalize a batch of candidates from a single provider search result.
 */
export function normalizeProviderResults(
  products: ProviderProductCandidate[],
  sourceSearch: string
): NormalizedOffer[] {
  return products.map(p => normalizeCandidate(p, sourceSearch));
}
