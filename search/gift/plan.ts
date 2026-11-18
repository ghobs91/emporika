// ── Gift intent → SearchPlan ────────────────────────────────────────────
//
// A gift intent is one search. This module turns it into a full
// `SearchPlan` the existing pipeline already understands, so gift results
// are planned, filtered, entity-resolved and ranked exactly like a normal
// search — the gift feature adds no second ranking path.
//
// Two entry points:
//   • `buildPlanFromIntent` — used by the server, from a validated request
//     intent (no recipient data available, by design).
//   • `buildGiftSearchPlan` — used by probes/tests, from a compiled brief.

import { createFallbackPlan, withCategoryIntent } from '@/search/planner';
import type { ProviderId, SearchPlan, ShopperPreferences } from '@/search/types';
import type { GiftBrief, ScoredIntent } from './types';
import type { GiftIntentRequest } from './request';

/** Gifts are new-in-box by default; used stock is almost never the intent. */
const GIFT_CONDITIONS: Array<'new'> = ['new'];

/**
 * Words that carry no product meaning on their own. Dropped before building
 * relevance terms, otherwise "gift set" would score every title equally.
 */
const GENERIC_QUERY_WORDS = new Set([
  'set', 'kit', 'gift', 'for', 'with', 'and', 'the', 'a', 'an',
  'kids', 'mens', 'womens', 'new', 'best',
]);

/**
 * Turn a gift intent's query into ranking terms.
 *
 * The ranker gives `featureMatch` a free 1.0 when no features are requested,
 * so a marketplace listing that merely shares one keyword ("herb tobacco
 * grinder" for "coffee grinder") scores as well as the real thing. Giving the
 * ranker the phrase plus its first and last content word makes the intent's
 * own vocabulary count, without filtering anything out.
 */
export function deriveGiftFeatures(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const contentWords = normalized
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_QUERY_WORDS.has(word));

  const terms = [normalized];
  if (contentWords.length > 0) terms.push(contentWords[0]);
  if (contentWords.length > 1) terms.push(contentWords[contentWords.length - 1]);

  return Array.from(new Set(terms));
}

export interface GiftPlanInput {
  query: string;
  /** Hard ceiling. The recipient's budget is resolved client-side. */
  maxPrice?: number;
  minPrice?: number;
  brands?: string[];
  categories?: string[];
}

/**
 * Build the plan for one gift search.
 *
 * Inheritance, deliberately: everything the shopper's own preferences would do
 * to a normal search still applies. The gift layer only *adds* constraints —
 * the budget ceiling, the age-bracket title exclusions, and the intent's
 * brand/category hints.
 */
export function buildPlanFromIntent(
  input: GiftPlanInput,
  availableProviders: ProviderId[],
  preferences?: ShopperPreferences
): SearchPlan {
  const base = createFallbackPlan(input.query, availableProviders, {
    budget: {
      max: input.maxPrice,
      min: input.minPrice && input.minPrice > 0 ? input.minPrice : undefined,
      currency: 'USD',
    },
    preferredBrands: preferences?.preferredBrands,
    excludedBrands: preferences?.excludedBrands,
    includedProviders: preferences?.includedProviders,
    excludedProviders: preferences?.excludedProviders,
    allowedConditions: GIFT_CONDITIONS,
  });

  const merged = withCategoryIntent(
    {
      ...base,
      canonicalIntent: `gift: ${input.query}`,
      confidence: 0.75,
      sourceStrategy: { ...base.sourceStrategy, searchMode: 'all_eligible' },
      hardFilters: {
        ...base.hardFilters,
        // The brief's ceiling is authoritative: a resolved budget beats a
        // number inferred from the query text.
        maxPrice: input.maxPrice ?? base.hardFilters.maxPrice,
        minPrice: input.minPrice && input.minPrice > 0 ? input.minPrice : base.hardFilters.minPrice,
        exclusions: base.hardFilters.exclusions,
        preferredBrands: dedupe([
          ...(base.hardFilters.preferredBrands ?? []),
          ...(input.brands ?? []),
        ]),
        categoryHints: dedupe([
          ...(base.hardFilters.categoryHints ?? []),
          ...(input.categories ?? []),
        ]).slice(0, 10),
        requiredFeatures: dedupe([
          ...(base.hardFilters.requiredFeatures ?? []),
          ...deriveGiftFeatures(input.query),
        ]),
        allowedConditions: GIFT_CONDITIONS,
      },
    },
    input.query
  );

  // Cap hint lists at the schema's limits so a plan can never fail
  // validation on data the index author wrote.
  return {
    ...merged,
    hardFilters: {
      ...merged.hardFilters,
      exclusions: merged.hardFilters.exclusions?.slice(0, 20),
      preferredBrands: merged.hardFilters.preferredBrands?.slice(0, 20),
      requiredFeatures: merged.hardFilters.requiredFeatures?.slice(0, 20),
    },
  };
}

/** Compile one selected intent from a brief (probes, tests). */
export function buildGiftSearchPlan(
  scored: ScoredIntent,
  brief: GiftBrief,
  availableProviders: ProviderId[],
  preferences?: ShopperPreferences
): SearchPlan {
  return buildPlanFromIntent(
    {
      query: scored.intent.query,
      maxPrice: brief.budget.max,
      minPrice: brief.budget.min,
      brands: scored.intent.brands,
      categories: scored.intent.categories,
    },
    availableProviders,
    preferences
  );
}

/** Compile a validated request intent (server). */
export function buildPlanFromRequest(
  intent: GiftIntentRequest,
  availableProviders: ProviderId[],
  preferences?: ShopperPreferences
): SearchPlan {
  return buildPlanFromIntent(
    {
      query: intent.query,
      maxPrice: intent.maxPrice,
      brands: intent.brands,
      categories: intent.categories,
    },
    availableProviders,
    preferences
  );
}

/** Order-preserving de-dupe, case-insensitive, dropping empties. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}
