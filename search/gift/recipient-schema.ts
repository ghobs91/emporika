// ── Client-safe recipient schemas ───────────────────────────────────────
//
// Deliberately separate from `./schema.ts`: this file must not import
// `./index-data.ts`. The recipient form, the localStorage store and the API
// route all validate through here, so the browser bundle only pays for zod
// plus the tiny taxonomy — not ~120 search intents it cannot execute.

import { z } from 'zod';
import { AGE_BRACKETS, GENDERS, INTEREST_IDS } from './types';

export const interestIdSchema = z.enum(INTEREST_IDS);

export const giftRecipientSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  gender: z.enum(GENDERS),
  /** Years. Bracket resolution clamps out-of-range values. */
  age: z.number().int().min(0).max(120),
  interests: z.array(interestIdSchema).max(12),
  budget: z.number().positive().max(100_000).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type ValidatedGiftRecipient = z.infer<typeof giftRecipientSchema>;

/** Payload accepted by `POST /api/gift/ideas`. */
export const giftIdeasRequestSchema = z.object({
  recipient: giftRecipientSchema,
  destination: z
    .object({
      country: z.string().min(1),
      postalCode: z.string().optional(),
    })
    .optional(),
  /** Hard ceiling override; also accepted on the recipient as `budget`. */
  maxPrice: z.number().positive().max(100_000).optional(),
  /** How many distinct gift intents to search. */
  maxIntents: z.number().int().min(1).max(5).optional(),
  maxResults: z.number().int().min(1).max(120).optional(),
  /** Retailers the shopper pinned; omitted means every eligible retailer. */
  includedProviders: z
    .array(z.enum(['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify', 'backmarket']))
    .optional(),
});

export type ValidatedGiftIdeasRequest = z.infer<typeof giftIdeasRequestSchema>;

/** Age brackets a recipient form will accept, for UI reuse. */
export const RECIPIENT_AGE_MAX = 120;
export const RECIPIENT_AGE_MIN = 0;
export { AGE_BRACKETS, GENDERS };
