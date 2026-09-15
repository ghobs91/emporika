// ── Hard-filter tests ────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { applyHardFilters } from '@/search/filter';
import { createFallbackPlan } from '@/search/planner';
import type { CanonicalProduct, ProviderId } from '@/search/types';

const ALL: ProviderId[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

function makeProduct(title: string): CanonicalProduct {
  return {
    canonicalId: 'cp-1',
    identity: {
      title,
      confidence: 'high',
      matchMethod: 'normalized_title',
    },
    title,
    offers: [
      {
        offerId: 'offer-1',
        providerId: 'shopify',
        providerProductId: 'p1',
        title,
        condition: 'new',
        availability: 'unknown',
        price: { amount: 199, currency: 'USD' },
        evidence: { fieldsProvided: ['title', 'price'], sourceSearches: ['king bed'] },
        uncertaintyFlags: [],
      },
    ],
    sourceProviders: ['shopify'],
    sourceSearches: ['king bed'],
    matchedFeatures: [],
    missingData: [],
    warnings: [],
  };
}

describe('applyHardFilters category exclusions', () => {
  it('drops adjacent-category products for a bed query', () => {
    const plan = createFallbackPlan('king bed', ALL);
    expect(applyHardFilters(makeProduct('100% Bamboo Bed Sheets'), plan).passed).toBe(false);
    expect(applyHardFilters(makeProduct('Organic Cotton Sheets, King'), plan).passed).toBe(false);
  });

  it('keeps the intended category', () => {
    const plan = createFallbackPlan('king bed', ALL);
    expect(applyHardFilters(makeProduct('King Bed Frame with Headboard'), plan).passed).toBe(true);
  });

  it('does not exclude bedding when explicitly requested', () => {
    const plan = createFallbackPlan('king bed sheets', ALL);
    expect(applyHardFilters(makeProduct('100% Bamboo Bed Sheets'), plan).passed).toBe(true);
  });
});
