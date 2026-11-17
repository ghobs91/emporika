// ── Deterministic recipient → gift brief ────────────────────────────────
//
// The whole point of the index: turn (gender, age, interests) into a small,
// ordered set of concrete retailer searches. No model, no network, no
// randomness — the same recipient always yields the same brief, which is
// what makes the feature cacheable and testable.
//
// Scoring rules (all bounded, all editorial):
//   strength        the index's own confidence that this is a good gift
//   tierFit         whether the gift's price tier matches the budget
//   leanNudge       ±0.04 for retail-merchandising lean (never a filter)
//   universalBonus  +0.02 so a neutral fallback always stays in reach

import { AGE_BRACKET_PROFILES, INTEREST_PROFILES } from './index-data';
import { ageBracketForAge } from './taxonomy';
import { TIER_PRICE } from './types';
import type {
  AgeBracket,
  Gender,
  GiftBrief,
  GiftIntent,
  GiftRecipient,
  InterestId,
  ScoredIntent,
} from './types';

// ── Tuning ─────────────────────────────────────────────────────────────

/** How much a merchandising lean may move the ranking. Deliberately tiny. */
export const LEAN_NUDGE = 0.04;
/** Bail-out gift that is always appropriate, so it never drops out of reach. */
export const UNIVERSAL_BONUS = 0.02;
/** Tier matches the budget band. */
export const TIER_IN_BUDGET_BONUS = 0.05;
/** Tier is likely to have nothing under the ceiling. */
export const TIER_OVER_BUDGET_PENALTY = 0.3;
/** Tier matches the scale of the budget band. */
export const IDEAL_TIER_BONUS = 0.03;

/** Default number of distinct searches per "gift ideas" request. */
export const DEFAULT_MAX_INTENTS = 3;
export const MAX_MAX_INTENTS = 5;
/** Keeps one strong interest from filling the entire result set. */
export const MAX_PER_INTEREST = 2;

const UNIVERSAL_KEY = '__universal__';

// ── Gates ──────────────────────────────────────────────────────────────

/**
 * Whether an intent may be offered to a bracket. Two independent gates:
 * safety/complexity (`avoidAgeBrackets`) and age-specific-only items such
 * as board books (`onlyAgeBrackets`).
 */
export function isIntentOfferable(intent: GiftIntent, bracket: AgeBracket): boolean {
  if (intent.avoidAgeBrackets?.includes(bracket)) return false;
  if (intent.onlyAgeBrackets && !intent.onlyAgeBrackets.includes(bracket)) return false;
  return true;
}

/** Budget band a gift is expected to land in for a given ceiling. */
export function idealTierForBudget(maxBudget: number): GiftIntent['tier'] {
  if (maxBudget < 50) return 'stocking';
  if (maxBudget < 150) return 'standard';
  return 'hero';
}

// ── Scoring ────────────────────────────────────────────────────────────

export function scoreIntent(
  intent: GiftIntent,
  options: { budgetMax: number; gender: Gender; universal: boolean }
): ScoredIntent['breakdown'] {
  const { budgetMax, gender, universal } = options;

  const idealTier = idealTierForBudget(budgetMax);
  const withinBudget = TIER_PRICE[intent.tier] <= budgetMax;

  let tierFit = withinBudget ? TIER_IN_BUDGET_BONUS : -TIER_OVER_BUDGET_PENALTY;
  if (intent.tier === idealTier) tierFit += IDEAL_TIER_BONUS;

  // Gender is a nudge, never an exclusion. `unspecified` and `nonbinary`
  // deliberately score neutral: there is no defensible default lean.
  let leanNudge = 0;
  if (intent.lean !== 'neutral' && (gender === 'woman' || gender === 'man')) {
    leanNudge = intent.lean === gender ? LEAN_NUDGE : -LEAN_NUDGE;
  }

  return {
    strength: intent.strength,
    tierFit,
    leanNudge,
    universalBonus: universal ? UNIVERSAL_BONUS : 0,
  };
}

function totalScore(breakdown: ScoredIntent['breakdown']): number {
  return breakdown.strength + breakdown.tierFit + breakdown.leanNudge + breakdown.universalBonus;
}

// ── Brief ──────────────────────────────────────────────────────────────

export interface BuildGiftBriefOptions {
  /** Distinct searches to prepare. Clamped to 1..MAX_MAX_INTENTS. */
  maxIntents?: number;
}

/**
 * Build the deterministic brief for a recipient. Throws only if the index
 * itself is missing a bracket, which `validateGiftIndex` makes impossible.
 */
