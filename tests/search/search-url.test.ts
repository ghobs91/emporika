// ── Search URL contract ────────────────────────────────────────────────
// `/search/results` carries the whole search state in its query string. The
// parsed filters feed the same `ProductFilters` the sidebar writes, so the
// round-trip has to be exact: a shared link must reproduce the view, and a
// hand-edited URL must never crash the result set.

import { describe, it, expect } from 'vitest';
import {
  SEARCH_RESULTS_PATH,
  RETAILER_SOURCES,
  buildSearchQueryString,
  buildSearchUrl,
  parseSearchParams,
  type SearchUrlState,
} from '@/lib/search-url';

/** Parse a full href the way the app does (`useSearchParams` → URLSearchParams). */
function parse(href: string) {
  return parseSearchParams(new URLSearchParams(href.split('?')[1] ?? ''));
}

const DEFAULT_STATE: SearchUrlState = {
  query: '',
  filters: {},
  sources: [...RETAILER_SOURCES],
  sort: 'most-popular',
};

describe('parseSearchParams', () => {
  it('reads the example URL from the spec', () => {
    const state = parse('/search/results?query=mac%20mini&inStock=true&maxPrice=990');

    expect(state.query).toBe('mac mini');
    expect(state.filters).toEqual({ availableOnline: true, maxPrice: 990 });
    expect(state.sources).toEqual([...RETAILER_SOURCES]);
    expect(state.sort).toBe('most-popular');
  });

  it('decodes "+" as a space, like any query string', () => {
    expect(parse('/search/results?query=mac+mini+pro').query).toBe('mac mini pro');
  });

  it('reads every supported filter', () => {
    const state = parse(
      '/search/results?query=desk' +
        '&inStock=true&onSale=true&freeShipping=true&hasReviews=true' +
        '&minPrice=50&maxPrice=990&minRating=4&shippingSpeed=twoDay' +
        '&categories=Desks,Brands&brands=Apple&conditions=new,used' +
        '&sources=bestbuy,ebay&sort=price-asc'
    );

    expect(state.filters).toEqual({
      availableOnline: true,
      onSale: true,
      freeShipping: true,
      hasReviews: true,
      minPrice: 50,
      maxPrice: 990,
      minRating: 4,
      shippingSpeed: 'twoDay',
      categories: ['Desks', 'Brands'],
      brands: ['Apple'],
      conditions: ['new', 'used'],
    });
    expect(state.sources).toEqual(['bestbuy', 'ebay']);
    expect(state.sort).toBe('price-asc');
  });

  it('drops malformed values instead of throwing', () => {
    const state = parse(
      '/search/results?query=desk&minPrice=abc&maxPrice=-5&minRating=9&shippingSpeed=teleport&sort=sideways&inStock=maybe'
    );

    expect(state.filters).toEqual({});
    expect(state.sort).toBe('most-popular');
  });

  it('falls back to every retailer when `sources` is unknown or empty', () => {
    expect(parse('/search/results?query=desk&sources=sears').sources).toEqual([
      ...RETAILER_SOURCES,
    ]);
    expect(parse('/search/results?query=desk&sources=').sources).toEqual([
      ...RETAILER_SOURCES,
    ]);
    // Unknown ids mixed with known ones keep only the known ones.
    expect(parse('/search/results?query=desk&sources=ebay,sears').sources).toEqual([
      'ebay',
    ]);
  });

  it('normalizes duplicate and padded list values', () => {
    expect(
      parse('/search/results?query=desk&categories=Desks,%20Desks%20,Chairs').filters
        .categories
    ).toEqual(['Desks', 'Chairs']);
  });

  it('ignores unknown keys', () => {
    expect(parse('/search/results?query=desk&utm_source=mail&minPrice=10').filters).toEqual({
      minPrice: 10,
    });
  });
});

describe('buildSearchQueryString', () => {
  it('writes the example URL from the spec byte for byte', () => {
    const state: SearchUrlState = {
      ...DEFAULT_STATE,
      query: 'mac mini',
      filters: { availableOnline: true, maxPrice: 990 },
    };

    expect(buildSearchQueryString(state)).toBe('query=mac%20mini&inStock=true&maxPrice=990');
    expect(buildSearchUrl(state)).toBe(
      `${SEARCH_RESULTS_PATH}?query=mac%20mini&inStock=true&maxPrice=990`
    );
  });

  it('omits defaults so links stay short', () => {
    expect(buildSearchUrl(DEFAULT_STATE)).toBe(SEARCH_RESULTS_PATH);
    expect(buildSearchUrl({ ...DEFAULT_STATE, query: 'mac mini' })).toBe(
      '/search/results?query=mac%20mini'
    );
  });

  it('omits switches that are off', () => {
    expect(
      buildSearchQueryString({
        ...DEFAULT_STATE,
        query: 'desk',
        filters: { availableOnline: true, onSale: false },
      })
    ).toBe('query=desk&inStock=true');
  });

  it('writes retailers in canonical order, only when narrowed', () => {
    expect(
      buildSearchQueryString({
        ...DEFAULT_STATE,
        query: 'desk',
        sources: ['ebay', 'bestbuy'],
      })
    ).toBe('query=desk&sources=bestbuy,ebay');
  });

  it('always puts query first, then filters, then stores and sort', () => {
    const queryString = buildSearchQueryString({
      query: 'desk',
      filters: { minRating: 4, categories: ['Desks'], availableOnline: true },
      sources: ['ebay'],
      sort: 'rating-desc',
    });

    expect(queryString).toBe(
      'query=desk&inStock=true&minRating=4&categories=Desks&sources=ebay&sort=rating-desc'
    );
  });
});

describe('round trip', () => {
  it('parse(build(state)) is identity', () => {
    const state: SearchUrlState = {
      query: 'mac mini & display',
      filters: {
        availableOnline: true,
        minPrice: 100,
        maxPrice: 990,
        minRating: 4,
        shippingSpeed: 'free',
        categories: ['Desktops & All-in-Ones'],
        brands: ['Apple'],
        conditions: ['refurbished'],
      },
      sources: ['bestbuy', 'shopify'],
      sort: 'price-desc',
    };

    expect(parse(buildSearchUrl(state))).toEqual(state);
  });

  it('is stable: re-serializing parsed output is a no-op', () => {
    const href = '/search/results?query=mac%20mini&inStock=true&maxPrice=990&sort=price-asc';
    const once = buildSearchUrl(parse(href));
    expect(buildSearchUrl(parse(once))).toBe(once);
  });
});
