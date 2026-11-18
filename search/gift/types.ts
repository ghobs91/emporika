// ── Gift recipient domain types ─────────────────────────────────────────
//
// The index is a *matrix*, not a list: every gift intent declares which
// recipient traits it answers (`facets`). That is what lets "woman", "34" and
// "likes coffee" each produce a usable list on their own, and lets a
// combination outrank any single trait.
//
// Facet ids are plain strings with a stable prefix so the data file stays
// readable and the schema can validate them with one regex:
//
//   age:<bracket>              e.g. age:toddler
//   gender:<gender>            e.g. gender:woman
//   combo:<bracket>:<gender>   e.g. combo:young_adult:man
//   interest:<interestId>      e.g. interest:coffee
//   brand:<slug>               e.g. brand:nike

// ── Recipient inputs ───────────────────────────────────────────────────

export const GENDERS = ['woman', 'man', 'nonbinary', 'unspecified'] as const;
export type Gender = (typeof GENDERS)[number];

export const AGE_BRACKETS = [
  'infant',
  'toddler',
  'child',
  'tween',
  'teen',
  'young_adult',
  'adult',
  'mature_adult',
  'senior',
] as const;
export type AgeBracket = (typeof AGE_BRACKETS)[number];

export interface GiftRecipient {
  id: string;
  name: string;
  gender: Gender;
  /** Age in years. Drives the age bracket, never the gender. */
  age: number;
  /** Interest ids from `INTEREST_IDS`. Order is preserved but not ranked. */
  interests: InterestId[];
  /** Optional hard budget ceiling in USD for this recipient. */
  budget?: number;
  /**
   * Retailers to leave out of this person's searches. Persisted with the
   * recipient so "no eBay for my dad" only has to be set once.
   */
  excludedProviders?: string[];
  createdAt: number;
  updatedAt: number;
}

// ── Interest taxonomy ──────────────────────────────────────────────────

export const INTEREST_GROUPS = [
  'food_drink',
  'home',
  'tech',
  'style',
  'outdoors',
  'fitness',
  'creative',
  'media',
  'life',
] as const;
export type InterestGroup = (typeof INTEREST_GROUPS)[number];

export const INTEREST_IDS = [
  // food & drink
  'coffee',
  'tea',
  'cooking',
  'baking',
  'grilling',
  'wine_spirits',
  // home
  'home_decor',
  'candles_scents',
  'gardening',
  'organization',
  // tech
  'tech_gadgets',
  'audio',
  'gaming',
  'photography',
  'smart_home',
  // style
  'beauty_skincare',
  'fashion_accessories',
  'jewelry',
  'watches',
  // outdoors
  'camping',
  'hiking',
  'cycling',
  'fishing',
  // fitness
  'fitness',
  'running',
  'yoga',
  // creative
  'crafts_diy',
  'art_supplies',
  // media
  'reading',
  'music',
  'board_games',
  // life
  'pets',
  'toys_play',
  'travel',
  'tools_diy',
] as const;
export type InterestId = (typeof INTEREST_IDS)[number];

export interface InterestSummary {
  id: InterestId;
  label: string;
  group: InterestGroup;
  /** Short example gifts, shown in the recipient picker. */
  teaser: string;
}

// ── Facets ─────────────────────────────────────────────────────────────

export const FACET_FAMILIES = ['age', 'gender', 'combo', 'interest', 'brand'] as const;
export type FacetFamily = (typeof FACET_FAMILIES)[number];
export type FacetId = string;

export function ageFacet(bracket: AgeBracket): FacetId {
  return `age:${bracket}`;
}
export function genderFacet(gender: Gender): FacetId {
  return `gender:${gender}`;
}
export function comboFacet(bracket: AgeBracket, gender: Gender): FacetId {
  return `combo:${bracket}:${gender}`;
}
export function interestFacet(id: InterestId): FacetId {
  return `interest:${id}`;
}
export function brandFacet(slug: string): FacetId {
  return `brand:${slug}`;
}