export function buildGiftBrief(
  recipient: GiftRecipient,
  options: BuildGiftBriefOptions = {}
): GiftBrief {
  const bracket = ageBracketForAge(recipient.age);
  const bracketProfile = AGE_BRACKET_PROFILES.find((profile) => profile.id === bracket);
  if (!bracketProfile) {
    throw new Error(`Gift index has no profile for age bracket "${bracket}"`);
  }

  const budgetMax = recipient.budget ?? bracketProfile.budgetCeiling;

  // ── Resolve interests against the bracket ──────────────────────────
  const appliedInterests: InterestId[] = [];
  const droppedInterests: GiftBrief['droppedInterests'] = [];

  for (const id of recipient.interests) {
    const profile = INTEREST_PROFILES.find((entry) => entry.id === id);
    if (!profile) continue; // unknown id — schemas reject these upstream
    if (appliedInterests.includes(id)) continue;

    if (profile.giftableAgeBrackets.includes(bracket)) {
      appliedInterests.push(id);
    } else {
      droppedInterests.push({
        id,
        reason: `${profile.label} is not a plausible gift for ${bracketProfile.label.toLowerCase()}.`,
      });
    }
  }

  // ── Candidate intents ──────────────────────────────────────────────
  const candidates: ScoredIntent[] = [];

  for (const intent of bracketProfile.universalIntents) {
    if (!isIntentOfferable(intent, bracket)) continue;
    const breakdown = scoreIntent(intent, { budgetMax, gender: recipient.gender, universal: true });
    candidates.push({
      intent,
      interest: null,
      interestLabel: 'Everyone',
      score: totalScore(breakdown),
      breakdown,
    });
  }

  for (const profile of INTEREST_PROFILES) {
    if (!appliedInterests.includes(profile.id)) continue;
    for (const intent of profile.intents) {
      if (!isIntentOfferable(intent, bracket)) continue;
      const breakdown = scoreIntent(intent, { budgetMax, gender: recipient.gender, universal: false });
      candidates.push({
        intent,
        interest: profile.id,
        interestLabel: profile.label,
        score: totalScore(breakdown),
        breakdown,
      });
    }
  }

  // Sort order is the determinism guarantee: score desc, id asc.
  candidates.sort((a, b) => b.score - a.score || a.intent.id.localeCompare(b.intent.id));

  const maxIntents = clampIntents(options.maxIntents ?? DEFAULT_MAX_INTENTS);
  const intents = selectGiftIntents(candidates, { maxIntents, gender: recipient.gender });

  return {
    recipientId: recipient.id,
    recipientName: recipient.name,
    gender: recipient.gender,
    age: recipient.age,
    ageBracket: bracket,
    ageBracketLabel: bracketProfile.label,
    appliedInterests,
    droppedInterests,
    budget: {
      min: 0,
      max: Math.round(budgetMax * 100) / 100,
      source: recipient.budget !== undefined ? 'recipient' : 'age_bracket',
    },
    exclusions: [...bracketProfile.exclusions],
    intents,
  };
}

function clampIntents(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return DEFAULT_MAX_INTENTS;
  return Math.min(MAX_MAX_INTENTS, Math.max(1, rounded));
}

/**
 * Pick the intents that will actually be searched.
 *
 * Three rules, applied in order:
 *  1. At most MAX_PER_INTEREST per interest, so one hobby cannot own the page.
 *  2. Fill the remaining slots from the ranking.
 *  3. When the shopper named a gender, at least half the set must be
 *     neutral-lean. This is what stops the lean from turning a gift list into
 *     a stereotype, and it is enforced on the *set*, not the order.
 */
export function selectGiftIntents(
  ranked: ScoredIntent[],
  options: { maxIntents: number; gender: Gender }
): ScoredIntent[] {
  const { maxIntents, gender } = options;
  const selected: ScoredIntent[] = [];
  const used = new Set<string>();
  const usedQueries = new Set<string>();
  const perInterest = new Map<string, number>();

  const interestKey = (entry: ScoredIntent) => entry.interest ?? UNIVERSAL_KEY;

  const canTake = (entry: ScoredIntent, enforceCap: boolean) => {
    if (used.has(entry.intent.id)) return false;
    // The same query can appear as both a bracket fallback and an interest
    // intent; running it twice would waste a provider request for identical
    // results, so only the higher-ranked copy survives.
    if (usedQueries.has(entry.intent.query.trim().toLowerCase())) return false;
    // Only a *named* interest is capped. Bracket-universal gifts are the
    // fallback pool, so capping them would make the requested count
    // unreachable for narrow interests.
    if (!enforceCap || entry.interest === null) return true;
    return (perInterest.get(interestKey(entry)) ?? 0) < MAX_PER_INTEREST;
  };

  const take = (predicate: (entry: ScoredIntent) => boolean, count: number) => {
    let taken = 0;
    for (const entry of ranked) {
      if (taken >= count) break;
      if (!predicate(entry)) continue;
      if (!canTake(entry, true)) continue;
      selected.push(entry);
      used.add(entry.intent.id);
      usedQueries.add(entry.intent.query.trim().toLowerCase());
      perInterest.set(interestKey(entry), (perInterest.get(interestKey(entry)) ?? 0) + 1);
      taken += 1;
    }
    return taken;
  };

  // A gendered shopper gets a neutral-majority set; an unspecified one is
  // scored neutral anyway, so no correction pass is needed.
  const neutralTarget = gender === 'woman' || gender === 'man' ? Math.ceil(maxIntents / 2) : 0;
  if (neutralTarget > 0) {
    take((entry) => entry.intent.lean === 'neutral', neutralTarget);
  }

  take(() => true, maxIntents - selected.length);

  // Present in score order regardless of how they were admitted. The set can
  // be smaller than requested only when the recipient has very few viable
  // interests; the diversity cap is never traded away to make up the number.
  return selected.sort((a, b) => b.score - a.score || a.intent.id.localeCompare(b.intent.id));
}
