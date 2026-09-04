// ── Search result cache tests ─────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  buildSearchCacheKey,
  stableStringify,
  ResultCache,
  defaultSearchCache,
} from '@/search/cache';
import type { SearchApiResponse, SearchRequest } from '@/search/types';

function makeRequest(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: 'trail running shoes', ...overrides };
}

function makeResponse(status: SearchApiResponse['status'] = 'results'): SearchApiResponse {
  return {
    status,
    query: 'trail running shoes',
    metadata: {
      plannerSource: 'fallback',
      providersSearched: [],
      providersFailed: [],
      totalCandidates: 0,
      entityResolutionCounts: { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 },
      filtersApplied: [],
      timingMs: { planning: 0, search: 0, entityResolution: 0, ranking: 0, total: 0 },
    },
  };
}

describe('buildSearchCacheKey', () => {
  it('normalizes query casing and whitespace', () => {
    expect(buildSearchCacheKey(makeRequest({ query: '  Trail   SHOES ' }))).toBe(
      buildSearchCacheKey(makeRequest({ query: 'trail shoes' }))
    );
  });

  it('is insensitive to preferences key order', () => {
    const a = buildSearchCacheKey(
      makeRequest({ preferences: { budget: { max: 150 }, excludedBrands: ['x'] } as SearchRequest['preferences'] })
    );
    const b = buildSearchCacheKey(
      makeRequest({ preferences: { excludedBrands: ['x'], budget: { max: 150 } } as SearchRequest['preferences'] })
    );
    expect(a).toBe(b);
  });

  it('separates different queries, destinations, and plans', () => {
    const base = buildSearchCacheKey(makeRequest());
    expect(buildSearchCacheKey(makeRequest({ query: 'boots' }))).not.toBe(base);
    expect(
      buildSearchCacheKey(makeRequest({ destination: { country: 'US', postalCode: '90210' } }))
    ).not.toBe(base);
    expect(
      buildSearchCacheKey(
        makeRequest({ candidatePlan: { version: '1', canonicalIntent: 'x' } as unknown as SearchRequest['candidatePlan'] })
      )
    ).not.toBe(base);
  });

  it('stableStringify sorts object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe('ResultCache', () => {
  it('stores and retrieves cacheable responses', () => {
    const cache = new ResultCache(60_000, 10);
    const response = makeResponse('results');
    cache.set('k', response);
    expect(cache.get('k')).toBe(response);
  });

  it('stores no_results but never errors, partials, or clarifications', () => {
    const cache = new ResultCache(60_000, 10);
    cache.set('ok', makeResponse('no_results'));
    cache.set('err', makeResponse('error'));
    cache.set('part', makeResponse('partial_results'));
    expect(cache.get('ok')).not.toBeNull();
    expect(cache.get('err')).toBeNull();
    expect(cache.get('part')).toBeNull();
  });

  it('expires entries after TTL', async () => {
    const cache = new ResultCache(20, 10);
    cache.set('k', makeResponse());
    expect(cache.get('k')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(cache.get('k')).toBeNull();
  });

  it('evicts oldest entries beyond capacity', () => {
    const cache = new ResultCache(60_000, 2);
    cache.set('a', makeResponse());
    cache.set('b', makeResponse());
    cache.set('c', makeResponse());
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('c')).not.toBeNull();
  });

  it('exposes a process-wide default cache', () => {
    expect(defaultSearchCache).toBeInstanceOf(ResultCache);
  });
});
