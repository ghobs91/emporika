// ── Search URL contract ────────────────────────────────────────────────
//
// Search state is addressable: `/search/results` carries the query, the
// active result filters and the sort order in the query string, so a link
// reproduces exactly what the sender was looking at:
//
//   /search/results?query=mac%20mini&inStock=true&maxPrice=990
//
// Parsing is defensive — this is a user-editable boundary, so unknown keys,
// malformed numbers and stale enum values are dropped rather than trusted.

import { z } from 'zod';
import type { ProductFilters } from '@/lib/filters';
import type { RetailerSource } from '@/types/unified';

export const SEARCH_RESULTS_PATH = '/search/results';

/** Retailers selectable in the results sidebar, in display order. */
export const RETAILER_SOURCES = [
  'walmart',
  'bestbuy',
  'target',
  'ebay',
  'costco',
  'shopify',
  'backmarket',
] as const satisfies readonly RetailerSource[];

export const SORT_OPTIONS = [
  'most-popular',
  'price-asc',
  'price-desc',
  'rating-desc',
] as const;

export type SearchSortOption = (typeof SORT_OPTIONS)[number];

const sourceSchema = z.enum(RETAILER_SOURCES);
const sortSchema = z.enum(SORT_OPTIONS);
const shippingSpeedSchema = z.enum(['free', 'twoDay', 'twoThreeDay']);
const conditionSchema = z.enum(['new', 'used', 'refurbished', 'open_box']);

/** Keeps one hand-edited URL from producing an unbounded client-side filter. */
const MAX_LIST_VALUES = 20;

export interface SearchUrlState {
  query: string;
  filters: ProductFilters;
  /**
   * Selected retailers. Every retailer is the default, so `sources` is only
   * written to the URL when the set has actually been narrowed.
   */
  sources: RetailerSource[];
  sort: SearchSortOption;
}

/** Query-string keys, in the order they are written. */
export const SEARCH_URL_KEYS = {
  query: 'query',
  availableOnline: 'inStock',
  onSale: 'onSale',
  freeShipping: 'freeShipping',
  hasReviews: 'hasReviews',
  minPrice: 'minPrice',
  maxPrice: 'maxPrice',
  minRating: 'minRating',
  shippingSpeed: 'shippingSpeed',
  categories: 'categories',
  brands: 'brands',
  conditions: 'conditions',
  sources: 'sources',
  sort: 'sort',
} as const;

// ── Parsing helpers ────────────────────────────────────────────────────

/** Only `true` / `1` turn a switch on; anything else leaves it off. */
function parseFlag(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' ? true : undefined;
}

/**
 * Non-negative finite numbers only. Currency formatting is tolerated so a
 * hand-edited `?maxPrice=$990` still works, but signs and junk are rejected
 * rather than silently re-interpreted.
 */