/** Which family a facet id belongs to; unknown ids are ignored by selection. */
export function facetFamily(id: FacetId): FacetFamily | null {
  const head = id.slice(0, id.indexOf(':'));
  return (FACET_FAMILIES as readonly string[]).includes(head) ? (head as FacetFamily) : null;
}

// ── Gift intents ───────────────────────────────────────────────────────

/**
 * How much the gift costs. Used to keep a $400 espresso machine out of a
 * toddler's stocking and to prefer small items when the budget is tight.
 */
export type GiftTier = 'stocking' | 'standard' | 'hero';

export type IntentKind = 'category' | 'brand' | 'product';

export type Lean = 'neutral' | 'woman' | 'man';

/** Typical USD price per tier — used to score tier fit, never to filter. */
export const TIER_PRICE: Record<GiftTier, number> = {
  stocking: 20,
  standard: 60,
  hero: 160,
};

export interface GiftIntent {
  /** Stable `<source>/<slug>` id. Also the deterministic sort tiebreaker. */
  id: string;
  /** The literal retailer search query. Must return real listings. */
  query: string;
  kind: IntentKind;
  tier: GiftTier;
  /**
   * 0–1 confidence that this reads as a good gift for a recipient that
   * matches every facet on this intent. Editorial, not learned.
   */
  strength: number;
  /**
   * Retail-merchandising lean. Only ever nudges the ordering (±0.04), and the
   * selector keeps a neutral majority — see `./brief.ts`.
   */
  lean: Lean;
  /** Every recipient trait this intent answers. Drives combination scoring. */
  facets: FacetId[];
  /** Brackets where this must never be offered (alcohol, safety, complexity). */
  avoidAgeBrackets?: AgeBracket[];
  /** When set, ONLY these brackets may receive this intent (e.g. board books). */
  onlyAgeBrackets?: AgeBracket[];
  /** Brand names worth boosting when they appear in results. */
  brands?: string[];
  /** Category words, used as provider category hints where supported. */
  categories?: string[];
  /** Shopper-facing explanation rendered next to the result. */
  why: string;
}

/** Compact authoring shape accepted by `buildIntents` in `./index-data.ts`. */
export interface IntentSpec {
  /** Query text. */
  q: string;
  /** Strength; defaults to 0.7. */
  s?: number;
  /** Tier; defaults to 'standard'. */
  t?: GiftTier;
  /** Lean; defaults to 'neutral'. */
  l?: Lean;
  /** Brands to boost. */
  b?: string[];
  /** Category hints. */
  c?: string[];
  /** Shopper-facing reason (required). */
  w: string;
  /** Age brackets to exclude. */
  avoid?: AgeBracket[];
  /** Age brackets this is exclusive to. */
  only?: AgeBracket[];
  /** Intent kind; defaults to 'product'. */
  k?: IntentKind;
}

export interface InterestProfile {
  id: InterestId;
  label: string;
  group: InterestGroup;
  /** Brackets where this interest is plausible for a gift at all. */
  giftableAgeBrackets: AgeBracket[];
  /**
   * Brackets where this interest is at its most active — the "age + interest"
   * signal. A gift in the prime window scores higher than the same gift
   * outside it, without needing a hand-written row per age.
   */
  primeAgeBrackets?: AgeBracket[];
  intents: GiftIntent[];
}

// ── Brands ─────────────────────────────────────────────────────────────

/**
 * A brand the matrix can turn into concrete searches.
 *
 * `categories` are product nouns, not marketing categories: the query built
 * for a recipient is `"<brand> <noun>"`. `strength` is editorial; the brand
 * catalog is additionally checked against live retailer inventory by
 * `scripts/probe-brand-catalog.ts`, which records whether the brand actually
 * has listings and how established those listings look.
 */
export interface BrandProfile {
  /** Search name, e.g. "New Balance". */
  name: string;
  /** URL/id-safe slug, e.g. "new-balance". */
  slug: string;
  /** Product nouns to pair with the brand. First entry is the default. */
  categories: string[];
  tier: GiftTier;
  strength: number;
  lean: Lean;
  /** Brackets where the brand is a plausible gift (not marketing segments). */
  ages: AgeBracket[];
  /** Interests this brand serves. Empty means it fits any interest. */
  interests: InterestId[];
}

