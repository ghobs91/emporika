'use client';

// ── Client-side gift ranking ────────────────────────────────────────────
//
// Everything here runs in the browser on data that is already on the device:
// the products the server searched for, the recipient profile, the semantic
// query vector, and the local behavioural ledger. The server's role is
// "search these words"; the judgement about what is a *good gift* is local.
//
// Pipeline:
//   type-tag → semantic distance → budget proximity → learned affinity
//          → deduplicate → rank → suggest bundles
//
// Weights are explicit and bounded so the result is explainable: every idea
// carries the component scores that put it where it is.

import { budgetFit, type BudgetFit } from './budget';
import { dedupeListings } from './dedupe';
import { affinity, isSuppressed, type Ledger } from './ledger';
import { classifyProductType, type ProductType } from './product-type';
import { semanticScore } from './semantic';

// ── Inputs ─────────────────────────────────────────────────────────────

export interface IdeaInput {
  product: import('@/search/types').RankedProduct;
  intentId: string;
  intentQuery: string;
  intentLabel: string;
  families: string[];
  why: string;
  position: number;
}

export interface RankOptions {
  /** Resolved budget ceiling (recipient override or age-bracket default). */
  budgetMax: number;
  /** Interests the brief actually applied. */
  interests: readonly string[];
  /** Per-recipient interaction history. */
  ledger: Ledger;
  recipientId: string;
  /** Raw free-text the shopper typed, used for the semantic component. */
  semanticQuery?: string | null;
  /** Query embedding (null when semantic search is off/failed). */
  semanticVector?: Float32Array | null;
  /** Per-product embeddings keyed by canonical id. */
  ideaVectors?: Map<string, Float32Array> | null;
  /** Keep replacement parts (DIY/repair profiles). */
  allowReplacementParts?: boolean;
  /** Index authoring hints keyed by intent id. */
  productTypeHints?: Record<string, ProductType>;
  /** Trend affinity per product (canonical id), from the static manifest. */
  trend?: Map<string, { score: number; term: string; category: string }>;
  /** Trend affinity per search query, so a whole trending search can lift. */
  intentTrend?: Map<string, { score: number; term: string; category: string }>;
  /**
   * Age-bracket title exclusions, applied here rather than on the server so the
   * recipient's age never has to be inferred from them in transit.
   */
  exclusions?: readonly string[];
  now?: number;
}

// ── Score weights ──────────────────────────────────────────────────────

export const RANK_WEIGHTS = {
  /** The retailer ranker's own ordering — still the strongest prior. */
  relevance: 0.30,
  /** How well the price sits in the budget's sweet spot. */
  budget: 0.24,
  /** Cosine similarity to the shopper's free-text, when available. */
  semantic: 0.20,
  /** Learned, decayed affinity from this recipient's own interactions. */
  affinity: 0.14,
  /** Alignment with the current trend manifest for this cohort. */
  trend: 0.12,
} as const;

/** Neutral semantic score: neither rewarded nor punished when disabled. */
const SEMANTIC_NEUTRAL = 0.5;

/** Multiplier applied by product type. Accessories are demoted, not hidden. */
const TYPE_MULTIPLIER: Record<ProductType, number> = {
  main: 1,
  consumable: 0.98,
  accessory: 0.86,
  replacement_part: 0.35,
};

/** Server position → 0–1. Half weight by position 10, a fifth by position 50. */
export function relevanceFromPosition(position: number): number {
  return 1 / (1 + Math.max(0, position) / 10);
}

/** `interest/coffee/espresso-machine-0` → `coffee`. */
export function interestFromIntentId(intentId: string): string | null {
  const parts = intentId.split('/');
  return parts[0] === 'interest' && parts.length > 1 ? parts[1] : null;
}

