// ── Trend pipeline: extraction, cohorts, matching and boost ─────────────

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  aggregateTrends,
  categorize,
  detectExplicitCohorts,
  extractProductPhrases,
  singular,
} from '@/scripts/trend-extract';
import {
  answerFromManifest,
  cohortChain,
  loadTrends,
  resetTrendsCache,
  termsForCohorts,
  trendAffinityForProducts,
  type TrendManifest,
} from '@/lib/gift/trends';
import { rankGiftIdeas, RANK_WEIGHTS, type IdeaInput } from '@/lib/gift/rank';
import { emptyLedger } from '@/lib/gift/ledger';
import type { RankedProduct } from '@/search/types';

// ── Extraction ─────────────────────────────────────────────────────────

describe('extractProductPhrases', () => {
  it('finds the gift concept in a real headline', () => {
    expect(extractProductPhrases('Best Cutting Boards for Slicing, Dicing, and Chopping')).toEqual([
      'cutting board',
    ]);
    expect(extractProductPhrases('The Best Cast-Iron Skillets for a Lifetime of Cooking')).toContain(
      'cast iron skillet'
    );
    expect(extractProductPhrases('This Massive Candle Is Sure to Last the Holiday Season')).toEqual([
      'candle',
    ]);
    expect(extractProductPhrases('These Cult-Favorite Bose Earbuds Are 21% Off')).toContain('earbud');
  });

  it('prefers a multi-word head over its bare noun', () => {
    const phrases = extractProductPhrases('Best Cast-Iron Skillets');
    expect(phrases).toContain('cast iron skillet');
    expect(phrases).not.toContain('iron skillet');
  });

  it('ignores news headlines with no product noun', () => {
    expect(extractProductPhrases('FAA suspends installation of router after ground stop')).toEqual([]);
    expect(extractProductPhrases('YouTube will start boosting public view counts')).toEqual([]);
  });

  it('refuses unqualified generic heads', () => {
    // "board" and "table" alone are not gift concepts.
    expect(extractProductPhrases('The Best Boards for Charcuterie')).toEqual([]);
    expect(extractProductPhrases('A Table for Every Room')).toEqual([]);
  });

  it('only accepts whitelisted modifiers', () => {
    // "Should" is not an attribute, so it is dropped — the head survives.
    expect(extractProductPhrases('This Should Watch Is Great')).toEqual(['watch']);
    expect(extractProductPhrases('Cashmere Sweater Sale')).toContain('cashmere sweater');
    expect(extractProductPhrases('Herby Sheet Pan Dinner')).not.toContain('herby sheet pan');
  });
});

describe('categorize', () => {
  it('maps exact nouns, not substrings', () => {
    expect(categorize('keyboard')).toBe('tech');
    expect(categorize('cutting board')).toBe('cooking');
    expect(categorize('cast iron skillet')).toBe('cooking');
    expect(categorize('gold necklace')).toBe('jewelry');
    expect(categorize('noise cancelling headphone')).toBe('tech');
  });

  it('returns null when nothing matches', () => {
    expect(categorize('anticipated video game')).toBeNull();
  });
});

describe('singular', () => {
  it('handles the plural forms the feeds actually use', () => {
    expect(singular('skillets')).toBe('skillet');
    expect(singular('boards')).toBe('board');
    expect(singular('dresses')).toBe('dress');
    expect(singular('accessories')).toBe('accessory');
    expect(singular('eyeglasses')).toBe('eyeglass');
    expect(singular('glass')).toBe('glass');
  });
});

// ── Cohorts ────────────────────────────────────────────────────────────

describe('detectExplicitCohorts', () => {
  it('reads a gender + decade from the headline', () => {
    expect(detectExplicitCohorts('The Best Gifts for Women in Their 30s')).toEqual(['women-30s']);
    expect(detectExplicitCohorts('Gift Guide for Men in Their 40s')).toEqual(['men-40s']);
  });

  it('keeps gender without inventing an age split', () => {
    expect(detectExplicitCohorts('Gifts for Her: 40 Ideas')).toEqual(['women']);
    expect(detectExplicitCohorts('Best Gifts for Dads')).toEqual(['men']);
  });

  it('detects teens and kids', () => {
    expect(detectExplicitCohorts('Gifts for Teenagers')).toContain('teens');
    expect(detectExplicitCohorts('Best Toys for Toddlers')).toContain('kids');
  });

  it('returns nothing when the headline names no audience', () => {
    expect(detectExplicitCohorts('The Best Cast-Iron Skillets')).toEqual([]);
  });
});

