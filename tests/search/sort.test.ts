// ── Server-side result ordering tests ────────────────────────────────────
//
// The requested sort must be applied BEFORE `maxResults` is sliced, so a
// cheap-but-unpopular provider cannot crowd a popular one out of the payload
// entirely (the original Costco-vs-Walmart bug).

import { describe, it, expect } from 'vitest';
import { assembleRanked } from '@/search/orchestrator';
import type { NormalizedOffer, SearchPlan } from '@/search/types';

function offer(overrides: Partial<NormalizedOffer>): NormalizedOffer {
  return {
    offerId: `offer-${Math.random().toString(36).slice(2, 8)}`,
    providerId: 'walmart',
    providerProductId: `p-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Generic Product',
    condition: 'new',
    availability: 'in_stock',
    price: { amount: 100, currency: 'USD' },
    evidence: { fieldsProvided: ['title', 'price'], sourceSearches: ['tv stand'] },
    uncertaintyFlags: [],
    ...overrides,
  };
}

// Relevance = price only, so the cheap item outranks the popular one.
const plan: SearchPlan = {
  version: '1',
  canonicalIntent: 'tv stand',
  searches: [{ query: 'tv stand', purpose: 'broad' }],
  sourceStrategy: { searchMode: 'all_eligible' },
  hardFilters: {},
  ranking: [{ criterion: 'price', weight: 1 }],
  confidence: 1,
};

const cheap = () =>
  offer({
    providerId: 'walmart',
    providerProductId: 'w-1',
    title: 'Cheap Television Stand Alpha',
    price: { amount: 100, currency: 'USD' },
    rating: 4.1,
    reviewCount: 50,
  });

const popular = () =>
  offer({
    providerId: 'costco',
    providerProductId: 'c-1',
    title: 'Popular Entertainment Console Beta',
    price: { amount: 600, currency: 'USD' },
    rating: 4.8,
    reviewCount: 5000,
  });

describe('assembleRanked ordering', () => {
  it('relevance (no sort) keeps the price-ranked order', () => {
    const result = assembleRanked([cheap(), popular()], plan, undefined, 1);
    expect(result.ranked[0].product.title).toBe('Cheap Television Stand Alpha');
  });

  it('most-popular is applied before the cap and renumbers ranks', () => {
    const result = assembleRanked([cheap(), popular()], plan, undefined, 1, 'most-popular');
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].product.title).toBe('Popular Entertainment Console Beta');
    expect(result.ranked[0].rank).toBe(1);
  });

  it('price-asc still selects the cheapest before the cap', () => {
    const result = assembleRanked([cheap(), popular()], plan, undefined, 1, 'price-asc');
    expect(result.ranked[0].product.title).toBe('Cheap Television Stand Alpha');
  });

  it('rating-desc orders by product rating', () => {
    const result = assembleRanked([cheap(), popular()], plan, undefined, 2, 'rating-desc');
    expect(result.ranked[0].product.title).toBe('Popular Entertainment Console Beta');
    expect(result.ranked[0].rank).toBe(1);
    expect(result.ranked[1].rank).toBe(2);
  });
});