// ── Age brackets ───────────────────────────────────────────────────────

export interface AgeBracketProfile {
  id: AgeBracket;
  label: string;
  /** Inclusive lower bound, in years. */
  minAge: number;
  /** Inclusive upper bound in years; `null` means open-ended. */
  maxAge: number | null;
  /**
   * Hard budget ceiling for a gift to this bracket, applied when the
   * shopper has not set one. Deliberately generous.
   */
  budgetCeiling: number;
  /**
   * Substring exclusions applied to product titles. Kept to unambiguous
   * phrases because `search/filter.ts` does substring matching.
   */
  exclusions: string[];
  /** Always-appropriate, gender-neutral starting points for this bracket. */
  universalIntents: GiftIntent[];
  /** Gifts that stand on the bracket alone, independent of any interest. */
  ageIntents: GiftIntent[];
}

// ── Compiled brief (index → search-ready) ──────────────────────────────

export interface ScoredIntent {
  intent: GiftIntent;
  /** Interest the intent came from, or `null` for age/gender/universal. */
  interest: InterestId | null;
  /** Human-readable provenance, e.g. "Coffee", "Adult (26–40)", "Nike". */
  interestLabel: string;
  /**
   * Authoring source this intent came from (`interest:coffee`, `age:adult`,
   * `gender:woman`, `combo:adult:woman`, `brand:nike`). Used to cap how much
   * one source can contribute, so no single trait can own the page.
   */
  sourceKey: string;
  /** Deterministic score; higher wins. */
  score: number;
  /** Facet families this intent answers (deduped, in FACET_FAMILIES order). */
  families: FacetFamily[];
  breakdown: {
    strength: number;
    tierFit: number;
    leanNudge: number;
    universalBonus: number;
    /** Bonus for answering more than one recipient trait at once. */
    combinationBonus: number;
    /** Bonus when the recipient is inside the interest's prime age window. */
    ageAffinity: number;
  };
}

export interface GiftBrief {
  recipientId: string;
  recipientName: string;
  gender: Gender;
  age: number;
  ageBracket: AgeBracket;
  ageBracketLabel: string;
  /** Interests that actually apply at this age, in index order. */
  appliedInterests: InterestId[];
  /** Interests the shopper picked that the age bracket rules out. */
  droppedInterests: Array<{ id: InterestId; reason: string }>;
  /** Budget actually used for this brief (recipient override or bracket). */
  budget: { min: number; max: number; source: 'recipient' | 'age_bracket' };
  /** Title substring exclusions for this bracket. */
  exclusions: string[];
  /** Retailers this recipient must not be searched on. */
  excludedProviders: string[];
  /** Selected intents, best first. */
  intents: ScoredIntent[];
  /** How many selected intents answer each facet family. */
  coverage: Record<FacetFamily, number>;
}

// ── API payloads ───────────────────────────────────────────────────────

export interface GiftIdea {
  product: import('@/search/types').RankedProduct;
  /** The intent whose search surfaced this product. */
  intentId: string;
  intentQuery: string;
  interestId: InterestId | null;
  interestLabel: string;
  /** Shopper-facing reason this is a fit. */
  why: string;
  /** Facet families the intent answers, so the UI can label coverage. */
  families: FacetFamily[];
  /** Round-robin position among all ideas (1-based). */
  position: number;
}

export interface GiftIntentRun {
  intentId: string;
  intentQuery: string;
  interestId: InterestId | null;
  interestLabel: string;
  families: FacetFamily[];
  status: import('@/search/types').SearchStatus;
  resultCount: number;
  /** Providers that answered for this intent. */
  providersSearched: string[];
  error?: string;
}

export interface GiftIdeasResponse {
  status: 'results' | 'partial_results' | 'no_results' | 'error';
  recipient: { id: string; name: string };
  brief: GiftBrief;
  ideas: GiftIdea[];
  intents: GiftIntentRun[];
  providersSearched: string[];
  providersUnavailable: Array<{ providerId: string; kind: string; detail: string }>;
  timingMs: number;
  error?: string;
}
