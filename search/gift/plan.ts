// ── Gift intent → SearchPlan ────────────────────────────────────────────
//
// A gift intent is one search. This module turns it into a full
// `SearchPlan` the existing pipeline already understands, so gift results
// are planned, filtered, entity-resolved and ranked exactly like a normal
// search — the gift feature adds no second ranking path.

import { createFallbackPlan, withCategoryIntent } from '@/search/planner';
import type { ProviderId, SearchPlan, ShopperPreferences } from '@/search/types';
import type { GiftBrief, ScoredIntent } from './types';

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
 * own vocabulary count, without filtering anything out — gift results still
 * go through the normal balanced-mode pipeline.
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

/**
 * Build the plan for one gift intent.
 *
 * Inheritance, deliberately: everything the shopper's own preferences would
 * do to a normal search still applies (`ShopperPreferences` is passed
 * through). The gift layer only *adds* constraints — the budget ceiling,
 * the age-bracket title exclusions, and the intent's brand/category hints.
 */
export function buildGiftSearchPlan(
  scored: ScoredIntent,
  brief: GiftBrief,
  availableProviders: ProviderId[],
  preferences?: ShopperPreferences
): SearchPlan {
  const { intent } = scored;

  const base = createFallbackPlan(intent.query, availableProviders, {
    budget: {
      max: brief.budget.max,
      min: brief.budget.min > 0 ? brief.budget.min : undefined,
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
      canonicalIntent: `gift: ${intent.query}`,
      confidence: 0.75,
      sourceStrategy: { ...base.sourceStrategy, searchMode: 'all_eligible' },
      hardFilters: {
        ...base.hardFilters,
        // The brief's ceiling is authoritative: a recipient budget beats a
        // number inferred from the query text.
        maxPrice: brief.budget.max,
        minPrice: brief.budget.min > 0 ? brief.budget.min : base.hardFilters.minPrice,
        // Age-bracket safety and age-restriction terms.
        exclusions: dedupe([...(base.hardFilters.exclusions ?? []), ...brief.exclusions]),
        // Intent hints. These are soft — providers that cannot use them
        // report them as unsupported rather than pretending to filter.
        preferredBrands: dedupe([
          ...(base.hardFilters.preferredBrands ?? []),
          ...(intent.brands ?? []),
        ]),
        categoryHints: dedupe([
          ...(base.hardFilters.categoryHints ?? []),
          ...(intent.categories ?? []),
        ]).slice(0, 10),
        requiredFeatures: dedupe([
          ...(base.hardFilters.requiredFeatures ?? []),
          ...deriveGiftFeatures(intent.query),
        ]),
        allowedConditions: GIFT_CONDITIONS,
      },
    },
    intent.query
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
