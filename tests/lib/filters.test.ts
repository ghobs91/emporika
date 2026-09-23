// ── Facet filter tests ──────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  applyProductFilters,
  matchesProductFilters,
  getCategoryFacets,
  getBrandFacets,
  getConditionFacets,
} from '@/lib/filters';
import type { UnifiedProduct } from '@/types/unified';

function makeProduct(overrides: Partial<UnifiedProduct> = {}): UnifiedProduct {
  return {
    id: 'p1',
    name: 'Test Product',
    price: 10,
    image: '',
    productUrl: '#',
    source: 'walmart',
    ...overrides,
  };
}

describe('applyProductFilters facets', () => {
  it('keeps only products in the selected category', () => {
    const products = [
      makeProduct({ id: 'a', category: 'Laptops' }),
      makeProduct({ id: 'b', category: 'Tablets' }),
      makeProduct({ id: 'c' }),
    ];
    const result = applyProductFilters(products, { categories: ['Laptops'] });
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('matches any of multiple selected categories', () => {
    const products = [
      makeProduct({ id: 'a', category: 'Laptops' }),
      makeProduct({ id: 'b', category: 'Tablets' }),
      makeProduct({ id: 'c', category: 'Monitors' }),
    ];
    const result = applyProductFilters(products, { categories: ['Laptops', 'Tablets'] });
    expect(result.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('filters by brand', () => {
    const products = [
      makeProduct({ id: 'a', brand: 'Sony' }),
      makeProduct({ id: 'b', brand: 'Bose' }),
      makeProduct({ id: 'c' }),
    ];
    const result = applyProductFilters(products, { brands: ['Sony'] });
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('filters by condition', () => {
    const products = [
      makeProduct({ id: 'a', condition: 'new' }),
      makeProduct({ id: 'b', condition: 'used' }),
      makeProduct({ id: 'c', condition: 'refurbished' }),
    ];
    const result = applyProductFilters(products, { conditions: ['used', 'refurbished'] });
    expect(result.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('combines facets with AND semantics', () => {
    const products = [
      makeProduct({ id: 'a', brand: 'Sony', condition: 'new' }),
      makeProduct({ id: 'b', brand: 'Sony', condition: 'used' }),
      makeProduct({ id: 'c', brand: 'Bose', condition: 'new' }),
    ];
    const result = applyProductFilters(products, {
      brands: ['Sony'],
      conditions: ['new'],
    });
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('does not filter when a facet has no selections', () => {
    const products = [makeProduct({ id: 'a' }), makeProduct({ id: 'b' })];
    expect(applyProductFilters(products, { categories: [] })).toHaveLength(2);
  });

  it('exposes the same predicate used by applyProductFilters', () => {
    expect(matchesProductFilters(makeProduct({ brand: 'Sony' }), { brands: ['Sony'] })).toBe(true);
    expect(matchesProductFilters(makeProduct({ brand: 'Bose' }), { brands: ['Sony'] })).toBe(false);
  });
});

describe('facet counts', () => {
  it('counts categories and orders most common first', () => {
    const products = [
      makeProduct({ id: 'a', category: 'Laptops' }),
      makeProduct({ id: 'b', category: 'Laptops' }),
      makeProduct({ id: 'c', category: 'Tablets' }),
      makeProduct({ id: 'd' }),
    ];
    expect(getCategoryFacets(products)).toEqual([
      { value: 'Laptops', count: 2 },
      { value: 'Tablets', count: 1 },
    ]);
  });

  it('counts brands and conditions, skipping missing values', () => {
    const products = [
      makeProduct({ id: 'a', brand: 'Sony', condition: 'new' }),
      makeProduct({ id: 'b', brand: 'Sony', condition: 'used' }),
      makeProduct({ id: 'c', condition: 'new' }),
    ];
    expect(getBrandFacets(products)).toEqual([{ value: 'Sony', count: 2 }]);
    expect(getConditionFacets(products)).toEqual([
      { value: 'new', count: 2 },
      { value: 'used', count: 1 },
    ]);
  });
});
