// ── Budget sweet-spot scoring ───────────────────────────────────────────
//
// A naive "cheaper is better" ranking turns a $300 gift budget into $12
// trinkets, because the retailer ranker rewards low landed cost. What a gift
// shopper actually wants is something that feels *substantial* against the
// ceiling they set: the classic sweet spot is 60–90% of the maximum.
//
// This is a bounded, deterministic curve — 1.0 inside the band, decaying
// outside it, with an extra penalty for token-priced items.

/** Fraction of the budget ceiling that reads as "a real gift". */
export const SWEET_SPOT = { min: 0.6, max: 0.9 } as const;

/** Below this fraction a listing reads as a stocking filler. */
export const TOKEN_PRICE_RATIO = 0.25;

/** Share of the budget band that still scores above zero. */
const DECAY_SPAN = 0.55;

export interface BudgetFit {
  score: number;
  /** price / budget, clamped to [0, 1.5]. */
  ratio: number;
  band: 'sweet' | 'below' | 'above' | 'unknown';
  reason: string;
}

/**
 * Score how well a price sits inside a budget.
 *
 * - inside [60%, 90%] of the ceiling → 1.0
 * - below it → linear decay to 0 at 55% of the budget away
 * - above it → linear decay to 0 at the ceiling, 0 past it
 * - unknown price → 0.45 (neutral-negative: we cannot tell it is substantial)
 */
export function budgetFit(price: number | undefined, maxBudget: number | undefined): BudgetFit {
  if (price === undefined || !Number.isFinite(price) || price <= 0 || !maxBudget || maxBudget <= 0) {
    return { score: 0.45, ratio: 0, band: 'unknown', reason: 'price or budget unknown' };
  }

  const ratio = Math.min(1.5, price / maxBudget);

  if (ratio >= SWEET_SPOT.min && ratio <= SWEET_SPOT.max) {
    return {
      score: 1,
      ratio,
      band: 'sweet',
      reason: `${Math.round(ratio * 100)}% of budget — in the 60–90% sweet spot`,
    };
  }

  if (ratio < SWEET_SPOT.min) {
    const distance = SWEET_SPOT.min - ratio;
    // Token-priced items decay faster than merely modest ones.
    const penalty = ratio < TOKEN_PRICE_RATIO ? 1.6 : 1;
    const score = Math.max(0, 1 - (distance / DECAY_SPAN) * penalty);
    return {
      score,
      ratio,
      band: 'below',
      reason:
        ratio < TOKEN_PRICE_RATIO
          ? `only ${Math.round(ratio * 100)}% of budget — reads as a stocking filler`
          : `${Math.round(ratio * 100)}% of budget — below the sweet spot`,
    };
  }

  // Above the band but within budget: mildly penalised, not excluded.
  const distance = ratio - SWEET_SPOT.max;
  const score = Math.max(0, 1 - distance / Math.max(0.0001, 1 - SWEET_SPOT.max));
  return {
    score,
    ratio,
    band: 'above',
    reason: `${Math.round(ratio * 100)}% of budget — at the very top of the ceiling`,
  };
}
