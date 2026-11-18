// ── Client-safe recipient schemas ───────────────────────────────────────
//
// Deliberately separate from `./schema.ts`: this file must not import
// `./index-data.ts`. The recipient form, the localStorage store and the API
// route all validate through here, so the browser bundle only pays for zod
// plus the tiny taxonomy — not ~120 search intents it cannot execute.

import { z } from 'zod';
import { AGE_BRACKETS, GENDERS, INTEREST_IDS } from './types';

/** Retailers a gift search can be told to skip. */
export const PROVIDER_IDS = [
  'walmart',
  'bestbuy',
  'target',
  'ebay',
  'costco',
  'shopify',
  'backmarket',
] as const;
export type GiftProviderId = (typeof PROVIDER_IDS)[number];

const providerIdSchema = z.enum(PROVIDER_IDS);

export const interestIdSchema = z.enum(INTEREST_IDS);

export const giftRecipientSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  gender: z.enum(GENDERS),
  /** Years. Bracket resolution clamps out-of-range values. */
  age: z.number().int().min(0).max(120),
  interests: z.array(interestIdSchema).max(12),
  budget: z.number().positive().max(100_000).optional(),
  /**
   * Retailers to leave out for this person, e.g. no eBay for someone who
   * will not shop the marketplace. Persisted with the recipient.
   */
  excludedProviders: z.array(providerIdSchema).max(PROVIDER_IDS.length).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type ValidatedGiftRecipient = z.infer<typeof giftRecipientSchema>;

/** Age brackets a recipient form will accept, for UI reuse. */
export const RECIPIENT_AGE_MAX = 120;
export const RECIPIENT_AGE_MIN = 0;
export { AGE_BRACKETS, GENDERS };
