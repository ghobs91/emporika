// ── Zod schemas for request / response validation ───────────────────────

import { z } from 'zod';
import type { ProviderId } from './types';

// ── Helpers ────────────────────────────────────────────────────────────

const PROVIDER_IDS = [
  'walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify',
] as const;

const providerIdSchema = z.enum(PROVIDER_IDS);

const moneySchema = z.object({
  amount: z.number().finite(),
  currency: z.string().min(1),
});

const rankingCriteriaSchema = z.enum([
  'price', 'featureMatch', 'availability', 'shipping', 'pickup',
  'seller', 'retailer', 'brandPreference', 'variantFit', 'condition',
  'preferenceFit',
]);

const conditionSchema = z.enum(['new', 'used', 'refurbished', 'open_box']);

// ── Search plan schema ─────────────────────────────────────────────────

export const searchPlanSchema = z.object({
  version: z.literal('1'),

  canonicalIntent: z.string().min(1).max(500),

  searches: z
    .array(
      z.object({
        query: z.string().min(1).max(300),
        purpose: z.enum(['broad', 'feature', 'alternative', 'brand']),
      })
    )
    .min(1)
    .max(5),

  sourceStrategy: z.object({
    preferredProviders: z.array(providerIdSchema).max(6).optional(),
    excludedProviders: z.array(providerIdSchema).max(6).optional(),
    searchMode: z.enum(['all_eligible', 'preferred_only']),
  }),

  hardFilters: z.object({
    maxPrice: z.number().positive().optional(),
    minPrice: z.number().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    shipsTo: z
      .object({
        country: z.string().min(1),
        postalCode: z.string().optional(),
      })
      .optional(),
    categoryHints: z.array(z.string()).max(10).optional(),
    requiredFeatures: z.array(z.string()).max(20).optional(),
    exclusions: z.array(z.string()).max(20).optional(),
    excludedBrands: z.array(z.string()).max(20).optional(),
    preferredBrands: z.array(z.string()).max(20).optional(),
    availabilityRequired: z.boolean().optional(),
    allowedConditions: z.array(conditionSchema).max(4).optional(),
  }),

  ranking: z
    .array(
      z.object({
        criterion: rankingCriteriaSchema,
        weight: z.number().finite().nonnegative(),
      })
    )
    .min(1)
    .max(8),

  clarification: z
    .object({
      required: z.boolean(),
      field: z.enum([
        'budget', 'destination', 'category', 'useCase',
        'size', 'compatibility', 'condition', 'other',
      ]),
      question: z.string().min(1).max(300),
      reason: z.string().min(1).max(500),
    })
    .optional(),

  confidence: z.number().min(0).max(1),
}).strict(); // reject unknown fields — important for model output safety

export type ValidatedSearchPlan = z.infer<typeof searchPlanSchema>;

// ── Shopper preferences schema ─────────────────────────────────────────

export const shopperPreferencesSchema = z.object({
  budget: z
    .object({
      max: z.number().positive().optional(),
      min: z.number().nonnegative().optional(),
      currency: z.string().min(1).optional(),
    })
    .optional(),
  priorities: z.array(z.string()).optional(),
  excludedBrands: z.array(z.string()).optional(),
  preferredBrands: z.array(z.string()).optional(),
  includedProviders: z.array(providerIdSchema).optional(),
  excludedProviders: z.array(providerIdSchema).optional(),
  allowedConditions: z.array(conditionSchema).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  strictness: z.enum(['strict', 'balanced']).optional(),
});

// ── Search API request schema ──────────────────────────────────────────

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  destination: z
    .object({
      country: z.string().min(1),
      postalCode: z.string().optional(),
    })
    .optional(),
  preferences: shopperPreferencesSchema.optional(),
  candidatePlan: searchPlanSchema.optional(),
});

export type ValidatedSearchRequest = z.infer<typeof searchRequestSchema>;

// ── Validation helpers ─────────────────────────────────────────────────

/** Tolerance for weight sum checking (floating point). */
export const WEIGHT_SUM_TOLERANCE = 0.001;

/**
 * Validate a SearchPlan beyond what Zod can express declaratively.
 * Returns an array of human-readable validation issues (empty = valid).
 */
export function validateSearchPlanSemantics(plan: ValidatedSearchPlan): string[] {
  const issues: string[] = [];

  // Weight sum must be ~1.0
  const totalWeight = plan.ranking.reduce((sum, r) => sum + r.weight, 0);
  if (Math.abs(totalWeight - 1.0) > WEIGHT_SUM_TOLERANCE) {
    issues.push(
      `Ranking weights must sum to 1.0 (got ${totalWeight.toFixed(4)}, tolerance ±${WEIGHT_SUM_TOLERANCE})`
    );
  }

  // Max/min price consistency
  if (
    plan.hardFilters.minPrice !== undefined &&
    plan.hardFilters.maxPrice !== undefined &&
    plan.hardFilters.minPrice > plan.hardFilters.maxPrice
  ) {
    issues.push(
      `minPrice (${plan.hardFilters.minPrice}) must not exceed maxPrice (${plan.hardFilters.maxPrice})`
    );
  }

  return issues;
}

/**
 * Full validation: Zod parse + semantic checks.
 * Returns either the validated plan or a list of errors.
 */
export function validatePlan(
  candidate: unknown
): { valid: true; plan: ValidatedSearchPlan } | { valid: false; errors: string[] } {
  const zodResult = searchPlanSchema.safeParse(candidate);
  if (!zodResult.success) {
    return {
      valid: false,
      errors: zodResult.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      ),
    };
  }

  const semanticIssues = validateSearchPlanSemantics(zodResult.data);
  if (semanticIssues.length > 0) {
    return { valid: false, errors: semanticIssues };
  }

  return { valid: true, plan: zodResult.data };
}