function parseAmount(value: string | null): number | undefined {
  if (value === null) return undefined;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseList(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const unique = Array.from(new Set(values)).slice(0, MAX_LIST_VALUES);
  return unique.length > 0 ? unique : undefined;
}

function parseEnumList<T extends string>(
  value: string | null,
  schema: z.ZodType<T>
): T[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const parsed = values
    .map((entry) => schema.safeParse(entry))
    .flatMap((result) => (result.success ? [result.data] : []));
  return parsed.length > 0 ? parsed : undefined;
}

function parseEnum<T extends string>(
  value: string | null,
  schema: z.ZodType<T>
): T | undefined {
  if (value === null) return undefined;
  const result = schema.safeParse(value.trim());
  return result.success ? result.data : undefined;
}

/**
 * `sources` narrows the result set. Unknown ids are dropped; an empty or
 * fully invalid value falls back to every retailer so a bad link still shows
 * results instead of an empty page.
 */
function parseSources(value: string | null): RetailerSource[] {
  const parsed = parseEnumList(value, sourceSchema);
  return parsed && parsed.length > 0 ? parsed : [...RETAILER_SOURCES];
}

// ── Public API ─────────────────────────────────────────────────────────

export function parseSearchParams(params: URLSearchParams): SearchUrlState {
  const get = (key: keyof typeof SEARCH_URL_KEYS) =>
    params.get(SEARCH_URL_KEYS[key]);

  const minRating = parseAmount(get('minRating'));
  const minPrice = parseAmount(get('minPrice'));
  const maxPrice = parseAmount(get('maxPrice'));

  const filters: ProductFilters = {
    availableOnline: parseFlag(get('availableOnline')),
    onSale: parseFlag(get('onSale')),
    freeShipping: parseFlag(get('freeShipping')),
    hasReviews: parseFlag(get('hasReviews')),
    minPrice,
    maxPrice,
    // Ratings live on a 0–5 scale; anything outside it is ignored.
    minRating:
      minRating !== undefined && minRating <= 5 ? minRating : undefined,
    shippingSpeed: parseEnum(get('shippingSpeed'), shippingSpeedSchema),
    categories: parseList(get('categories')),
    brands: parseList(get('brands')),
    conditions: parseEnumList(get('conditions'), conditionSchema),
  };

  // Drop the keys that resolved to undefined so callers can compare cleanly.
  for (const key of Object.keys(filters) as Array<keyof ProductFilters>) {
    if (filters[key] === undefined) delete filters[key];
  }

  return {
    query: (get('query') ?? '').trim(),
    filters,
    sources: parseSources(get('sources')),
    sort: parseEnum(get('sort'), sortSchema) ?? 'most-popular',
  };
}

/**
 * Serialize search state to the canonical query string. Defaults are omitted
 * so the URL stays as short as the state allows, and the order mirrors
 * `SEARCH_URL_KEYS` (query first, then filters, then sort).
 */
export function buildSearchParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = state;

  if (state.query.trim()) params.set(SEARCH_URL_KEYS.query, state.query.trim());

  if (filters.availableOnline) params.set(SEARCH_URL_KEYS.availableOnline, 'true');
  if (filters.onSale) params.set(SEARCH_URL_KEYS.onSale, 'true');
  if (filters.freeShipping) params.set(SEARCH_URL_KEYS.freeShipping, 'true');
  if (filters.hasReviews) params.set(SEARCH_URL_KEYS.hasReviews, 'true');

  if (filters.minPrice !== undefined) {
    params.set(SEARCH_URL_KEYS.minPrice, String(filters.minPrice));
  }
  if (filters.maxPrice !== undefined) {
    params.set(SEARCH_URL_KEYS.maxPrice, String(filters.maxPrice));
  }
  if (filters.minRating !== undefined) {
    params.set(SEARCH_URL_KEYS.minRating, String(filters.minRating));
  }
  if (filters.shippingSpeed) {
    params.set(SEARCH_URL_KEYS.shippingSpeed, filters.shippingSpeed);
  }
  if (filters.categories?.length) {
    params.set(SEARCH_URL_KEYS.categories, filters.categories.join(','));
  }
  if (filters.brands?.length) {
    params.set(SEARCH_URL_KEYS.brands, filters.brands.join(','));
  }
  if (filters.conditions?.length) {
    params.set(SEARCH_URL_KEYS.conditions, filters.conditions.join(','));
  }

  // Retailers are written in canonical order, and only when narrowed.
  const sources = state.sources
    .filter((source): source is RetailerSource =>
      (RETAILER_SOURCES as readonly RetailerSource[]).includes(source)
    )
    .sort(
      (a, b) => RETAILER_SOURCES.indexOf(a) - RETAILER_SOURCES.indexOf(b)
    );
  if (sources.length > 0 && sources.length < RETAILER_SOURCES.length) {
    params.set(SEARCH_URL_KEYS.sources, sources.join(','));
  }

  if (state.sort !== 'most-popular') {
    params.set(SEARCH_URL_KEYS.sort, state.sort);
  }

  return params;
}

/**
 * Canonical query string. Spaces are written as `%20` (rather than the
 * `URLSearchParams` default of `+`) and list separators stay as literal
 * commas, so shared links read the way they were typed.
 *
 * Comma is a list separator here, so `categories` and `brands` values
 * cannot themselves contain one — a value with a comma would split on the
 * way back in. Retailer ids, conditions and shipping speeds are unaffected.
 */
export function buildSearchQueryString(state: SearchUrlState): string {
  return buildSearchParams(state)
    .toString()
    .replace(/\+/g, '%20')
    .replace(/%2C/gi, ',');
}

/** Full href for a search state. */
export function buildSearchUrl(state: SearchUrlState): string {
  const queryString = buildSearchQueryString(state);
  return queryString ? `${SEARCH_RESULTS_PATH}?${queryString}` : SEARCH_RESULTS_PATH;
}
