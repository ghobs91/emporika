import { UnifiedProduct } from '@/types/unified';

export interface ProductFilters {
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  onSale?: boolean;
  freeShipping?: boolean;
  availableOnline?: boolean;
  hasReviews?: boolean;
  shippingSpeed?: 'free' | 'twoDay' | 'twoThreeDay';
  categories?: string[];
  brands?: string[];
  conditions?: string[];
}

export interface PriceBucket {
  label: string;
  min: number;
  max?: number;
}

export const PRICE_BUCKETS: PriceBucket[] = [
  { label: 'Under $25', min: 0, max: 25 },
  { label: '$25 - $49.99', min: 25, max: 50 },
  { label: '$50 - $99.99', min: 50, max: 100 },
  { label: '$100 - $249.99', min: 100, max: 250 },
  { label: '$250 - $499.99', min: 250, max: 500 },
  { label: 'Over $500', min: 500 },
];

export const RATING_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: '4★ & up', value: 4 },
  { label: '3★ & up', value: 3 },
  { label: '2★ & up', value: 2 },
  { label: 'Any rating', value: undefined },
];

export const SHIPPING_SPEED_OPTIONS: { label: string; value: ProductFilters['shippingSpeed'] }[] = [
  { label: 'Free shipping', value: 'free' },
  { label: '2-day shipping', value: 'twoDay' },
  { label: '2-3 day shipping', value: 'twoThreeDay' },
];

/**
 * Whether a single product satisfies all active filters. Shared by the
 * classic grid and the AI-ranked results so both filter identically.
 */
export function matchesProductFilters(
  product: UnifiedProduct,
  filters: ProductFilters
): boolean {
  if (filters.minPrice !== undefined && product.price < filters.minPrice) {
    return false;
  }
  if (filters.maxPrice !== undefined && product.price >= filters.maxPrice) {
    return false;
  }
  if (
    filters.minRating !== undefined &&
    (product.customerRating ?? 0) < filters.minRating
  ) {
    return false;
  }
  if (
    filters.onSale &&
    (!product.originalPrice || product.originalPrice <= product.price)
  ) {
    return false;
  }
  if (
    filters.freeShipping &&
    !product.freeShipping &&
    !product.shipping?.freeShipping
  ) {
    return false;
  }
  if (filters.availableOnline && product.availableOnline === false) {
    return false;
  }
  if (filters.hasReviews && !(product.reviewCount && product.reviewCount > 0)) {
    return false;
  }
  // Facet filters: a product missing the attribute is excluded while the
  // filter is active, matching the rating/review behavior above.
  if (
    filters.categories?.length &&
    (!product.category || !filters.categories.includes(product.category))
  ) {
    return false;
  }
  if (
    filters.brands?.length &&
    (!product.brand || !filters.brands.includes(product.brand))
  ) {
    return false;
  }
  if (
    filters.conditions?.length &&
    (!product.condition || !filters.conditions.includes(product.condition))
  ) {
    return false;
  }
  // Shipping speed filter
  if (filters.shippingSpeed === 'free') {
    if (!product.freeShipping && !product.shipping?.freeShipping) return false;
  }
  if (filters.shippingSpeed === 'twoDay') {
    if (!product.shipping?.twoDay) return false;
  }
  if (filters.shippingSpeed === 'twoThreeDay') {
    if (!product.shipping?.twoThreeDay) return false;
  }
  return true;
}

/**
 * Apply property-based filters to a list of unified products.
 */
export function applyProductFilters(
  products: UnifiedProduct[],
  filters: ProductFilters
): UnifiedProduct[] {
  return products.filter((product) => matchesProductFilters(product, filters));
}

/**
 * Return price buckets that actually contain products from the result set.
 */
export function getAvailablePriceBuckets(
  products: UnifiedProduct[]
): PriceBucket[] {
  return PRICE_BUCKETS.filter((bucket) =>
    products.some((product) => {
      if (product.price < bucket.min) return false;
      if (bucket.max === undefined) return true;
      return product.price < bucket.max;
    })
  );
}

/**
 * Count how many products match each boolean filter option.
 */
export function getFilterCounts(products: UnifiedProduct[]) {
  return {
    onSale: products.filter(
      (p) => p.originalPrice && p.originalPrice > p.price
    ).length,
    freeShipping: products.filter(
      (p) => p.freeShipping || p.shipping?.freeShipping
    ).length,
    availableOnline: products.filter((p) => p.availableOnline !== false).length,
    hasReviews: products.filter((p) => p.reviewCount && p.reviewCount > 0)
      .length,
    twoDay: products.filter((p) => p.shipping?.twoDay).length,
    twoThreeDay: products.filter((p) => p.shipping?.twoThreeDay).length,
  };
}

export interface FacetValue {
  value: string;
  count: number;
}

/**
 * Group products by a string attribute and count occurrences, most common first.
 */
function countFacet(
  products: UnifiedProduct[],
  select: (product: UnifiedProduct) => string | undefined
): FacetValue[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const value = select(product);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value)
  );
}

/** Category facets present in the result set, most common first. */
export function getCategoryFacets(products: UnifiedProduct[]): FacetValue[] {
  return countFacet(products, (product) => product.category);
}

/** Brand facets present in the result set, most common first. */
export function getBrandFacets(products: UnifiedProduct[]): FacetValue[] {
  return countFacet(products, (product) => product.brand);
}

/** Condition facets present in the result set, most common first. */
export function getConditionFacets(products: UnifiedProduct[]): FacetValue[] {
  return countFacet(products, (product) => product.condition);
}

/**
 * Format a price bucket label for active filter chips.
 */
export function formatPriceBucketLabel(
  min?: number,
  max?: number
): string {
  const bucket = PRICE_BUCKETS.find((b) => b.min === min && b.max === max);
  if (bucket) return bucket.label;
  if (min !== undefined && max !== undefined) return `$${min} - $${max}`;
  if (min !== undefined) return `$${min}+`;
  if (max !== undefined) return `Under $${max}`;
  return 'Price';
}