export interface RankedIdea extends IdeaInput {
  productType: ProductType;
  productTypeReason: string;
  interestIds: string[];
  price?: number;
  budget: BudgetFit;
  /** 0–1 cosine (null when semantic search is off). */
  semantic: number | null;
  /** −1..1 decayed affinity for this recipient. */
  affinity: number;
  /** Best matching trend term, when the manifest had one. */
  trend?: { score: number; term: string; category: string };
  score: number;
  /** Set when the idea is hidden from the main grid. */
  hiddenBy?: 'dismissed' | 'replacement_part' | 'age_excluded';
}

export interface Bundle {
  id: string;
  label: string;
  rationale: string;
  items: RankedIdea[];
}

export interface RankResult {
  ideas: RankedIdea[];
  bundles: Bundle[];
  hidden: { dismissed: number; replacementParts: number; ageExcluded: number };
  duplicatesRemoved: number;
}

// ── Ranking ────────────────────────────────────────────────────────────

export function rankGiftIdeas(input: IdeaInput[], options: RankOptions): RankResult {
  const now = options.now ?? Date.now();
  const allowParts = options.allowReplacementParts ?? false;

  // 1. Tag, score and attach explanations.
  const scored: RankedIdea[] = input.map((idea) => {
    const hint = options.productTypeHints?.[idea.intentId];
    const { type, reason } = classifyProductType(idea.product.product.title, hint);

    const price = idea.product.bestOffer?.offer.price?.amount;
    const fit = budgetFit(price, options.budgetMax);

    const vector = options.ideaVectors?.get(idea.product.product.canonicalId);
    const semantic =
      options.semanticVector && vector ? semanticScore(options.semanticVector, vector) : null;

    const interestIds = Array.from(
      new Set(
        [interestFromIntentId(idea.intentId), ...options.interests.filter((i) => idea.families.includes('interest') && idea.intentId.includes(`/${i}/`))]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );

    const typeAffinity = affinity(
      options.ledger,
      { recipientId: options.recipientId, dimension: 'productType', key: type },
      now
    );
    const intentAffinity = affinity(
      options.ledger,
      { recipientId: options.recipientId, dimension: 'intent', key: idea.intentId },
      now
    );
    // Interest-level affinity: the spec's "jewelry keeps getting dismissed"
    // signal, applied per interest the idea belongs to.
    const interestAffinities = interestIds.map((id) =>
      affinity(options.ledger, { recipientId: options.recipientId, dimension: 'interest', key: id }, now)
    );
    const interestAffinity =
      interestAffinities.length > 0
        ? interestAffinities.reduce((sum, value) => sum + value, 0) / interestAffinities.length
        : 0;

    const ideaAffinity = typeAffinity * 0.45 + intentAffinity * 0.35 + interestAffinity * 0.2;

    // Trend boost: a title that *is* a trending concept counts fully; a product
    // from a search that is trending counts at 70%, because the listing itself
    // may not be the trending thing.
    const productTrend = options.trend?.get(idea.product.product.canonicalId);
    const intentTrend = options.intentTrend?.get(idea.intentQuery);
    const intentTrendScore = (intentTrend?.score ?? 0) * 0.7;
    const trend =
      (productTrend?.score ?? 0) >= intentTrendScore ? productTrend : intentTrend;
    const trendScore = Math.max(productTrend?.score ?? 0, intentTrendScore);

    const base =
      RANK_WEIGHTS.relevance * relevanceFromPosition(idea.position) +
      RANK_WEIGHTS.budget * fit.score +
      RANK_WEIGHTS.semantic * (semantic ?? SEMANTIC_NEUTRAL) +
      RANK_WEIGHTS.affinity * ((ideaAffinity + 1) / 2) +
      RANK_WEIGHTS.trend * trendScore;

    let hiddenBy: RankedIdea['hiddenBy'];
    // Suppression is intentionally narrow: one "not for them" hides that idea
    // (the UI filters it immediately), while hiding a whole *search* or
    // *interest* needs repeated evidence. Product type only ever demotes.
    const title = idea.product.product.title.toLowerCase();
    const ageExcluded = (options.exclusions ?? []).some((term) =>
      title.includes(term.toLowerCase())
    );

    if (ageExcluded) hiddenBy = 'age_excluded';
    else if (type === 'replacement_part' && !allowParts) hiddenBy = 'replacement_part';
    else if (isSuppressed(intentAffinity) || isSuppressed(interestAffinity)) hiddenBy = 'dismissed';

    return {
      ...idea,
      productType: type,
      productTypeReason: reason,
      interestIds,
      price,
      budget: fit,
      semantic,
      affinity: ideaAffinity,
      trend: trendScore > 0 && trend ? { score: trendScore, term: trend.term, category: trend.category } : undefined,
      score: base * TYPE_MULTIPLIER[type],
      hiddenBy,
    };
  });

  // 2. Deduplicate near-identical listings across intents.
  const deduped = dedupeListings(
    scored.map((idea) => ({ product: idea.product, key: idea.product.product.canonicalId, idea }))
  );
  const unique = deduped.kept.map((entry) => entry.idea);

  // 3. Rank.
  unique.sort((a, b) => b.score - a.score || a.position - b.position);
  const visible = unique.filter((idea) => !idea.hiddenBy);

  return {
    ideas: visible,
    bundles: buildBundles(visible, options),
    hidden: {
      dismissed: unique.filter((idea) => idea.hiddenBy === 'dismissed').length,
      replacementParts: unique.filter((idea) => idea.hiddenBy === 'replacement_part').length,
      ageExcluded: unique.filter((idea) => idea.hiddenBy === 'age_excluded').length,
    },
    duplicatesRemoved: deduped.removed.length,
  };
}

// ── Bundling ───────────────────────────────────────────────────────────

const PARTNER_TYPES = new Set<ProductType>(['consumable', 'accessory']);

/**
 * Pair a core gift with a related consumable/accessory.
 *
 * Only runs when the recipient gave more than one interest — the spec's case
 * ("Cooking" and "Baking" both active) — so a single-interest profile does not
 * get arbitrary add-ons. A bundle must not exceed the budget by more than 15%.
 */
export function buildBundles(ideas: RankedIdea[], options: RankOptions): Bundle[] {
  if (options.interests.length < 2) return [];

  const bundles: Bundle[] = [];
  const used = new Set<string>();
  const budget = options.budgetMax;

  const partnerFor = (core: RankedIdea, requireComplementary: boolean): RankedIdea | undefined =>
    ideas.find((candidate) => {
      if (candidate === core) return false;
      if (used.has(candidate.product.product.canonicalId)) return false;
      if (candidate.intentId === core.intentId) return false;
      if (requireComplementary && !PARTNER_TYPES.has(candidate.productType)) return false;

      // Different interest is the point of a bundle: "cooking tool + baking".
      const differentInterest =
        candidate.interestIds.some((id) => !core.interestIds.includes(id)) ||
        (candidate.interestIds.length === 0 && core.interestIds.length === 0);
      if (!differentInterest) return false;

      if (core.price && candidate.price && core.price + candidate.price > budget * 1.15) return false;
      return true;
    });

  for (const core of ideas) {
    if (bundles.length >= 2) break;
    if (core.productType !== 'main') continue;
    if (used.has(core.product.product.canonicalId)) continue;

    // Prefer the spec's case — a tool plus something that gets used up. If the
    // searches returned no consumable/accessory, fall back to a second gift
    // from the other interest, which is still a better suggestion than nothing.
    const complementary = partnerFor(core, true);
    const partner = complementary ?? partnerFor(core, false);
    if (!partner) continue;

    used.add(core.product.product.canonicalId);
    used.add(partner.product.product.canonicalId);
    bundles.push({
      id: `${core.intentId}::${partner.intentId}`,
      label: `${core.intentLabel} + ${partner.intentLabel}`,
      rationale: complementary
        ? 'One thing to use and one thing that gets used up — a complete gift from two interests.'
        : 'Two interests, two gifts: the pair covers both hobbies without doubling up.',
      items: [core, partner],
    });
  }

  return bundles;
}
