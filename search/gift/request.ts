// ── Gift search requests: the client/server boundary ────────────────────
//
// The recipient profile never crosses this boundary. The browser compiles the
// profile into a handful of *query intents* (`briefToIntentRequests`) and sends
// only those; the server searches them and returns products. Someone reading
// the network tab learns "this browser searched for an espresso machine", not
// who the gift is for, how old they are, or what else they like.
//
// This module is shared by both sides:
//   • client — `briefToIntentRequests(brief)`
//   • server — `planFromIntentRequest(request, ...)`
//
// It must stay free of server-only imports so the client can use the Zod
// schema directly.

import { z } from 'zod';
import type { GiftBrief } from './types';

export const GIFT_REQUEST_LIMITS = {
  maxIntents: 10,
  maxRetainedResults: 60,
} as const;

const intentFamiliesSchema = z.enum(['age', 'gender', 'combo', 'interest', 'brand']);

/**
 * One search the browser wants run. Everything here is derived from the gift
 * index by the client, except `families`/`label`, which exist purely so the
 * response can be labelled in the UI.
 */
export const giftIntentRequestSchema = z.object({
  /** Stable id from the index, e.g. `interest/coffee/espresso-machine-0`. */
  intentId: z.string().min(1).max(120),
  /** The literal retailer query. */
  query: z.string().min(2).max(80),
  /** Human-facing provenance ("Coffee", "Nike", "Adult (26–40)"). */
  label: z.string().min(1).max(60),
  /** Which recipient traits this search answers — used for UI grouping. */
  families: z.array(intentFamiliesSchema).max(5),
  /** Shopper-facing reason, rendered under the card. */
  why: z.string().min(1).max(240),
  /** Hard ceiling for this search, in whole currency units. */
  maxPrice: z.number().positive().max(100_000).optional(),
  // NOTE: age-bracket title exclusions are deliberately NOT part of this
  // contract. They are derived from the recipient's age and would leak it, so
  // the browser applies them locally after the products arrive.
  /** Brand names worth boosting. */
  brands: z.array(z.string().min(1).max(60)).max(20).optional(),
  /** Provider category hints. */
  categories: z.array(z.string().min(1).max(60)).max(10).optional(),
  /** Result ordering the client asked for; defaults to relevance. */
  sort: z.enum(['relevance', 'most-popular', 'price-asc', 'price-desc', 'rating-desc']).optional(),
});

export type GiftIntentRequest = z.infer<typeof giftIntentRequestSchema>;

/**
 * Gift search request. Deliberately contains no recipient fields — no name,
 * no gender, no age, no interest list.
 */
export const giftSearchRequestSchema = z.object({
  /** Searches to run, at most `GIFT_REQUEST_LIMITS.maxIntents`. */
  intents: z.array(giftIntentRequestSchema).min(1).max(GIFT_REQUEST_LIMITS.maxIntents),
  destination: z
    .object({
      country: z.string().min(1),
      postalCode: z.string().optional(),
    })
    .optional(),
  /** Retailers to skip. Sent per request so the server holds no preferences. */
  excludedProviders: z
    .array(z.enum(['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify', 'backmarket']))
    .optional(),
  /** Results per intent before the client ranks them locally. */
  resultsPerIntent: z.number().int().min(5).max(60).optional(),
  /** Overall cap on returned products. */
  maxResults: z.number().int().min(1).max(120).optional(),
});

export type GiftSearchRequest = z.infer<typeof giftSearchRequestSchema>;

/** The response contract: products and per-search status. No profile echo. */
export interface GiftSearchResponse {
  status: 'results' | 'partial_results' | 'no_results' | 'error';
  ideas: Array<{
    product: import('@/search/types').RankedProduct;
    intentId: string;
    intentQuery: string;
    intentLabel: string;
    families: string[];
    why: string;
    position: number;
  }>;
  intents: Array<{
    intentId: string;
    query: string;
    label: string;
    families: string[];
    status: import('@/search/types').SearchStatus;
    resultCount: number;
    providersSearched: string[];
    error?: string;
  }>;
  providersSearched: string[];
  providersUnavailable: Array<{ providerId: string; kind: string; detail: string }>;
  momentumSampledAt: string;
  timingMs: number;
  error?: string;
}

/**
 * Compile a locally-built brief into the searches the server should run.
 *
 * This is the privacy boundary: the recipient profile stops here. What leaves
 * the device is a query, a label, the budget ceiling, the age-bracket title
 * exclusions, and brand/category hints — never the name, age, gender or the
 * interest list itself.
 */
export function briefToIntentRequests(brief: GiftBrief): GiftIntentRequest[] {
  return brief.intents.map((entry) => ({
    intentId: entry.intent.id,
    query: entry.intent.query,
    label: entry.interestLabel,
    families: entry.families,
    why: entry.intent.why,
    maxPrice: brief.budget.max,
    brands: entry.intent.brands,
    categories: entry.intent.categories,
  }));
}
