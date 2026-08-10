// ── Offer comparability assessment ──────────────────────────────────────
//
// Determines whether two offers can be meaningfully compared on price,
// condition, variant, etc., and flags incomparable offers.

import type { NormalizedOffer } from './types';

/**
 * Determine if two offers are meaningfully comparable for price ranking.
 * Returns true only when condition, currency, and variant are comparable.
 */
export function areOfferPricesComparable(a: NormalizedOffer, b: NormalizedOffer): boolean {
  // Must be same currency
  if (a.price?.currency !== b.price?.currency) return false;

  // Conditions must match or both be unknown
  if (a.condition !== 'unknown' && b.condition !== 'unknown' && a.condition !== b.condition) {
    return false;
  }

  // If variants are marked as different_variant, prices aren't comparable
  if (
    a.comparableVariant?.comparability === 'different_variant' ||
    b.comparableVariant?.comparability === 'different_variant'
  ) {
    return false;
  }

  return true;
}

/**
 * Assess variant comparability between two offers.
 * Returns 'equivalent', 'different_variant', or 'unknown'.
 */
export function assessVariantComparability(
  a: NormalizedOffer,
  b: NormalizedOffer
): 'equivalent' | 'different_variant' | 'unknown' {
  const optsA = a.comparableVariant?.selectedOptions || [];
  const optsB = b.comparableVariant?.selectedOptions || [];

  if (optsA.length === 0 && optsB.length === 0) return 'unknown';
  if (optsA.length === 0 || optsB.length === 0) return 'unknown';

  // Compare option name/value pairs
  const mapA = new Map(optsA.map(o => [o.name.toLowerCase(), o.value.toLowerCase()]));
  const mapB = new Map(optsB.map(o => [o.name.toLowerCase(), o.value.toLowerCase()]));

  // Same keys?
  const keysA = new Set(mapA.keys());
  const keysB = new Set(mapB.keys());

  if (keysA.size !== keysB.size) return 'different_variant';

  for (const key of keysA) {
    if (!keysB.has(key)) return 'different_variant';
    if (mapA.get(key) !== mapB.get(key)) return 'different_variant';
  }

  return 'equivalent';
}

/**
 * Compute which offers within a canonical product are comparable
 * and update their comparability flags.
 */
export function computeOfferComparability(offers: NormalizedOffer[]): NormalizedOffer[] {
  if (offers.length <= 1) return offers;

  // For each pair, assess variant similarity
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const comp = assessVariantComparability(offers[i], offers[j]);
      // If different, mark both
      if (comp === 'different_variant') {
        if (offers[i].comparableVariant) {
          offers[i].comparableVariant!.comparability = 'different_variant';
        }
        if (offers[j].comparableVariant) {
          offers[j].comparableVariant!.comparability = 'different_variant';
        }
      }
    }
  }

  return offers;
}
