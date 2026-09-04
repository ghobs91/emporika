// ── Ranking engine tests ────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { rankProducts, toWireResults } from '@/search/ranker';
import type { CanonicalProduct, SearchPlan, NormalizedOffer } from '@/search/types';

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    offerId: `offer-${Math.random()}`,
    providerId: 'walmart',
    providerProductId: '123',
    title: 'Test Product',
    condition: 'new',
    availability: 'in_stock',
    price: { amount: 49.99, currency: 'USD' },
    evidence: {
      fieldsProvided: ['title', 'price', 'availability'],
      sourceSearches: ['test shoes'],
    },
    uncertaintyFlags: [],
    ...overrides,
  };
}

function makeProduct(offers: NormalizedOffer[]): CanonicalProduct {
  return {
    canonicalId: 'cp-test',
    identity: {
      title: 'Test Product',
      confidence: 'high',
      matchMethod: 'gtin',
    },
    title: 'Test Product',
    offers,
    sourceProviders: ['walmart'],
    sourceSearches: ['test shoes'],
    matchedFeatures: [],
    missingData: [],
    warnings: [],
  };
}

const basePlan: SearchPlan = {
  version: '1',
  canonicalIntent: 'test',
  searches: [{ query: 'test', purpose: 'broad' }],
  sourceStrategy: { searchMode: 'all_eligible' },
  hardFilters: {},
  ranking: [
    { criterion: 'price', weight: 0.4 },
    { criterion: 'availability', weight: 0.3 },
    { criterion: 'condition', weight: 0.3 },
  ],
  confidence: 1,
};

describe('Ranking engine', () => {
  it('ranks products by score descending', () => {
    const productA = makeProduct([makeOffer({ price: { amount: 10, currency: 'USD' } })]);
    const productB = makeProduct([makeOffer({ price: { amount: 100, currency: 'USD' } })]);

    const ranked = rankProducts([productB, productA], basePlan);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].productScore).toBeGreaterThanOrEqual(ranked[1].productScore);
  });

  it('penalizes missing price data', () => {
    const withPrice = makeProduct([makeOffer({ price: { amount: 50, currency: 'USD' } })]);
    const withoutPrice = makeProduct([makeOffer({ price: undefined })]);

    const ranked = rankProducts([withPrice, withoutPrice], basePlan);
    expect(ranked[0].product).toBe(withPrice);
  });

  it('rewards in-stock over out-of-stock', () => {
    const inStock = makeProduct([makeOffer({ availability: 'in_stock' })]);
    const outOfStock = makeProduct([makeOffer({ availability: 'out_of_stock' })]);

    const ranked = rankProducts([outOfStock, inStock], basePlan);
    expect(ranked[0].product).toBe(inStock);
  });

  it('rewards new condition over used by default', () => {
    const newItem = makeProduct([makeOffer({ condition: 'new' })]);
    const usedItem = makeProduct([makeOffer({ condition: 'used' })]);

    const ranked = rankProducts([usedItem, newItem], basePlan);
    expect(ranked[0].product).toBe(newItem);
  });

  it('ranks by landed cost (price + shipping), not sticker price', () => {
    const cheapPlusShip = makeProduct([
      makeOffer({
        price: { amount: 90, currency: 'USD' },
        fulfillment: { shippingSupported: true, shippingCost: { amount: 20, currency: 'USD' } },
      }),
    ]);
    const flatHundred = makeProduct([
      makeOffer({
        price: { amount: 100, currency: 'USD' },
        fulfillment: { shippingSupported: true, shippingCost: { amount: 0, currency: 'USD' } },
      }),
    ]);

    const ranked = rankProducts([cheapPlusShip, flatHundred], basePlan);
    expect(ranked[0].product).toBe(flatHundred);
  });

  it('scores prices above $1000 on a sane bounded curve', () => {
    const mid = makeProduct([makeOffer({ price: { amount: 1200, currency: 'USD' } })]);
    const high = makeProduct([makeOffer({ price: { amount: 2500, currency: 'USD' } })]);

    const ranked = rankProducts([high, mid], basePlan);
    expect(ranked[0].product).toBe(mid);
    expect(ranked[0].productScore).toBeGreaterThan(0);
    expect(ranked[1].productScore).toBeGreaterThan(0);
  });

  it('treats unknown shipping as sticker price (no penalty, no bonus)', () => {
    const withShip = makeProduct([
      makeOffer({
        price: { amount: 100, currency: 'USD' },
        fulfillment: { shippingSupported: true, shippingCost: { amount: 10, currency: 'USD' } },
      }),
    ]);
    const unknownShip = makeProduct([
      makeOffer({
        price: { amount: 100, currency: 'USD' },
        fulfillment: { shippingSupported: true },
      }),
    ]);

    const ranked = rankProducts([withShip, unknownShip], basePlan);
    expect(ranked[0].product).toBe(unknownShip);
  });

  it('produces deterministic results', () => {
    const offers = [makeOffer(), makeOffer({ providerId: 'bestbuy' })];
    const product = makeProduct(offers);

    const result1 = rankProducts([product], basePlan);
    const result2 = rankProducts([product], basePlan);

    expect(result1[0].productScore).toBe(result2[0].productScore);
  });

  it('provides score breakdown for every product', () => {
    const product = makeProduct([makeOffer()]);
    const ranked = rankProducts([product], basePlan);

    expect(ranked[0].scoreBreakdown?.length ?? 0).toBeGreaterThan(0);
    expect((ranked[0].scoreBreakdown ?? []).every(b => typeof b.weightedContribution === 'number')).toBe(true);
  });
});

describe('toWireResults', () => {
  it('strips score breakdowns but preserves everything else', () => {
    const product = makeProduct([makeOffer(), makeOffer({ providerId: 'bestbuy' })]);
    const ranked = rankProducts([product], basePlan);

    const wire = toWireResults(ranked);

    expect(wire).toHaveLength(1);
    expect(wire[0].scoreBreakdown).toBeUndefined();
    expect(wire[0].bestOffer?.scoreBreakdown).toBeUndefined();
    for (const alt of wire[0].alternateOffers) {
      expect(alt.scoreBreakdown).toBeUndefined();
    }

    // Core fields survive
    expect(wire[0].rank).toBe(1);
    expect(wire[0].product.canonicalId).toBe('cp-test');
    expect(wire[0].bestOffer?.offer.providerId).toBeDefined();
    expect(wire[0].alternateOffers).toHaveLength(1);
  });

  it('does not mutate the input ranked list', () => {
    const product = makeProduct([makeOffer()]);
    const ranked = rankProducts([product], basePlan);

    toWireResults(ranked);

    expect(ranked[0].scoreBreakdown?.length).toBeGreaterThan(0);
    expect(ranked[0].bestOffer?.scoreBreakdown?.length).toBeGreaterThan(0);
  });
});
