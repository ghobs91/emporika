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
export { executeGiftIntents, mergeGiftIdeas, GIFT_DEFAULTS } from './orchestrator';
export {
  giftRecipientSchema,
  validateGiftIndex,
  currentGiftIndex,
  assertGiftIndexValid,
} from './schema';
export type { ValidatedGiftRecipient, GiftIndexShape } from './schema';
export {
  giftIntentRequestSchema,
  giftSearchRequestSchema,
  GIFT_REQUEST_LIMITS,
} from './request';
export type { GiftIntentRequest, GiftSearchRequest, GiftSearchResponse } from './request';
export { PROVIDER_IDS } from './recipient-schema';
export type { GiftProviderId } from './recipient-schema';
export { BRANDS, getBrand, brandProductQuery } from './brands';
export {
  MOMENTUM_WEIGHT,
  momentumFor,
  hasMomentum,
  momentumSampledAt,
  momentumSampleSize,
  momentumAgeDays,
} from './momentum';
export { GIFT_INDEX_META } from './index-data';
