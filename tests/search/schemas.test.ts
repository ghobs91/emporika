// ── SearchPlan validation tests ─────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { validatePlan, searchPlanSchema, shopperPreferencesSchema, WEIGHT_SUM_TOLERANCE } from '@/search/schemas';

const validPlan = {
  version: '1' as const,
  canonicalIntent: 'waterproof trail running shoes under $150',
  searches: [
    { query: 'waterproof trail running shoes', purpose: 'broad' as const },
    { query: 'trail grip wide running shoes', purpose: 'feature' as const },
  ],
  sourceStrategy: {
    searchMode: 'all_eligible' as const,
  },
  hardFilters: {
    maxPrice: 150,
    requiredFeatures: ['waterproof', 'trail', 'wide'],
    availabilityRequired: true,
  },
  ranking: [
    { criterion: 'price' as const, weight: 0.25 },
    { criterion: 'featureMatch' as const, weight: 0.30 },
    { criterion: 'availability' as const, weight: 0.15 },
    { criterion: 'shipping' as const, weight: 0.10 },
    { criterion: 'condition' as const, weight: 0.10 },
    { criterion: 'variantFit' as const, weight: 0.05 },
    { criterion: 'brandPreference' as const, weight: 0.05 },
  ],
  confidence: 0.85,
};

describe('SearchPlan validation', () => {
  it('accepts a valid plan', () => {
    const result = validatePlan(validPlan);
    expect(result).toEqual({ valid: true, plan: validPlan });
  });

  it('rejects more than 5 searches', () => {
    const plan = {
      ...validPlan,
      searches: Array.from({ length: 6 }, (_, i) => ({
        query: `search ${i}`,
        purpose: 'broad' as const,
      })),
    };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('searches') || e.includes('max'))).toBe(true);
    }
  });

  it('rejects ranking with weights that do not sum to 1.0', () => {
    const plan = {
      ...validPlan,
      ranking: [
        { criterion: 'price' as const, weight: 0.9 },
        { criterion: 'featureMatch' as const, weight: 0.9 },
      ],
    };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('sum'))).toBe(true);
    }
  });

  it('rejects negative weights', () => {
    const plan = {
      ...validPlan,
      ranking: [
        { criterion: 'price' as const, weight: -0.5 },
        { criterion: 'featureMatch' as const, weight: 1.5 },
      ],
    };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = searchPlanSchema.safeParse({
      ...validPlan,
      toolCalls: ['dangerous'],
      credentials: { key: 'secret' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid prices (negative)', () => {
    const plan = {
      ...validPlan,
      hardFilters: {
        ...validPlan.hardFilters,
        maxPrice: -50,
      },
    };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
  });

  it('accepts plans with weights summing to 1.0 within tolerance', () => {
    const plan = {
      ...validPlan,
      ranking: [
        { criterion: 'price' as const, weight: 0.333 },
        { criterion: 'featureMatch' as const, weight: 0.333 },
        { criterion: 'availability' as const, weight: 0.334 },
      ],
    };
    const result = validatePlan(plan);
    // Within tolerance
    expect(result.valid).toBe(true);
  });
});

describe('Shopper preferences validation', () => {
  it('accepts maxResults up to 120 (pagination support)', () => {
    expect(shopperPreferencesSchema.safeParse({ maxResults: 1 }).success).toBe(true);
    expect(shopperPreferencesSchema.safeParse({ maxResults: 120 }).success).toBe(true);
  });

  it('rejects maxResults above 120', () => {
    const result = shopperPreferencesSchema.safeParse({ maxResults: 121 });
    expect(result.success).toBe(false);
  });
});
