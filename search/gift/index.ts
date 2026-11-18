// ── Gift module barrel ──────────────────────────────────────────────────

export * from './types';
export {
  AGE_BRACKETS,
  GENDERS,
  INTEREST_IDS,
  INTERESTS,
  AGE_BRACKET_LABELS,
  GENDER_LABELS,
  INTEREST_GROUP_LABELS,
  ageBracketForAge,
  getInterest,
} from './taxonomy';
export {
  buildGiftBrief,
  rankGiftCandidates,
  selectGiftIntents,
  isIntentOfferable,
  idealTierForBudget,
  scoreIntent,
  intentFamilies,
  isRedundantQuery,
  coverageOf,
} from './brief';
export { buildGiftSearchPlan, deriveGiftFeatures } from './plan';
export { executeGiftSearch, mergeGiftIdeas, GIFT_DEFAULTS } from './orchestrator';
export {
  giftRecipientSchema,
  giftIdeasRequestSchema,
  validateGiftIndex,
  currentGiftIndex,
  assertGiftIndexValid,
} from './schema';
export type { ValidatedGiftIdeasRequest, GiftIndexShape } from './schema';
export { PROVIDER_IDS } from './recipient-schema';
export type { GiftProviderId } from './recipient-schema';
export { BRANDS, getBrand } from './brands';
export { GIFT_INDEX_META } from './index-data';
