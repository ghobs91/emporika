// ── Provider selection tests ────────────────────────────────────────────
//
// Regression tests for the retailer-filter bug: de-selecting a retailer
// (e.g. eBay) must hard-exclude it from search, not merely deprioritize it.

import { describe, it, expect } from 'vitest';
import { createFallbackPlan, resolveEligibleProviders } from '@/search/planner';
import type { ProviderId, SearchPlan } from '@/search/types';

const ALL: ProviderId[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

function makePlan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    version: '1',
    canonicalIntent: 'test',
    searches: [{ query: 'test', purpose: 'broad' }],
    sourceStrategy: { searchMode: 'all_eligible' },
    hardFilters: {},
    ranking: [{ criterion: 'price', weight: 1 }],
    confidence: 1,
    ...overrides,
  };
}

describe('resolveEligibleProviders', () => {
  it('restricts search to user-selected retailers (includedProviders)', () => {
    const plan = makePlan();
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ['walmart', 'target'] },
      ALL
    );
    expect(eligible).toEqual(['walmart', 'target']);
  });

  it('drops eBay when it is not in includedProviders even if the plan prefers it', () => {
    const plan = makePlan({
      sourceStrategy: { searchMode: 'all_eligible', preferredProviders: ALL },
    });
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ['walmart', 'bestbuy', 'target', 'costco', 'shopify'] },
      ALL
    );
    expect(eligible).not.toContain('ebay');
    expect(eligible).toHaveLength(5);
  });

  it('re-includes a retailer the user selected even if the plan did not prefer it', () => {
    const plan = makePlan({
      sourceStrategy: { searchMode: 'all_eligible', preferredProviders: ['walmart'] },
    });
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ['walmart', 'bestbuy'] },
      ALL
    );
    expect(eligible).toEqual(['walmart', 'bestbuy']);
  });

  it('still applies plan-level and preference-level exclusions', () => {
    const plan = makePlan({
      sourceStrategy: { searchMode: 'all_eligible', excludedProviders: ['costco'] },
    });
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ALL, excludedProviders: ['shopify'] },
      ALL
    );
    expect(eligible).toEqual(['walmart', 'bestbuy', 'target', 'ebay']);
  });

  it('caps preferred_only mode at 3 providers when there is no explicit selection', () => {
    const plan = makePlan({
      sourceStrategy: { searchMode: 'preferred_only', preferredProviders: ALL },
    });
    const eligible = resolveEligibleProviders(plan, undefined, ALL);
    expect(eligible).toEqual(['walmart', 'bestbuy', 'target']);
  });

  it('does not cap preferred_only mode when the user explicitly selected retailers', () => {
    const plan = makePlan({
      sourceStrategy: { searchMode: 'preferred_only', preferredProviders: ALL },
    });
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ['walmart', 'target', 'ebay', 'costco'] },
      ALL
    );
    expect(eligible).toEqual(['walmart', 'target', 'ebay', 'costco']);
  });

  it('drops providers without credentials (not in availableProviders)', () => {
    const plan = makePlan();
    const eligible = resolveEligibleProviders(
      plan,
      { includedProviders: ['walmart', 'ebay'] },
      ['walmart']
    );
    expect(eligible).toEqual(['walmart']);
  });

  it('returns all available providers when no preferences are given', () => {
    const plan = makePlan();
    expect(resolveEligibleProviders(plan, undefined, ALL)).toEqual(ALL);
  });
});

describe('createFallbackPlan', () => {
  it('sets preferredProviders to the user-selected retailers when includedProviders is given', () => {
    const plan = createFallbackPlan('running shoes', ALL, {
      includedProviders: ['target', 'ebay'],
    });
    expect(plan.sourceStrategy.preferredProviders).toEqual(['target', 'ebay']);
  });

  it('excludes de-selected providers from preferredProviders when only excludedProviders is given', () => {
    const plan = createFallbackPlan('running shoes', ALL, {
      excludedProviders: ['ebay'],
    });
    expect(plan.sourceStrategy.preferredProviders).not.toContain('ebay');
    expect(plan.sourceStrategy.preferredProviders).toHaveLength(5);
  });
});
