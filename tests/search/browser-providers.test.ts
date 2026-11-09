import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROVIDER_IDS,
  browserProviderPayloadSchema,
  browserResultsSchema,
  isBrowserProvider,
  toProviderSearchResults,
} from '@/search/browser-providers';
import { buildSearchCacheKey } from '@/search/cache';

// ── Fixtures ───────────────────────────────────────────────────────────

const backMarketPayload = {
  providerId: 'backmarket' as const,
  query: 'iphone 15',
  products: [
    {
      providerProductId: '76c5d05a-79cc-42ed-91e4-7d35c710a85b',
      title: 'iPhone 15 • Unlocked',
      brand: 'Apple',
      model: 'iphone 15',
      price: { amount: 264, currency: 'USD' },
      listPrice: { amount: 629, currency: 'USD' },
      condition: 'refurbished' as const,
      conditionLabel: 'Fair',
      productUrl: 'https://www.backmarket.com/en-us/p/iphone-15/76c5d05a',
      imageUrls: ['https://d2e6ccujb3mkqf.cloudfront.net/a.jpg'],
      rating: 4.46,
      reviewCount: 4302,
      seller: { name: 'Refurb World' },
      category: 'Smartphones',
      availability: 'in_stock' as const,
    },
  ],
  partial: false,
  latencyMs: 890,
};

const results = () =>
  browserResultsSchema.parse({ providers: { backmarket: backMarketPayload } });

// ── Identity ───────────────────────────────────────────────────────────

describe('browser provider identity', () => {
  it('exposes exactly the browser-collected providers', () => {
    expect(BROWSER_PROVIDER_IDS).toEqual(['backmarket']);
  });

  it('narrows browser providers and rejects API-backed ones', () => {
    expect(isBrowserProvider('backmarket')).toBe(true);
    expect(isBrowserProvider('walmart')).toBe(false);
  });
});

// ── Schema: what the extension is allowed to send ──────────────────────

describe('browserProviderPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(browserProviderPayloadSchema.safeParse(backMarketPayload).success).toBe(true);
  });

  it('rejects a non-http product URL', () => {
    const bad = {
      ...backMarketPayload,
      products: [{ ...backMarketPayload.products[0], productUrl: 'javascript:alert(1)' }],
    };
    expect(browserProviderPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    const bad = { ...backMarketPayload, injected: true };
    expect(browserProviderPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a provider id that is not browser-collected', () => {
    const bad = { ...backMarketPayload, providerId: 'walmart' };
    expect(browserProviderPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-range rating', () => {
    const bad = {
      ...backMarketPayload,
      products: [{ ...backMarketPayload.products[0], rating: 11 }],
    };
    expect(browserProviderPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects more products than the cap', () => {
    const bad = {
      ...backMarketPayload,
      products: Array.from({ length: 51 }, (_, i) => ({
        ...backMarketPayload.products[0],
        providerProductId: `product-${i}`,
      })),
    };
    expect(browserProviderPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an error payload with no products', () => {
    const parsed = browserProviderPayloadSchema.safeParse({
      providerId: 'backmarket',
      query: 'iphone 15',
      products: [],
      error: 'Back Market returned HTTP 403 (bot challenge)',
    });
    expect(parsed.success).toBe(true);
  });
});

// ── Payload → pipeline candidates ──────────────────────────────────────

describe('toProviderSearchResults', () => {
  it('maps the payload into a provider search result', () => {
    const mapped = toProviderSearchResults(results());
    expect(mapped.backmarket?.products).toHaveLength(1);
    expect(mapped.backmarket?.products[0].providerId).toBe('backmarket');
  });

  it('preserves retailer-carried condition instead of inferring it', () => {
    const mapped = toProviderSearchResults(results());
    expect(mapped.backmarket?.products[0].condition).toBe('refurbished');
  });

  it('carries brand, seller type and review data', () => {
    const product = toProviderSearchResults(results()).backmarket?.products[0];
    expect(product?.brand).toBe('Apple');
    expect(product?.seller).toEqual({ name: 'Refurb World', type: 'marketplace_seller' });
    expect(product?.reviewCount).toBe(4302);
    expect(product?.listPrice?.amount).toBe(629);
  });

  it('passes the manufacturer model through for entity resolution', () => {
    const product = toProviderSearchResults(results()).backmarket?.products[0];
    expect(product?.canonicalProductHints).toEqual({ brand: 'Apple', model: 'iphone 15' });
  });

  it('reports what the extension could not observe, never a fabricated true', () => {
    const missingImage = browserResultsSchema.parse({
      providers: {
        backmarket: {
          ...backMarketPayload,
          products: [{ ...backMarketPayload.products[0], imageUrls: [], rating: undefined, reviewCount: undefined, seller: undefined }],
        },
      },
    });
    const product = toProviderSearchResults(missingImage).backmarket?.products[0];
    expect(product?.rawFieldAvailability).toMatchObject({
      name: true,
      price: true,
      image: false,
      rating: false,
      reviews: false,
      seller: false,
      description: false,
      shipping: false,
    });
  });

  it('reports unsupported hard filters rather than pretending they applied', () => {
    const mapped = toProviderSearchResults(results());
    expect(mapped.backmarket?.metadata.unsupportedFilters).toContain('maxPrice');
    expect(mapped.backmarket?.metadata.appliedFilters).toEqual(['keyword']);
    expect(mapped.backmarket?.metadata.latencyMs).toBe(890);
  });

  it('marks a provider that errored as partial, keeping its warning', () => {
    const errored = browserResultsSchema.parse({
      providers: {
        backmarket: {
          providerId: 'backmarket',
          query: 'iphone 15',
          products: [],
          error: 'Back Market returned HTTP 403 (bot challenge)',
        },
      },
    });
    const mapped = toProviderSearchResults(errored);
    expect(mapped.backmarket?.partial).toBe(true);
    expect(mapped.backmarket?.warnings).toContain('Back Market returned HTTP 403 (bot challenge)');
    expect(mapped.backmarket?.products).toEqual([]);
  });

  it('warns when a provider returns nothing without erroring', () => {
    const empty = browserResultsSchema.parse({
      providers: {
        backmarket: { providerId: 'backmarket', query: 'iphone 15', products: [] },
      },
    });
    expect(toProviderSearchResults(empty).backmarket?.warnings)
      .toContain('Extension returned no listings');
  });
});

// ── Result cache isolation ─────────────────────────────────────────────

describe('result cache key', () => {
  const withProduct = (productId: string) =>
    browserResultsSchema.parse({
      providers: {
        backmarket: {
          ...backMarketPayload,
          products: [{ ...backMarketPayload.products[0], providerProductId: productId }],
        },
      },
    });

  it('never serves a browser-sourced response to a request without one', () => {
    const plain = buildSearchCacheKey({ query: 'iphone 15' });
    const browser = buildSearchCacheKey({
      query: 'iphone 15',
      browserResults: withProduct('a'),
    });
    expect(browser).not.toBe(plain);
  });

  it('keys on the provider set, not on the listings themselves', () => {
    const first = buildSearchCacheKey({ query: 'iphone 15', browserResults: withProduct('a') });
    const second = buildSearchCacheKey({ query: 'iphone 15', browserResults: withProduct('b') });
    expect(second).toBe(first);
  });
});