describe('aggregateTrends', () => {
  const headlines = [
    { title: 'The Best Cast-Iron Skillets for a Lifetime of Cooking', feedCohorts: ['unisex'] },
    { title: 'Best Cast-Iron Skillet Deals', feedCohorts: ['unisex'] },
    { title: 'The Best Gifts for Women in Their 30s', feedCohorts: ['women'], summary: 'gold necklace' },
    { title: 'Gifts for Women in Their 30s: Gold Necklace Picks', feedCohorts: ['women'] },
  ];

  it('buckets by explicit cohort when the headline has one', () => {
    const { cohorts, attribution } = aggregateTrends(headlines);
    expect(cohorts['women-30s']?.jewelry).toContain('gold necklace');
    expect(attribution.explicit).toBeGreaterThan(0);
  });

  it('falls back to the feed cohort and counts that as a prior', () => {
    const { cohorts, attribution } = aggregateTrends([
      { title: 'Best Cutting Boards for Slicing', feedCohorts: ['unisex'] },
    ]);
    expect(cohorts.unisex?.cooking).toContain('cutting board');
    expect(attribution).toEqual({ explicit: 0, feedPrior: 1 });
  });

  it('keeps the stronger phrasing when one term contains another', () => {
    const { cohorts } = aggregateTrends(headlines);
    const cooking = cohorts.unisex?.cooking ?? [];
    expect(cooking).toContain('cast iron skillet');
    expect(cooking).not.toContain('iron skillet');
  });
});

describe('cohortChain', () => {
  it('maps a woman in her 30s to the decade, gender and unisex buckets', () => {
    expect(cohortChain('woman', 'adult')).toEqual(['women-30s', 'women', 'unisex']);
  });

  it('tries both decades for 41–60', () => {
    expect(cohortChain('man', 'mature_adult')).toEqual([
      'men-40s',
      'men-50s',
      'men',
      'unisex',
    ]);
  });

  it('routes children and teens to their buckets', () => {
    expect(cohortChain('unspecified', 'toddler')).toEqual(['kids', 'unisex']);
    expect(cohortChain('woman', 'teen')).toEqual(['teens', 'unisex']);
    expect(cohortChain('man', 'senior')).toEqual(['men-60plus', 'men', 'unisex']);
  });

  it('never asserts a gender for nonbinary/unspecified recipients', () => {
    expect(cohortChain('nonbinary', 'adult')).toEqual(['unisex']);
    expect(cohortChain('unspecified', 'adult')).toEqual(['unisex']);
  });
});

// ── Manifest loading ───────────────────────────────────────────────────

const FIXTURE: TrendManifest = {
  version: 1,
  updatedAt: new Date().toISOString(),
  cohorts: {
    women: {
      jewelry: ['sculptural cuff', 'bezel diamond stud'],
      accessories: ['cashmere triangle scarf'],
    },
    'women-30s': { jewelry: ['two tone chain'] },
    unisex: { tech: ['noise cancelling headphones'] },
  },
};

function installFakeStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

afterEach(() => {
  resetTrendsCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadTrends', () => {
  it('fetches the static manifest and reports freshness', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => FIXTURE });
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await loadTrends();
    expect(loaded.source).toBe('network');
    expect(loaded.manifest.cohorts.women.jewelry).toContain('sculptural cuff');
    expect(loaded.ageDays).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the cached copy when offline', async () => {
    installFakeStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => FIXTURE }));
    await loadTrends();
    resetTrendsCache();

    // Offline: the cache written by the first load must carry the answer.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const loaded = await loadTrends();
    expect(loaded.source).toBe('cache');
    expect(loaded.manifest.cohorts.unisex.tech).toContain('noise cancelling headphones');
  });

  it('degrades to an empty manifest instead of throwing', async () => {
    installFakeStorage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const loaded = await loadTrends();
    expect(loaded.source).toBe('none');
    expect(loaded.manifest.cohorts).toEqual({});
    expect(loaded.ageDays).toBe(Number.POSITIVE_INFINITY);
  });
});

// ── Answers ────────────────────────────────────────────────────────────

