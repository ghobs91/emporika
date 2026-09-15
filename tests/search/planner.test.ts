// ── Deterministic fallback planner tests ──────────────────────────────────

import { describe, it, expect } from 'vitest';
import { createFallbackPlan, withCategoryIntent } from '@/search/planner';
import { validatePlan } from '@/search/schemas';
import type { ProviderId } from '@/search/types';

const ALL: ProviderId[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

describe('createFallbackPlan query understanding', () => {
  it('extracts shoe sizes into feature tokens', () => {
    const plan = createFallbackPlan('trail running shoes mens size 10', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('men size 10');
    expect(plan.searches.some((s) => s.purpose === 'feature')).toBe(true);
  });

  it('extracts clothing sizes', () => {
    const plan = createFallbackPlan('winter jacket size XL waterproof', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('size XL');
  });

  it('extracts screen sizes and adds a synonym alternative', () => {
    const plan = createFallbackPlan('55 inch 4k tv under $500', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('55 inch');
    expect(plan.hardFilters.maxPrice).toBe(500);
    const alt = plan.searches.find((s) => s.purpose === 'alternative');
    expect(alt?.query.toLowerCase()).toContain('television');
  });

  it('extracts pack quantities', () => {
    const plan = createFallbackPlan('laundry detergent pack of 2', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('pack of 2');
  });

  it('extracts device compatibility into features', () => {
    const plan = createFallbackPlan('leather case for iPhone 15', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('iphone 15');
    // The broad query drops the compatibility clause (retailers match it poorly)
    expect(plan.searches[0].query.toLowerCase()).not.toContain('for iphone');
  });

  it('detects brands into preferences and upweights brand ranking', () => {
    const plan = createFallbackPlan('sony wireless headphones', ALL);
    expect(plan.hardFilters.preferredBrands).toContain('sony');
    const brandWeight = plan.ranking.find((r) => r.criterion === 'brandPreference')?.weight;
    expect(brandWeight).toBe(0.15);
  });

  it('corrects common typos and trims confidence', () => {
    const plan = createFallbackPlan('labtop stand', ALL);
    expect(plan.searches[0].query).toBe('laptop stand');
    expect(plan.confidence).toBeLessThan(0.7);
  });

  it('caps variants at five and always validates', () => {
    const plan = createFallbackPlan('sony 55 inch waterproof bluetooth speaker pack of 2', ALL);
    expect(plan.searches.length).toBeLessThanOrEqual(5);
    expect(plan.searches.length).toBeGreaterThanOrEqual(1);
    expect(validatePlan(plan).valid).toBe(true);
  });

  it('keeps ranking weights summing to 1.0 with and without brands', () => {
    expect(validatePlan(createFallbackPlan('running shoes', ALL)).valid).toBe(true);
    expect(validatePlan(createFallbackPlan('nike running shoes', ALL)).valid).toBe(true);
  });
});

describe('createFallbackPlan category disambiguation', () => {
  it('extracts bed sizes into feature tokens', () => {
    const plan = createFallbackPlan('king bed', ALL);
    expect(plan.hardFilters.requiredFeatures).toContain('king');
  });

  it('excludes the adjacent category for "bed" without bedding terms', () => {
    const plan = createFallbackPlan('king bed', ALL);
    expect(plan.hardFilters.categoryHints).toContain('bed frame');
    expect(plan.hardFilters.exclusions).toContain('bed sheets');
    expect(validatePlan(plan).valid).toBe(true);
  });

  it('does NOT exclude bedding when the shopper asks for bedding', () => {
    const plan = createFallbackPlan('king bed sheets', ALL);
    expect(plan.hardFilters.exclusions).toBeUndefined();
    expect(plan.hardFilters.requiredFeatures).toContain('king');
  });

  it('does not fire the bed rule for mattresses', () => {
    const plan = createFallbackPlan('king mattress', ALL);
    expect(plan.hardFilters.categoryHints).toBeUndefined();
  });

  it('merges category intent into a candidate plan (existing values win)', () => {
    const base = createFallbackPlan('neutral query', ALL);
    const merged = withCategoryIntent(base, 'king bed');
    expect(merged.hardFilters.categoryHints).toContain('bed frame');
    expect(merged.hardFilters.exclusions).toContain('bed sheets');

    const existing = { ...base, hardFilters: { ...base.hardFilters, categoryHints: ['sofa'] } };
    expect(withCategoryIntent(existing, 'king bed').hardFilters.categoryHints).toEqual(['sofa']);
  });
});
