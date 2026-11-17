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
  selectGiftIntents,
  isIntentOfferable,
  idealTierForBudget,
  scoreIntent,
} from './brief';
export { buildGiftSearchPlan } from './plan';
export { executeGiftSearch, mergeGiftIdeas, GIFT_DEFAULTS } from './orchestrator';
export {
  giftRecipientSchema,
  giftIdeasRequestSchema,
  validateGiftIndex,
  assertGiftIndexValid,
} from './schema';
export type { ValidatedGiftIdeasRequest } from './schema';
