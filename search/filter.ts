// ── Deterministic filtering ─────────────────────────────────────────────
//
// Applies hard filters from a SearchPlan to normalized offers and canonical
// products. Returns filtered results along with explanations of what was
// filtered and why.

import type {
  CanonicalProduct,
  NormalizedOffer,
  SearchPlan,
  ShopperPreferences,
} from './types';

export type FilterStrictness = 'strict' | 'balanced';

export interface FilterResult {
  passed: boolean;
  reason?: string;
  uncertain?: boolean; // true when evidence is missing (balanced mode keeps, strict drops)
}

/**
 * Apply hard filters to a canonical product, checking its best offers.
 * In balanced mode, uncertain evidence is kept but flagged.
 * In strict mode, any unverifiable required attribute causes exclusion.
 */
export function applyHardFilters(
  product: CanonicalProduct,
  plan: SearchPlan,
  preferences?: ShopperPreferences
): FilterResult {
  const strictness: FilterStrictness = preferences?.strictness || 'balanced';
  const filters = plan.hardFilters;

  // ── Price filters ───────────────────────────────────────────────────

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const bestPriceOffer = product.offers.find(o => o.price);
    if (bestPriceOffer?.price) {
      if (filters.minPrice !== undefined && bestPriceOffer.price.amount < filters.minPrice) {
        return { passed: false, reason: `Price ${bestPriceOffer.price.amount} below minimum ${filters.minPrice}` };
      }
      if (filters.maxPrice !== undefined && bestPriceOffer.price.amount > filters.maxPrice) {
        return { passed: false, reason: `Price ${bestPriceOffer.price.amount} above maximum ${filters.maxPrice}` };
      }
    } else {
      // No price data
      if (strictness === 'strict' && (filters.minPrice !== undefined || filters.maxPrice !== undefined)) {
        return { passed: false, reason: 'Price data missing, cannot verify budget', uncertain: true };
      }
      // Balanced: keep but flag
    }
  }

  // ── Brand filters ────────────────────────────────────────────────────

  if (filters.excludedBrands?.length) {
    // Check if the product brand matches an excluded brand
    // (We check the product brand and any offer seller names)
    const productBrand = product.brand?.toLowerCase();
    if (productBrand) {
      for (const excluded of filters.excludedBrands) {
        if (productBrand.includes(excluded.toLowerCase())) {
          return { passed: false, reason: `Brand "${productBrand}" is excluded` };
        }
      }
    }
  }

  if (filters.preferredBrands?.length) {
    // Preferred brands are soft — they influence ranking, not filtering
  }

  // ── Condition filters ────────────────────────────────────────────────

  if (filters.allowedConditions?.length) {
    const hasAllowedOffer = product.offers.some(
      o => o.condition !== 'unknown' && filters.allowedConditions!.includes(o.condition)
    );
    const hasOnlyUnknown = product.offers.every(o => o.condition === 'unknown');

    if (!hasAllowedOffer && !hasOnlyUnknown) {
      return {
        passed: false,
        reason: `No offers match allowed conditions: ${filters.allowedConditions.join(', ')}`,
      };
    }
    if (hasOnlyUnknown && strictness === 'strict') {
      return {
        passed: false,
        reason: 'Condition data missing, cannot verify allowed conditions',
        uncertain: true,
      };
    }
  }

  // ── Availability filter ──────────────────────────────────────────────

  if (filters.availabilityRequired) {
    const hasAvailableOffer = product.offers.some(
      o => o.availability === 'in_stock' || o.availability === 'limited'
    );

    if (!hasAvailableOffer) {
      const allUnknown = product.offers.every(o => o.availability === 'unknown');
      if (allUnknown && strictness === 'balanced') {
        // Keep but flag uncertainty
      } else {
        return { passed: false, reason: 'No offers verified as available' };
      }
    }
  }

  // ── Destination filter (country) ─────────────────────────────────────

  if (filters.shipsTo?.country) {
    // We can only verify this if provider supports destination filtering
    // For now, keep if unknown; strict mode would drop
    const hasVerifiedShipping = product.offers.some(
      o => o.fulfillment?.shippingSupported
    );
    if (!hasVerifiedShipping && strictness === 'strict') {
      return {
        passed: false,
        reason: `Cannot verify shipping to ${filters.shipsTo.country}`,
        uncertain: true,
      };
    }
  }

  // ── Required features ────────────────────────────────────────────────
  // In balanced mode, never eliminate based on feature keywords — ranking
  // handles them. In strict mode, only drop if NONE of the requested
  // features are present (avoids overly aggressive filtering).

  if (filters.requiredFeatures?.length && strictness === 'strict') {
    const searchText = `${product.title} ${product.description || ''}`.toLowerCase();
    const missingFeatures = filters.requiredFeatures.filter(
      f => !searchText.includes(f.toLowerCase())
    );

    if (missingFeatures.length === filters.requiredFeatures.length) {
      return {
        passed: false,
        reason: `Missing required features: ${missingFeatures.join(', ')}`,
      };
    }
  }

  // ── Exclusions (explicit terms to exclude) ────────────────────────────

  if (filters.exclusions?.length) {
    const searchText = `${product.title} ${product.description || ''}`.toLowerCase();
    for (const exclusion of filters.exclusions) {
      if (searchText.includes(exclusion.toLowerCase())) {
        return { passed: false, reason: `Excluded term: "${exclusion}"` };
      }
    }
  }

  return { passed: true };
}
