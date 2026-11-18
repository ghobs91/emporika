// ── Gift momentum: measured purchase popularity ────────────────────────
//
// The checked-in table in `./momentum-data.ts` is generated from Walmart's
// sales-ranked search (`sort=bestseller`) by
// `scripts/build-gift-momentum.ts`. It answers one question the editorial
// index cannot: *is anyone actually selling this right now?*
//
// It is deliberately a small additive bonus in `./brief.ts` (never a filter),
// because the feed is Walmart-only — a brand Walmart does not carry must not be
// punished for the absence of a signal it never had.

import { MOMENTUM_BY_QUERY, MOMENTUM_SAMPLED_AT, MOMENTUM_SAMPLE_SIZE } from './momentum-data';

/** Maximum score contribution. Small enough to reorder, not to overpower. */
export const MOMENTUM_WEIGHT = 0.06;

/**
 * Queries are keyed lowercase with collapsed whitespace, so lookups do not
 * depend on how the index happened to capitalize a noun.
 */
export function normalizeMomentumKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Momentum in [0, 1]; 0 means "not sampled" as well as "nothing selling". */
export function momentumFor(query: string): number {
  return MOMENTUM_BY_QUERY[normalizeMomentumKey(query)] ?? 0;
}

export function hasMomentum(query: string): boolean {
  return normalizeMomentumKey(query) in MOMENTUM_BY_QUERY;
}

/** ISO timestamp of the sampling run behind the current table. */
export const momentumSampledAt = MOMENTUM_SAMPLED_AT;

export const momentumSampleSize = MOMENTUM_SAMPLE_SIZE;

/** Whole days since the table was sampled — it goes stale, and says so. */
export function momentumAgeDays(now = Date.now()): number {
  const sampled = Date.parse(MOMENTUM_SAMPLED_AT);
  if (!Number.isFinite(sampled)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - sampled) / 86_400_000));
}
