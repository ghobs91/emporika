// ── Result filters surfaced in the shop.app-style filter panel ──────────
// The panel exposes boolean quick toggles (on sale / free shipping / in
// stock / has reviews) alongside the existing facet filters, so both the
// filtering predicate and the "N active" badge need coverage.

import { describe, it, expect } from 'vitest';
import {
  countActiveFilters,
  matchesProductFilters,
  RATING_PILLS,
  type ProductFilters,
} from '@/lib/filters';
import type { UnifiedProduct } from '@/types/unified';

function makeProduct(overrides: Partial<UnifiedProduct> = {}): UnifiedProduct {
  return {
    id: 'p1',
    name: 'Apple Mac mini M4',
    price: 599,
    image: '/mac-mini.png',
    productUrl: 'https://example.com/p1',
    source: 'bestbuy',
    ...overrides,
  };
}

describe('countActiveFilters', () => {
  it('is zero when nothing is selected', () => {
    expect(countActiveFilters({})).toBe(0);
  });

  it('counts the quick toggles once each', () => {
    expect(
      countActiveFilters({
        onSale: true,
        freeShipping: true,
        availableOnline: true,
        hasReviews: true,
      })
    ).toBe(4);
  });

  it('counts each selected facet value', () => {
    const filters: ProductFilters = {
      categories: ['Laptops', 'Desktops'],
      brands: ['Apple'],
      minPrice: 100,
      maxPrice: 900,
    };
    // 2 categories + 1 brand + 1 price range
    expect(countActiveFilters(filters)).toBe(4);
  });
});

describe('matchesProductFilters boolean quick toggles', () => {
  it('onSale keeps discounted products only', () => {
    const discounted = makeProduct({ price: 499, originalPrice: 599 });
    const fullPrice = makeProduct({ price: 599 });
    expect(matchesProductFilters(discounted, { onSale: true })).toBe(true);
    expect(matchesProductFilters(fullPrice, { onSale: true })).toBe(false);
  });

  it('availableOnline drops items flagged as unavailable', () => {
    expect(matchesProductFilters(makeProduct({ availableOnline: false }), { availableOnline: true })).toBe(false);
    expect(matchesProductFilters(makeProduct({ availableOnline: true }), { availableOnline: true })).toBe(true);
    // Unknown availability is not treated as unavailable.
    expect(matchesProductFilters(makeProduct(), { availableOnline: true })).toBe(true);
  });

  it('hasReviews requires at least one review', () => {
    expect(matchesProductFilters(makeProduct({ reviewCount: 0 }), { hasReviews: true })).toBe(false);
    expect(matchesProductFilters(makeProduct({ reviewCount: 12 }), { hasReviews: true })).toBe(true);
  });

  it('freeShipping accepts either the flat flag or the shipping detail', () => {
    expect(matchesProductFilters(makeProduct({ freeShipping: true }), { freeShipping: true })).toBe(true);
    expect(
      matchesProductFilters(makeProduct({ shipping: { freeShipping: true } }), { freeShipping: true })
    ).toBe(true);
    expect(matchesProductFilters(makeProduct({ shipping: {} }), { freeShipping: true })).toBe(false);
  });
});

describe('RATING_PILLS', () => {
  it('leads with the reset option and covers 1★ through 4★', () => {
    expect(RATING_PILLS[0].value).toBeUndefined();
    expect(RATING_PILLS.slice(1).map((pill) => pill.value)).toEqual([4, 3, 2, 1]);
  });
});
