// ── Deterministic recipient → gift brief ────────────────────────────────
//
// The index is a matrix, and this is the query planner for it. Facets are
// scored, combined and then *allocated*, so a recipient's age, gender,
// interests and brands each get their own slot in the final set.
//
// Scoring (all bounded, all editorial):
//   strength          the index's own confidence that this is a good gift
//   tierFit           whether the gift's price tier matches the budget
//   leanNudge         ±0.04 for retail-merchandising lean (never a filter)
//   universalBonus    +0.02 so a neutral fallback always stays in reach
//   combinationBonus  +0.05 per extra trait the intent answers
//   ageAffinity       +0.04 inside the interest's prime age window
//
// Allocation, in order:
//   1. one slot per active facet family (age, gender, combo, interest, brand)
//   2. fill the rest by score
//   3. at most 2 intents per source, so one hobby cannot own the page
//   4. neutral majority whenever the shopper named a binary gender

import { AGE_BRACKET_PROFILES, COMBO_INTENTS, GENDER_INTENTS, INTEREST_PROFILES } from './index-data';
import { BRANDS } from './brands';
import { ageBracketForAge } from './taxonomy';
import {
  FACET_FAMILIES,
  TIER_PRICE,
  facetFamily,
  type AgeBracket,
  type FacetFamily,
  type Gender,
  type GiftBrief,
  type GiftIntent,
  type GiftRecipient,
  type InterestId,
  type ScoredIntent,
  type ScoredIntent as ScoredIntentType,
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
/** Every additional recipient trait an intent answers is worth this much. */
export const COMBINATION_BONUS = 0.05;
/** Intent sits inside the interest's prime age window. */
export const AGE_AFFINITY_BONUS = 0.04;

/** Default number of distinct searches per "gift ideas" request. */
export const DEFAULT_MAX_INTENTS = 6;
export const MAX_MAX_INTENTS = 8;
/** Keeps one source (an interest, a brand, a bracket) from owning the page. */
export const MAX_PER_SOURCE = 2;
/** Brand intents considered per profile. Brands are the widest layer. */
export const MAX_BRAND_CANDIDATES = 14;

const UNIVERSAL_KEY = '__universal__';

// ── Gates ──────────────────────────────────────────────────────────────

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

/** Facet families an intent answers, deduped and in canonical order. */
export function intentFamilies(intent: GiftIntent): FacetFamily[] {
  const present = new Set<FacetFamily>();
  for (const facet of intent.facets) {
    const family = facetFamily(facet);
    if (family) present.add(family);
  }
  return FACET_FAMILIES.filter((family) => present.has(family));
}

// ── Scoring ────────────────────────────────────────────────────────────

export function scoreIntent(
  intent: GiftIntent,
  options: {
    budgetMax: number;
    gender: Gender;
    universal?: boolean;
    ageAffinity?: boolean;
  }
): ScoredIntent['breakdown'] {
  const { budgetMax, gender, universal = false, ageAffinity = false } = options;

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

  const families = intentFamilies(intent);
  const combinationBonus = COMBINATION_BONUS * Math.max(0, families.length - 1);

  return {
    strength: intent.strength,
    tierFit,
    leanNudge,
    universalBonus: universal ? UNIVERSAL_BONUS : 0,
    combinationBonus,
    ageAffinity: ageAffinity ? AGE_AFFINITY_BONUS : 0,
  };
}

export function totalScore(breakdown: ScoredIntent['breakdown']): number {
  return (
    breakdown.strength +
    breakdown.tierFit +
    breakdown.leanNudge +
    breakdown.universalBonus +
    breakdown.combinationBonus +
    breakdown.ageAffinity
  );
}

// ── Candidate assembly ─────────────────────────────────────────────────

interface Candidate {
  intent: GiftIntent;
  interest: InterestId | null;
  interestLabel: string;
  sourceKey: string;
  ageAffinity: boolean;
  universal: boolean;
}

function labelForInterest(id: InterestId): string {
  return INTEREST_PROFILES.find((profile) => profile.id === id)?.label ?? id;
}

/**
 * Brand intents: the combinatorial layer. A brand only becomes a candidate
 * when it fits the recipient's age and either matches one of their interests
 * or — when no interests were given — is a plausible standalone gift brand.
 */
function brandCandidates(
  bracket: AgeBracket,
  gender: Gender,
  interests: InterestId[]
): Candidate[] {
  const scored = BRANDS.filter((brand) => brand.ages.includes(bracket))
    .map((brand) => {
      const matched = brand.interests.filter((interest) => interests.includes(interest));
      const genderFit =
        gender === 'woman' || gender === 'man'
          ? brand.lean === gender
            ? 1
            : brand.lean === 'neutral'
              ? 0
              : -1
          : 0;
      return { brand, matched, genderFit };
    })
    // With interests given, a brand must serve one of them. Without, brand is
    // allowed to stand alone — that is the "gender/age only" path.
    .filter(({ matched }) => (interests.length > 0 ? matched.length > 0 : true))
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length ||
        b.genderFit - a.genderFit ||
        b.brand.strength - a.brand.strength ||
        a.brand.name.localeCompare(b.brand.name)
    )
    .slice(0, MAX_BRAND_CANDIDATES);

  return scored.map(({ brand, matched }) => {
    // "LEGO" + "lego set" would search "LEGO lego set"; strip a leading brand
    // token so the noun adds information.
    const noun = brand.categories[0]
      .replace(new RegExp(`^${brand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '')
      .trim();
    const facets = [
      `brand:${brand.slug}`,
      ...matched.map((interest) => `interest:${interest}`),
    ];
    const intent: GiftIntent = {
      id: `brand/${brand.slug}-${brand.categories[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30)}`,
      query: noun ? `${brand.name} ${noun}` : brand.name,
      kind: 'brand',
      tier: brand.tier,
      strength: brand.strength,
      lean: brand.lean,
      facets,
      brands: [brand.name],
      why: matched.length
        ? `A ${brand.name} gift aimed squarely at ${labelForInterest(matched[0]).toLowerCase()}.`
        : `${brand.name} is a safe, well-known choice when you only know who they are.`,
    };

    return {
      intent,
      interest: matched[0] ?? null,
      interestLabel: matched.length ? labelForInterest(matched[0]) : brand.name,
      sourceKey: `brand:${brand.slug}`,
      ageAffinity: false,
      universal: false,
    };
  });
}

// ── Brief ──────────────────────────────────────────────────────────────

export interface BuildGiftBriefOptions {
  /** Distinct searches to prepare. Clamped to 1..MAX_MAX_INTENTS. */
  maxIntents?: number;
}

/**
 * Every candidate intent for a recipient, scored and ordered — the full
 * matrix slice *before* allocation. Exposed because the interesting
 * behaviours (combination bonus, age affinity, brand promotion) are properties
 * of the pool, not of the final six.
 */
export function rankGiftCandidates(recipient: GiftRecipient): {
  bracket: AgeBracket;
  bracketLabel: string;
  budgetMax: number;
  appliedInterests: InterestId[];
  droppedInterests: GiftBrief['droppedInterests'];
  exclusions: string[];
  ranked: ScoredIntent[];
} {
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
    if (!profile) continue;
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

  // ── Candidate intents, one list per layer ──────────────────────────
  const candidates: Candidate[] = [];

  const push = (
    intent: GiftIntent,
    sourceKey: string,
    interest: InterestId | null,
    interestLabel: string,
    ageAffinity: boolean,
    universal = false
  ) => {
    if (!isIntentOfferable(intent, bracket)) return;
    candidates.push({ intent, interest, interestLabel, sourceKey, ageAffinity, universal });
  };

  // Universal fallbacks (always appropriate).
  for (const entry of bracketProfile.universalIntents) {
    push(entry, UNIVERSAL_KEY, null, 'Everyone', false, true);
  }

  // Age alone.
  for (const entry of bracketProfile.ageIntents) {
    push(entry, `age:${bracket}`, null, bracketProfile.label, false);
  }

  // Gender alone. `nonbinary` and `unspecified` deliberately get no gender
  // intents: there is no merchandising layer to assert for them, and the age,
  // interest and brand layers already cover the profile.
  if (recipient.gender === 'woman' || recipient.gender === 'man') {
    const genderIntents = GENDER_INTENTS[recipient.gender];
    const label = recipient.gender === 'woman' ? 'Women’s gifting' : 'Men’s gifting';
    for (const entry of genderIntents) {
      push(entry, `gender:${recipient.gender}`, null, label, false);
    }
  }

  // Age × gender combinations.
  for (const entry of COMBO_INTENTS_FOR(bracket, recipient.gender)) {
    push(
      entry,
      `combo:${bracket}:${recipient.gender}`,
      null,
      `${bracketProfile.label} · ${recipient.gender === 'woman' ? 'women' : 'men'}`,
      false
    );
  }

  // Interest layer, with the prime-age window as the age signal.
  for (const profile of INTEREST_PROFILES) {
    if (!appliedInterests.includes(profile.id)) continue;
    const prime = profile.primeAgeBrackets ?? profile.giftableAgeBrackets;
    for (const entry of profile.intents) {
      push(entry, `interest:${profile.id}`, profile.id, profile.label, prime.includes(bracket));
    }
  }

  // Brand layer.
  for (const candidate of brandCandidates(bracket, recipient.gender, appliedInterests)) {
    if (!isIntentOfferable(candidate.intent, bracket)) continue;
    candidates.push(candidate);
  }

  // ── Score and order ────────────────────────────────────────────────
  const scored: ScoredIntent[] = candidates.map((candidate) => {
    const breakdown = scoreIntent(candidate.intent, {
      budgetMax,
      gender: recipient.gender,
      universal: candidate.universal,
      ageAffinity: candidate.ageAffinity,
    });
    return {
      intent: candidate.intent,
      interest: candidate.interest,
      interestLabel: candidate.interestLabel,
      sourceKey: candidate.sourceKey,
      families: intentFamilies(candidate.intent),
      score: totalScore(breakdown),
      breakdown,
    };
  });

  // Determinism: score desc, then id asc.
  scored.sort((a, b) => b.score - a.score || a.intent.id.localeCompare(b.intent.id));

  return {
    bracket,
    bracketLabel: bracketProfile.label,
    budgetMax,
    appliedInterests,
    droppedInterests,
    exclusions: [...bracketProfile.exclusions],
    ranked: scored,
  };
}

export function buildGiftBrief(
  recipient: GiftRecipient,
  options: BuildGiftBriefOptions = {}
): GiftBrief {
  const pool = rankGiftCandidates(recipient);
  const maxIntents = clampIntents(options.maxIntents ?? DEFAULT_MAX_INTENTS);
  const intents = selectGiftIntents(pool.ranked, { maxIntents, gender: recipient.gender });

  return {
    recipientId: recipient.id,
    recipientName: recipient.name,
    gender: recipient.gender,
    age: recipient.age,
    ageBracket: pool.bracket,
    ageBracketLabel: pool.bracketLabel,
    appliedInterests: pool.appliedInterests,
    droppedInterests: pool.droppedInterests,
    budget: {
      min: 0,
      max: Math.round(pool.budgetMax * 100) / 100,
      source: recipient.budget !== undefined ? 'recipient' : 'age_bracket',
    },
    exclusions: pool.exclusions,
    excludedProviders: [...(recipient.excludedProviders ?? [])],
    intents,
    coverage: coverageOf(intents),
  };
}

/** True when `query` duplicates, or merely prefixes/suffixes, a selected one. */
export function isRedundantQuery(query: string, selected: Set<string>): boolean {
  const candidate = query.trim().toLowerCase();
  if (selected.has(candidate)) return true;
  for (const existing of selected) {
    if (candidate.includes(existing) || existing.includes(candidate)) return true;
  }
  return false;
}

function COMBO_INTENTS_FOR(bracket: AgeBracket, gender: Gender): GiftIntent[] {
  if (gender !== 'woman' && gender !== 'man') return [];
  return COMBO_INTENTS.filter((intent) => intent.facets.includes(`combo:${bracket}:${gender}`));
}

function clampIntents(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return DEFAULT_MAX_INTENTS;
  return Math.min(MAX_MAX_INTENTS, Math.max(1, rounded));
}

/** How many selected intents answer each family. */
export function coverageOf(intents: ScoredIntentType[]): Record<FacetFamily, number> {
  const coverage: Record<FacetFamily, number> = {
    age: 0,
    gender: 0,
    combo: 0,
    interest: 0,
    brand: 0,
  };
  for (const entry of intents) {
    for (const family of entry.families) coverage[family] += 1;
  }
  return coverage;
}

// ── Selection ──────────────────────────────────────────────────────────

/**
 * Allocate the final set.
 *
 * Pass 1 (coverage) is what stops the brief from collapsing onto interests:
 * every active facet family gets a slot before anything is picked purely by
 * score. Those slots are protected — a gendered combination satisfies
 * "gender" and "combo" and must not be swapped out later.
 *
 * Pass 2 fills the remainder, preferring neutral intents until the set is
 * half neutral when the shopper named a binary gender. Pass 3 tops up from the
 * fill slots only if that still fell short.
 *
 * A per-source cap bounds how much any single interest, brand or bracket can
 * contribute.
 */
export function selectGiftIntents(
  ranked: ScoredIntent[],
  options: { maxIntents: number; gender: Gender }
): ScoredIntent[] {
  const { maxIntents, gender } = options;
  const selected: ScoredIntent[] = [];
  const used = new Set<string>();
  const usedQueries = new Set<string>();
  const perSource = new Map<string, number>();
  const isGendered = gender === 'woman' || gender === 'man';
  const neutralTarget = isGendered ? Math.ceil(maxIntents / 2) : 0;
  // Brands are a garnish: at most one per interest and a third of the page,
  // otherwise a brand-rich catalog drowns the age/interest layers.
  const maxBrandSlots = Math.max(1, Math.ceil(maxIntents / 3));
  let brandSlots = 0;
  const brandInterests = new Set<string>();

  const canTake = (entry: ScoredIntent) => {
    if (used.has(entry.intent.id)) return false;
    // The same query can appear in several layers; running it twice wastes a
    // provider request for identical results. A query that *contains* an
    // already-selected one is the same shopping trip with a brand prefix
    // ("Breville espresso machine" after "espresso machine"), so it is
    // redundant too — that is what stopped brands from crowding out the
    // interest they were meant to complement.
    if (isRedundantQuery(entry.intent.query, usedQueries)) return false;
    // Universal fallbacks are the safety net, so they are never capped.
    if (entry.sourceKey === UNIVERSAL_KEY) return true;
    if ((perSource.get(entry.sourceKey) ?? 0) >= MAX_PER_SOURCE) return false;

    if (entry.families.includes('brand')) {
      if (brandSlots >= maxBrandSlots) return false;
      const interestFacet = entry.intent.facets.find((facet) => facet.startsWith('interest:'));
      if (interestFacet && brandInterests.has(interestFacet)) return false;
    }
    return true;
  };

  const take = (predicate: (entry: ScoredIntent) => boolean, count: number) => {
    let taken = 0;
    for (const entry of ranked) {
      if (taken >= count) break;
      if (!predicate(entry)) continue;
      if (!canTake(entry)) continue;
      selected.push(entry);
      used.add(entry.intent.id);
      usedQueries.add(entry.intent.query.trim().toLowerCase());
      perSource.set(entry.sourceKey, (perSource.get(entry.sourceKey) ?? 0) + 1);
      if (entry.families.includes('brand')) {
        brandSlots += 1;
        const interestFacet = entry.intent.facets.find((facet) => facet.startsWith('interest:'));
        if (interestFacet) brandInterests.add(interestFacet);
      }
      taken += 1;
    }
    return taken;
  };

  const neutralCount = () =>
    selected.filter((entry) => entry.intent.lean === 'neutral').length;

  // Pass 1 — one slot per facet family present in this profile. For the
  // neutral-capable families, a neutral intent covers the family when one
  // exists, so a gendered combination cannot occupy the "age" slot and leave
  // the page with no neutral gifts at all.
  for (const family of FACET_FAMILIES) {
    if (selected.length >= maxIntents) break;
    const before = selected.length;
    if (family === 'age' || family === 'brand' || family === 'interest') {
      take((entry) => entry.families.includes(family) && entry.intent.lean === 'neutral', 1);
    }
    if (selected.length === before) {
      take((entry) => entry.families.includes(family), 1);
    }
  }
  const coverageSlots = selected.length;

  // Pass 2 — top up to the neutral target first, then fill by score.
  if (neutralTarget > 0 && neutralCount() < neutralTarget) {
    take(
      (entry) => entry.intent.lean === 'neutral',
      Math.min(neutralTarget - neutralCount(), maxIntents - selected.length)
    );
  }
  take(() => true, maxIntents - selected.length);

  // Pass 3 — if the fill still left the set short of a neutral majority, swap
  // only fill slots (coverage stays intact).
  if (neutralTarget > 0 && neutralCount() < neutralTarget) {
    const removable = selected
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => index >= coverageSlots && entry.intent.lean !== 'neutral')
      .sort((a, b) => a.entry.score - b.entry.score || b.entry.intent.id.localeCompare(a.entry.intent.id));

    for (const { entry, index } of removable) {
      if (neutralCount() >= neutralTarget) break;
      const replacement = ranked.find(
        (candidate) =>
          candidate.intent.lean === 'neutral' &&
          !used.has(candidate.intent.id) &&
          !isRedundantQuery(candidate.intent.query, usedQueries)
      );
      if (!replacement) break;
      selected[index] = replacement;
      used.delete(entry.intent.id);
      usedQueries.delete(entry.intent.query.trim().toLowerCase());
      used.add(replacement.intent.id);
      usedQueries.add(replacement.intent.query.trim().toLowerCase());
      if (replacement.families.includes('brand')) brandSlots += 1;
    }
  }

  return selected.sort((a, b) => b.score - a.score || a.intent.id.localeCompare(b.intent.id));
}
