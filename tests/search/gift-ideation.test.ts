// ── Gift ideation: planning + result merging ────────────────────────────

import { describe, it, expect } from 'vitest';
import { buildGiftBrief } from '@/search/gift/brief';
import { buildGiftSearchPlan, deriveGiftFeatures } from '@/search/gift/plan';
import { mergeGiftIdeas } from '@/search/gift/orchestrator';
import { validatePlan } from '@/search/schemas';
import type { ProviderId, RankedProduct, SearchApiResponse, SearchMetadata } from '@/search/types';
import type { GiftRecipient } from '@/search/gift/types';

const PROVIDERS: ProviderId[] = ['walmart', 'ebay', 'shopify'];

function recipient(overrides: Partial<GiftRecipient> = {}): GiftRecipient {
  return {
    id: 'r1',
    name: 'Dana',
    gender: 'unspecified',
    age: 32,
    interests: ['coffee'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function metadata(overrides: Partial<SearchMetadata> = {}): SearchMetadata {
  // Fixture deliberately sets only the fields this suite reads. Asserting the
  // shape (rather than annotating the literal) keeps the test independent of
  // optional metadata additions made elsewhere in the pipeline.
  return {
    plannerSource: 'gift',
    providersSearched: ['walmart'],
    providersFailed: [],
    totalCandidates: 1,
    entityResolutionCounts: { highConfidence: 1, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 },
    filtersApplied: [],
    timingMs: { planning: 1, search: 1, entityResolution: 1, ranking: 1, total: 4 },
    ...overrides,
  } as SearchMetadata;
}

/** Minimal ranked product; the merge only reads `canonicalId`. */
function product(id: string, providerId = 'walmart'): RankedProduct {
  return {
    product: { canonicalId: id, title: id },
    rank: 1,
    productScore: 1,
    bestOffer: { offer: { providerId } },
    alternateOffers: [],
    reasonsToChoose: [],
    tradeoffs: [],
    uncertaintyFlags: [],
  } as unknown as RankedProduct;
}

function response(results: string[], overrides: Partial<SearchApiResponse> = {}): SearchApiResponse {
  return {
    status: 'results',
    query: 'q',
    results: results.map((id) => product(id)),
    metadata: metadata(),
    ...overrides,
  };
}

describe('buildGiftSearchPlan', () => {
  const brief = buildGiftBrief(recipient());

  it('produces a plan the core validator accepts', () => {
    for (const scored of brief.intents) {
      const plan = buildGiftSearchPlan(scored, brief, PROVIDERS);
      const validation = validatePlan(plan);
      expect(validation.valid, JSON.stringify(validation)).toBe(true);
    }
  });

  it('carries the brief ceiling as a hard max price', () => {
    const scored = brief.intents[0];
    const plan = buildGiftSearchPlan(scored, { ...brief, budget: { min: 0, max: 45, source: 'recipient' } }, PROVIDERS);
    expect(plan.hardFilters.maxPrice).toBe(45);
  });

  it('keeps age-bracket exclusions off the wire (applied client-side instead)', () => {
    // Sending "small parts"/"alcohol" would let a reader infer the recipient's
    // age, so the brief's exclusions never reach the plan.
    const toddler = buildGiftBrief(recipient({ age: 2, interests: ['toys_play'] }));
    const plan = buildGiftSearchPlan(toddler.intents[0], toddler, PROVIDERS);
    expect(plan.hardFilters.exclusions ?? []).not.toContain('small parts');
    expect(plan.hardFilters.exclusions ?? []).not.toContain('alcohol');
  });

  it('searches new stock only', () => {
    const plan = buildGiftSearchPlan(brief.intents[0], brief, PROVIDERS);
    expect(plan.hardFilters.allowedConditions).toEqual(['new']);
  });

  it('does not leak recipient identity into the plan', () => {
    // The plan feeds the result cache key; a name there would fragment it.
    const plan = buildGiftSearchPlan(brief.intents[0], brief, PROVIDERS);
    expect(plan.canonicalIntent).not.toContain('Dana');
    expect(plan.canonicalIntent.startsWith('gift:')).toBe(true);
  });

  it('keeps every generated query from the index', () => {
    const plan = buildGiftSearchPlan(brief.intents[0], brief, PROVIDERS);
    expect(plan.searches[0].query).toBe(brief.intents[0].intent.query);
  });

  it('passes shopper preferences through instead of overriding them', () => {
    const plan = buildGiftSearchPlan(brief.intents[0], brief, PROVIDERS, {
      includedProviders: ['ebay'],
    });
    expect(plan.sourceStrategy.preferredProviders).toEqual(['ebay']);
  });

  it('gives the ranker the intent vocabulary as relevance terms', () => {
    // Without this, `featureMatch` returns a free 1.0 for every listing and
    // one shared keyword ("herb grinder") ranks as high as the real thing.
    const plan = buildGiftSearchPlan(brief.intents[0], brief, PROVIDERS);
    expect(plan.hardFilters.requiredFeatures).toContain(
      brief.intents[0].intent.query.toLowerCase()
    );
  });
});

describe('deriveGiftFeatures', () => {
  it('keeps the phrase plus its first and last content word', () => {
    expect(deriveGiftFeatures('coffee grinder')).toEqual(['coffee grinder', 'coffee', 'grinder']);
  });

  it('drops generic gift words so they cannot score every title', () => {
    expect(deriveGiftFeatures('gift set for kids')).toEqual(['gift set for kids']);
  });

  it('never returns an empty term for a one-word query', () => {
    expect(deriveGiftFeatures('headphones')).toEqual(['headphones']);
  });
});

describe('mergeGiftIdeas', () => {
  const brief = buildGiftBrief(recipient({ interests: ['coffee', 'gaming', 'reading'] }), {
    maxIntents: 3,
  });

  function requestFor(index: number) {
    const scored = brief.intents[index];
    return {
      intentId: scored.intent.id,
      query: scored.intent.query,
      label: scored.interestLabel,
      families: scored.families,
      why: scored.intent.why,
    };
  }

  function run(responseFor: (index: number) => SearchApiResponse) {
    return brief.intents.map((_, index) => ({ request: requestFor(index), response: responseFor(index) }));
  }

  it('interleaves one result from each intent instead of concatenating', () => {
    const runs = run((index) => response([`${index}-a`, `${index}-b`]));
    const ideas = mergeGiftIdeas(runs, 10);
    expect(ideas.map((i) => i.product.product.canonicalId)).toEqual([
      '0-a', '1-a', '2-a', '0-b', '1-b', '2-b',
    ]);
  });

  it('tags each idea with the intent that found it', () => {
    const runs = run((index) => response([`${index}-a`]));
    const ideas = mergeGiftIdeas(runs, 10);
    for (const [index, idea] of ideas.entries()) {
      expect(idea.intentId).toBe(brief.intents[index].intent.id);
      expect(idea.intentQuery).toBe(brief.intents[index].intent.query);
      expect(idea.why).toBe(brief.intents[index].intent.why);
      expect(idea.intentLabel).toBe(brief.intents[index].interestLabel);
      expect(idea.families).toEqual(brief.intents[index].families);
    }
  });

  it('interleaves across retailers, not just across intents', () => {
    // One intent, whose ranked list is provider-sorted the way a marketplace
    // would return it. The merge must not emit four eBay items in a row.
    const runs = [
      {
        request: requestFor(0),
        response: response([], {
          results: [
            product('a', 'ebay'),
            product('b', 'ebay'),
            product('c', 'ebay'),
            product('d', 'walmart'),
            product('e', 'walmart'),
            product('f', 'shopify'),
          ].filter(Boolean) as RankedProduct[],
        }),
      },
    ];
    const ideas = mergeGiftIdeas(runs, 10);
    const providers = ideas.map((idea) => idea.product.bestOffer?.offer.providerId);
    expect(providers.slice(0, 3).sort()).toEqual(['ebay', 'shopify', 'walmart']);
  });

  it('de-duplicates a product found by several intents, keeping the earlier intent', () => {
    const runs = run((index) => response(['shared', `${index}-only`]));
    const ideas = mergeGiftIdeas(runs, 10);
    expect(ideas.filter((i) => i.product.product.canonicalId === 'shared')).toHaveLength(1);
    expect(ideas[0].product.product.canonicalId).toBe('shared');
    expect(ideas[0].intentId).toBe(brief.intents[0].intent.id);
  });

  it('respects the overall cap', () => {
    const runs = run((index) => response([`${index}-a`, `${index}-b`, `${index}-c`]));
    expect(mergeGiftIdeas(runs, 4)).toHaveLength(4);
  });

  it('numbers ideas by display position', () => {
    const runs = run((index) => response([`${index}-a`, `${index}-b`]));
    const ideas = mergeGiftIdeas(runs, 10);
    ideas.forEach((idea, index) => expect(idea.position).toBe(index + 1));
  });

  it('skips intents that returned nothing', () => {
    const runs = [
      { request: requestFor(0), response: response([]) },
      { request: requestFor(1), response: response(['only']) },
    ];
    const ideas = mergeGiftIdeas(runs, 10);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].intentId).toBe(brief.intents[1].intent.id);
  });

  it('returns nothing when every intent returned nothing', () => {
    const runs = run(() => response([]));
    expect(mergeGiftIdeas(runs, 10)).toEqual([]);
  });
});
