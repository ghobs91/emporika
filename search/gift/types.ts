// ── Gift recipient domain types ─────────────────────────────────────────
//
// These types describe two separate things:
//
//  1. The *recipient* a shopper creates in the app (name, gender, age,
//     interests). Persisted client-side; see `lib/gift-recipients.ts`.
//  2. The *index* that turns a recipient into gift search intents. It is a
//     checked-in data file (`./index-data.ts`), not model output, so the
//     whole feature runs with zero LLM inference.
//
// Nothing here depends on React or the DOM, so the taxonomy half of this
// module is safe to import into client components.

// ── Recipient inputs ───────────────────────────────────────────────────

export const GENDERS = ['woman', 'man', 'nonbinary', 'unspecified'] as const;
export type Gender = (typeof GENDERS)[number];

/** Inclusive age brackets. Every index entry is keyed on exactly one. */
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

// ── Gift intents (one searchable gift idea) ────────────────────────────

/**
 * How much the gift costs. Used to keep a $400 espresso machine out of a
 * toddler's stocking and to prefer small items when the budget is tight.
 */
export type GiftTier = 'stocking' | 'standard' | 'hero';

export type IntentKind = 'category' | 'brand' | 'product';

/** Typical USD price per tier — used to score tier fit, never to filter. */
export const TIER_PRICE: Record<GiftTier, number> = {
  stocking: 20,
  standard: 60,
  hero: 160,
};

export interface GiftIntent {
  /** Stable `interest/slug` id. Also the deterministic sort tiebreaker. */
  id: string;
  /** The literal retailer search query. Must return real results. */
  query: string;
  kind: IntentKind;
  tier: GiftTier;
  /**
   * 0–1 confidence that this reads as a good gift for someone with the
   * interest. Editorial, not learned.
   */
  strength: number;
  /**
   * Retail-merchandising lean. This is a *category* observation (retailers
   * merchandise these aisles differently), never a claim about people. It
   * only ever nudges the ordering by ±LEAN_NUDGE and never removes an
   * intent; the selector additionally guarantees a neutral majority.
   */
  lean: 'woman' | 'man' | 'neutral';
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

export interface InterestProfile {
  id: InterestId;
  label: string;
  group: InterestGroup;
  /** Brackets where this interest is plausible for a gift at all. */
  giftableAgeBrackets: AgeBracket[];
  intents: GiftIntent[];
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
   * shopper has not set one. Deliberately generous — it exists to stop a
   * $500 gift surfacing for a coworker's toddler, not to police spending.
   */
  budgetCeiling: number;
  /**
   * Substring exclusions applied to product titles. Kept to unambiguous
   * phrases because `search/filter.ts` does substring matching.
   */
  exclusions: string[];
  /** Always-appropriate, gender-neutral starting points for this bracket. */
  universalIntents: GiftIntent[];
}

// ── Compiled brief (index → search-ready) ──────────────────────────────

export interface ScoredIntent {
  intent: GiftIntent;
  /** Interest the intent came from, or `null` for bracket-universal intents. */
  interest: InterestId | null;
  interestLabel: string;
  /** Deterministic score; higher wins. */
  score: number;
  /** Component scores, surfaced for debugging and the "why" UI. */
  breakdown: {
    strength: number;
    tierFit: number;
    leanNudge: number;
    universalBonus: number;
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
  /** Selected intents, best first. */
  intents: ScoredIntent[];
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
  /** Round-robin position among all ideas (1-based). */
  position: number;
}

export interface GiftIntentRun {
  intentId: string;
  intentQuery: string;
  interestId: InterestId | null;
  interestLabel: string;
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
