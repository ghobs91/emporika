// ── Ranked-product projection tests ─────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { rankedProductToUnified } from '@/lib/ranked-products';
import type { NormalizedOffer, RankedProduct } from '@/search/types';

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    offerId: 'offer-1',
    providerId: 'bestbuy',
    providerProductId: 'b1',
    title: 'Test Product',
    condition: 'new',
    availability: 'in_stock',
    price: { amount: 100, currency: 'USD' },
    evidence: { fieldsProvided: ['title', 'price'], sourceSearches: ['test'] },
    uncertaintyFlags: [],
    ...overrides,
  };
}

function makeRanked(overrides: Partial<RankedProduct> = {}): RankedProduct {
  return {
    product: {
      canonicalId: 'cp-1',
      identity: { title: 'Test Product', confidence: 'high', matchMethod: 'unmatched' },
      title: 'Test Product',
      offers: [],
      sourceProviders: ['bestbuy'],
      sourceSearches: ['test'],
      matchedFeatures: [],
      missingData: [],
      warnings: [],
    },
    rank: 1,
    productScore: 0.5,
    alternateOffers: [],
    reasonsToChoose: [],
    tradeoffs: [],
    uncertaintyFlags: [],
    ...overrides,
  };
}

describe('rankedProductToUnified', () => {
  it('maps the best offer into filterable unified fields', () => {
    const ranked = makeRanked({
      product: {
        ...makeRanked().product,
        brand: 'Sony',
        category: 'Headphones',
        rating: 4.5,
        reviewCount: 120,
      },
      bestOffer: {
        offer: makeOffer({
          condition: 'refurbished',
          listPrice: { amount: 150, currency: 'USD' },
          fulfillment: { shippingCost: { amount: 0, currency: 'USD' } },
        }),
        offerScore: 1,
        reasonsToChoose: [],
        tradeoffs: [],
        uncertaintyFlags: [],
      },
    });

    const product = rankedProductToUnified(ranked);
    expect(product.brand).toBe('Sony');
    expect(product.category).toBe('Headphones');
    expect(product.condition).toBe('refurbished');
    expect(product.originalPrice).toBe(150);
    expect(product.freeShipping).toBe(true);
    expect(product.availableOnline).toBe(true);
    expect(product.customerRating).toBe(4.5);
    expect(product.reviewCount).toBe(120);
  });

  it('omits condition when the offer condition is unknown', () => {
    const ranked = makeRanked({
      bestOffer: {
        offer: makeOffer({ condition: 'unknown' }),
        offerScore: 1,
        reasonsToChoose: [],
        tradeoffs: [],
        uncertaintyFlags: [],
      },
    });
    expect(rankedProductToUnified(ranked).condition).toBeUndefined();
  });

  it('marks out-of-stock offers as not available online', () => {
    const ranked = makeRanked({
      bestOffer: {
        offer: makeOffer({ availability: 'out_of_stock' }),
        offerScore: 1,
        reasonsToChoose: [],
        tradeoffs: [],
        uncertaintyFlags: [],
      },
    });
    expect(rankedProductToUnified(ranked).availableOnline).toBe(false);
  });
});