describe('answerFromManifest', () => {
  it('answers a cohort question from the manifest only', async () => {
    const answer = await answerFromManifest(
      FIXTURE,
      'what jewelry is popular for women in their 30s right now',
      { gender: 'woman', ageBracket: 'adult' }
    );
    expect(answer.resolved).toBe('women-30s');
    expect(answer.matches.map((match) => match.term)).toContain('two tone chain');
    // The gender bucket is still in the chain, so its terms are candidates too.
    expect(answer.matches.map((match) => match.term)).toContain('sculptural cuff');
    expect(answer.semantic).toBe(false);
  });

  it('honours an explicit cohort in the question over the profile', async () => {
    const answer = await answerFromManifest(FIXTURE, 'what is trending for men', {
      gender: 'woman',
      ageBracket: 'adult',
    });
    expect(answer.cohorts[0]).toBe('men');
  });

  it('says so when the cohort has no data', async () => {
    const answer = await answerFromManifest(FIXTURE, 'what is popular', {
      gender: 'man',
      ageBracket: 'senior',
    });
    expect(answer.matches.length).toBeGreaterThan(0); // falls back to unisex
  });

  it('does not invent an answer for an off-topic question', async () => {
    const answer = await answerFromManifest(FIXTURE, 'best mortgage rates this week', {
      gender: 'woman',
      ageBracket: 'adult',
    });
    expect(answer.matches).toEqual([]);
    expect(answer.summary).toMatch(/no trend terms/i);
  });
});

describe('trendAffinityForProducts', () => {
  it('scores a product whose title is a trend term', async () => {
    const terms = termsForCohorts(FIXTURE, ['women']);
    const affinity = await trendAffinityForProducts(
      [
        { canonicalId: 'a', title: 'Sculptural Cuff Bracelet in Brushed Gold' },
        { canonicalId: 'b', title: 'Stainless Steel Mixing Bowl' },
      ],
      terms
    );
    expect(affinity.get('a')?.score).toBeGreaterThan(0.5);
    expect(affinity.get('a')?.term).toBe('sculptural cuff');
    expect(affinity.get('b')?.score ?? 0).toBeLessThan(0.2);
  });
});

// ── Ranking boost ──────────────────────────────────────────────────────

const NOW = 1_800_000_000_000;

function product(id: string, title: string, price: number): RankedProduct {
  return {
    product: { canonicalId: id, title, identity: { title, confidence: 'high', matchMethod: 'gtin' } },
    rank: 1,
    productScore: 1,
    bestOffer: { offer: { providerId: 'walmart', price: { amount: price, currency: 'USD' } } },
    alternateOffers: [],
    reasonsToChoose: [],
    tradeoffs: [],
    uncertaintyFlags: [],
  } as unknown as RankedProduct;
}

function idea(position: number, ranked: RankedProduct): IdeaInput {
  return {
    product: ranked,
    intentId: 'interest/jewelry/necklace-0',
    intentQuery: 'gold necklace',
    intentLabel: 'Jewelry',
    families: ['interest'],
    why: 'A jewelry gift.',
    position,
  };
}

describe('trend boost in the ranker', () => {
  it('lifts a trend-aligned product above an identical non-trend one', () => {
    const trend = new Map([
      ['trendy', { score: 0.9, term: 'sculptural cuff', category: 'jewelry' }],
      ['plain', { score: 0.05, term: 'sculptural cuff', category: 'jewelry' }],
    ]);

    const result = rankGiftIdeas(
      [idea(1, product('plain', 'Gold Necklace', 150)), idea(2, product('trendy', 'Sculptural Cuff', 150))],
      {
        budgetMax: 200,
        interests: ['jewelry'],
        ledger: emptyLedger(),
        recipientId: 'r1',
        now: NOW,
        trend,
      }
    );

    expect(result.ideas[0].product.product.canonicalId).toBe('trendy');
    expect(result.ideas[0].trend?.term).toBe('sculptural cuff');
  });

  it('weights trend as a minority share of the score', () => {
    expect(RANK_WEIGHTS.trend).toBeGreaterThan(0);
    expect(RANK_WEIGHTS.trend).toBeLessThan(RANK_WEIGHTS.relevance);
    const total = Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('never filters: a product with no trend match still scores', () => {
    const result = rankGiftIdeas([idea(1, product('a', 'Gold Necklace', 150))], {
      budgetMax: 200,
      interests: ['jewelry'],
      ledger: emptyLedger(),
      recipientId: 'r1',
      now: NOW,
      trend: new Map(),
    });
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0].score).toBeGreaterThan(0);
  });
});
