// ── Browser-supplied providers (Back Market) ───────────────────────────
//
// Back Market exposes no public search API, and the architecture is
// deliberately server-browser-free: the fetch happens in the *user's* own
// browser via the extension in `extension/`, and the resulting listings are
// posted back to /api/search.
//
// The server then treats them as ordinary provider results — they go through
// the same normalize → entity-resolution → filter → rank pipeline as every
// API-backed provider. Ranking never moves to the client.
//
// This module is the trust boundary: the extension runs on the user's
// machine, so nothing it sends is trusted. Everything is Zod-validated here
// before it can influence a result set.

import { z } from 'zod';
import type {
  ProviderId,
  ProviderProductCandidate,
  ProviderSearchResult,
} from './types';

// ── Provider identity ──────────────────────────────────────────────────

/** Providers whose data can only be collected in the browser. */
export const BROWSER_PROVIDER_IDS = ['backmarket'] as const;

export type BrowserProviderId = (typeof BROWSER_PROVIDER_IDS)[number];

/** Narrowing guard — use this before handing an id to a server adapter. */
export function isBrowserProvider(id: ProviderId): id is BrowserProviderId {
  return (BROWSER_PROVIDER_IDS as readonly ProviderId[]).includes(id);
}

// ── Wire schemas (what the extension is allowed to send) ───────────────

const moneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.string().min(1).max(8),
});

const httpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

const browserProductSchema = z
  .object({
    providerProductId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    brand: z.string().min(1).max(200).optional(),
    /** Manufacturer model, used for cross-retailer entity resolution. */
    model: z.string().min(1).max(200).optional(),
    price: moneySchema,
    listPrice: moneySchema.optional(),
    // Refurbished / used are carried explicitly by the extension rather than
    // inferred per grade, so the facet counts stay honest.
    condition: z.enum(['new', 'used', 'refurbished', 'open_box', 'unknown']),
    /** Retailer's own grade label ("Premium", "Good", "Mint") — descriptive only. */
    conditionLabel: z.string().min(1).max(100).optional(),
    productUrl: httpUrlSchema,
    imageUrls: z.array(httpUrlSchema).max(10).default([]),
    rating: z.number().finite().min(0).max(5).optional(),
    reviewCount: z.number().int().nonnegative().max(10_000_000).optional(),
    seller: z.object({ name: z.string().min(1).max(200) }).optional(),
    category: z.string().min(1).max(200).optional(),
    availability: z.enum(['in_stock', 'out_of_stock', 'limited', 'unknown']),
    attributes: z
      .object({
        storage: z.string().max(50).optional(),
        carrier: z.string().max(50).optional(),
      })
      .optional(),
  })
  .strict();

export const browserProviderPayloadSchema = z
  .object({
    providerId: z.enum(BROWSER_PROVIDER_IDS),
    query: z.string().min(1).max(300),
    products: z.array(browserProductSchema).max(50).default([]),
    partial: z.boolean().optional(),
    warnings: z.array(z.string().max(500)).max(20).optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    /** Present when the extension's fetch failed for this provider. */
    error: z.string().max(500).optional(),
  })
  .strict();

export const browserResultsSchema = z
  .object({
    providers: z.record(z.string().max(40), browserProviderPayloadSchema),
  })
  .strict();

export type BrowserProviderPayload = z.infer<typeof browserProviderPayloadSchema>;
export type BrowserResults = z.infer<typeof browserResultsSchema>;

// ── Payload → pipeline candidates ──────────────────────────────────────

function toCandidate(
  providerId: BrowserProviderId,
  product: BrowserProviderPayload['products'][number],
  query: string
): ProviderProductCandidate {
  return {
    providerId,
    providerProductId: product.providerProductId,
    // Back Market exposes the manufacturer model, which lets entity
    // resolution join these listings to the same device elsewhere.
    canonicalProductHints: product.model || product.brand
      ? { brand: product.brand, model: product.model }
      : undefined,
    title: product.title,
    brand: product.brand,
    categoryPath: product.category ? [product.category] : undefined,
    imageUrls: product.imageUrls,
    productUrl: product.productUrl,
    price: product.price,
    listPrice: product.listPrice,
    condition: product.condition,
    availability: product.availability,
    rating: product.rating,
    reviewCount: product.reviewCount,
    seller: product.seller
      ? { name: product.seller.name, type: 'marketplace_seller' }
      : undefined,
    // Never assert what the extension could not actually observe.
    rawFieldAvailability: {
      name: true,
      price: true,
      image: product.imageUrls.length > 0,
      url: true,
      brand: Boolean(product.brand),
      rating: product.rating !== undefined,
      reviews: product.reviewCount !== undefined,
      condition: true,
      seller: Boolean(product.seller),
      description: false,
      shipping: false,
    },
    sourceSearches: [query],
  };
}

/**
 * Convert a validated extension payload into `ProviderSearchResult`s the
 * orchestrator can merge as pre-supplied results.
 *
 * Unsupported hard filters are reported, never silently applied — the same
 * contract the API-backed adapters follow.
 */
export function toProviderSearchResults(
  results: BrowserResults
): Partial<Record<BrowserProviderId, ProviderSearchResult>> {
  const mapped: Partial<Record<BrowserProviderId, ProviderSearchResult>> = {};

  for (const payload of Object.values(results.providers)) {
    if (!payload.providerId) continue;

    const warnings = [...(payload.warnings ?? [])];
    if (payload.error) warnings.push(payload.error);
    if (!payload.products.length && !warnings.length) {
      warnings.push('Extension returned no listings');
    }

    mapped[payload.providerId] = {
      providerId: payload.providerId,
      query: payload.query,
      products: payload.products.map((product) =>
        toCandidate(payload.providerId, product, payload.query)
      ),
      warnings,
      // A provider that errored contributes nothing; mark the result partial
      // so the response advertises degraded coverage instead of pretending
      // "no matches".
      partial: payload.partial === true || Boolean(payload.error),
      metadata: {
        receivedAt: new Date().toISOString(),
        latencyMs: Math.round(payload.latencyMs ?? 0),
        resultCount: payload.products.length,
        appliedFilters: ['keyword'],
        unsupportedFilters: [
          'minPrice',
          'maxPrice',
          'preferredBrands',
          'excludedBrands',
          'destination',
          'availabilityRequired',
        ],
      },
    };
  }

  return mapped;
}
