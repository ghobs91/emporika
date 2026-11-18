// ── Client-side gift intelligence ───────────────────────────────────────
//
// Covers the five local layers: semantic-free ranking pieces (product type,
// budget sweet spot, dedupe, ledger affinity) and the composed ranker.

import { describe, it, expect } from 'vitest';
import {
  classifyProductType,
  isDiyOrRepairProfile,
  isHiddenByDefault,
} from '@/lib/gift/product-type';
import { budgetFit, SWEET_SPOT } from '@/lib/gift/budget';
import { dedupeListings, titleSimilarity } from '@/lib/gift/dedupe';
import {
  affinity,
  clearLedger,
  emptyLedger,
  getLedgerSnapshot,
  isSuppressed,
  recordSignal,
  sanitizeLedger,
  saveLedger,
  signalsForIdea,
} from '@/lib/gift/ledger';
import { buildBundles, rankGiftIdeas, relevanceFromPosition, type IdeaInput } from '@/lib/gift/rank';
import type { RankedProduct } from '@/search/types';
import type { Ledger } from '@/lib/gift/ledger';

const NOW = 1_800_000_000_000;

function product(
  id: string,
  title: string,
  price: number | undefined,
  options: { providerId?: string; upc?: string; brand?: string } = {}
): RankedProduct {
  return {
    product: {
      canonicalId: id,
      title,
      brand: options.brand,
      identity: { title, confidence: 'high', matchMethod: 'gtin', upc: options.upc },
    },
    rank: 1,
    productScore: 1,
    bestOffer:
      price !== undefined
        ? { offer: { providerId: options.providerId ?? 'walmart', price: { amount: price, currency: 'USD' } } }
        : undefined,
    alternateOffers: [],
    reasonsToChoose: [],
    tradeoffs: [],
    uncertaintyFlags: [],
  } as unknown as RankedProduct;
}

function idea(
  position: number,
  ranked: RankedProduct,
  overrides: Partial<IdeaInput> = {}
): IdeaInput {
  return {
    product: ranked,
    intentId: 'interest/coffee/espresso-machine-0',
    intentQuery: 'espresso machine',
    intentLabel: 'Coffee',
    families: ['interest'],
    why: 'A coffee gift.',
    position,
    ...overrides,
  };
}

function options(overrides: Partial<Parameters<typeof rankGiftIdeas>[1]> = {}) {
  return {
    budgetMax: 200,
    interests: ['coffee'],
    ledger: emptyLedger(),
    recipientId: 'r1',
    now: NOW,
    ...overrides,
  };
}

describe('classifyProductType', () => {
  it('flags replacement parts that mention fitment or repair language', () => {
    for (const title of [
      'Replacement Gasket for Espresso Machine',
      'Fits Breville Barista Express Portafilter O-Ring',
      'Vacuum Filter replacement kit',
      'Drive Belt compatible with KitchenAid',
    ]) {
      expect(classifyProductType(title).type, title).toBe('replacement_part');
    }
  });

  it('flags consumables that get re-bought', () => {
    for (const title of [
      'Nespresso Coffee Pods 50 count',
      'Loose Leaf Tea Sampler',
      'Prismacolor Premier Colored Pencils',
    ]) {
      const type = classifyProductType(title).type;
      expect(['consumable', 'main'], title).toContain(type);
    }
    expect(classifyProductType('Coffee Pods Variety Pack').type).toBe('consumable');
  });

  it('flags accessories', () => {
    for (const title of ['Silicone Case for AirPods', 'Camera strap', 'Laptop stand']) {
      expect(classifyProductType(title).type, title).toBe('accessory');
    }
  });

  it('leaves the actual gift alone', () => {
    expect(classifyProductType('Breville Barista Express Espresso Machine').type).toBe('main');
    expect(classifyProductType('Cast Iron Skillet 12 inch').type).toBe('main');
  });

  it('honours an index hint only when the title says nothing', () => {
    expect(classifyProductType('House Blend', 'consumable').type).toBe('consumable');
    // ...but never overrides explicit title evidence.
    expect(classifyProductType('Replacement gasket', 'main').type).toBe('replacement_part');
  });

  it('relaxes the default rule for DIY/repair profiles', () => {
    expect(isDiyOrRepairProfile(['tools_diy'])).toBe(true);
    expect(isDiyOrRepairProfile(['baking'])).toBe(false);
    expect(isHiddenByDefault('replacement_part', true)).toBe(false);
    expect(isHiddenByDefault('replacement_part', false)).toBe(true);
  });
});

describe('budgetFit', () => {
  it('peaks inside the 60–90% sweet spot', () => {
    const fit = budgetFit(150, 200);
    expect(fit.score).toBe(1);
    expect(fit.band).toBe('sweet');
    expect(SWEET_SPOT).toEqual({ min: 0.6, max: 0.9 });
  });

  it('punishes token prices hardest', () => {
    const token = budgetFit(12, 200); // 6%
    const modest = budgetFit(60, 200); // 30%
    expect(token.score).toBeLessThan(modest.score);
    expect(token.band).toBe('below');
  });

  it('decays at the very top of the ceiling', () => {
    const top = budgetFit(199, 200);
    expect(top.band).toBe('above');
    expect(top.score).toBeGreaterThan(0);
    expect(top.score).toBeLessThan(1);
  });

  it('is neutral-negative when the price is unknown', () => {
    expect(budgetFit(undefined, 200).score).toBe(0.45);
    expect(budgetFit(50, undefined).band).toBe('unknown');
  });
});

describe('dedupe', () => {
  it('removes near-identical titles from different intents', () => {
    const result = dedupeListings([
      { key: 'a', product: product('a', 'Milwaukee 2606-20 Cordless Drill Driver', 129) },
      { key: 'b', product: product('b', 'Milwaukee 2606-20 Cordless Drill Driver - New', 125) },
      { key: 'c', product: product('c', 'Lodge Cast Iron Skillet 12 inch', 30) },
    ]);
    expect(result.kept.map((entry) => entry.key)).toEqual(['a', 'c']);
    expect(result.removed).toHaveLength(1);
  });

  it('prefers structured identity over title text', () => {
    const result = dedupeListings([
      { key: 'a', product: product('a', 'Some Espresso Machine', 500, { upc: '012345678905' }) },
      { key: 'b', product: product('b', 'Totally Different Name', 480, { upc: '012345678905' }) },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].key).toBe('a');
  });

  it('keeps genuinely different products that share a category word', () => {
    const result = dedupeListings([
      { key: 'a', product: product('a', 'Lodge Cast Iron Skillet', 30) },
      { key: 'b', product: product('b', 'Le Creuset Dutch Oven', 300) },
    ]);
    expect(result.kept).toHaveLength(2);
  });

  it('scores containment high but not identical for short titles', () => {
    expect(titleSimilarity('Espresso Machine', 'Espresso Machine')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Drill', 'Drill')).toBeGreaterThan(0.5);
    expect(titleSimilarity('Drill', 'Coffee Grinder')).toBe(0);
  });
});

describe('ledger', () => {
  it('aggregates repeated signals into one row', () => {
    let ledger = emptyLedger();
    ledger = recordSignal(ledger, { recipientId: 'r1', dimension: 'interest', key: 'jewelry', action: 'dismissed', at: NOW });
    ledger = recordSignal(ledger, { recipientId: 'r1', dimension: 'interest', key: 'jewelry', action: 'dismissed', at: NOW });

    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].counts.dismissed).toBe(2);
    expect(affinity(ledger, { recipientId: 'r1', dimension: 'interest', key: 'jewelry' }, NOW)).toBeLessThan(0);
  });

  it('separates recipients', () => {
    const ledger = recordSignal(emptyLedger(), {
      recipientId: 'r1',
      dimension: 'interest',
      key: 'coffee',
      action: 'saved',
      at: NOW,
    });
    expect(affinity(ledger, { recipientId: 'r1', dimension: 'interest', key: 'coffee' }, NOW)).toBeGreaterThan(0);
    expect(affinity(ledger, { recipientId: 'r2', dimension: 'interest', key: 'coffee' }, NOW)).toBe(0);
  });

  it('decays: an old dismissal stops suppressing', () => {
    const old = NOW - 365 * 86_400_000;
    const ledger = recordSignal(emptyLedger(), {
      recipientId: 'r1',
      dimension: 'interest',
      key: 'jewelry',
      action: 'dismissed',
      at: old,
    });
    const score = affinity(ledger, { recipientId: 'r1', dimension: 'interest', key: 'jewelry' }, NOW);
    expect(isSuppressed(score)).toBe(false);
  });

  it('suppresses after repeated dismissals and never exceeds 1', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger = recordSignal(ledger, {
        recipientId: 'r1',
        dimension: 'productType',
        key: 'accessory',
        action: 'dismissed',
        at: NOW,
      });
    }
    const score = affinity(ledger, { recipientId: 'r1', dimension: 'productType', key: 'accessory' }, NOW);
    expect(isSuppressed(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(-1);
  });

  it('drops malformed rows on read instead of throwing', () => {
    expect(sanitizeLedger({ rows: [{ nope: true }, { recipientId: 'r', dimension: 'interest', key: 'x', action: 'saved', count: 1, lastAt: 1 }] }).rows).toHaveLength(1);
    expect(sanitizeLedger('garbage').rows).toEqual([]);
  });

  it('caps rows per recipient', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < 80; i += 1) {
      ledger = recordSignal(ledger, {
        recipientId: 'r1',
        dimension: 'intent',
        key: `intent-${i}`,
        action: 'clicked',
        at: NOW + i,
      });
    }
    expect(ledger.rows.length).toBeLessThanOrEqual(60);
  });

  it('clears one recipient at a time', () => {
    // `clearLedger` is a storage-boundary function, so it operates on whatever
    // the store holds rather than on a ledger passed in.
    saveLedger(recordSignal(emptyLedger(), { recipientId: 'r1', dimension: 'brand', key: 'a', action: 'saved', at: NOW }));
    saveLedger(recordSignal(getLedgerSnapshot(), { recipientId: 'r2', dimension: 'brand', key: 'b', action: 'saved', at: NOW }));

    const next = clearLedger('r1') as Ledger;
    expect(next.rows.every((row) => row.recipientId !== 'r1')).toBe(true);
    expect(next.rows).toHaveLength(1);
    saveLedger(emptyLedger());
  });

  it('derives signals from an idea', () => {
    const signals = signalsForIdea({
      recipientId: 'r1',
      interests: ['coffee'],
      productType: 'accessory',
      brands: ['breville'],
      intentId: 'interest/coffee/x',
      retailer: 'walmart',
    });
    expect(signals.map((signal) => signal.dimension)).toContain('productType');
    expect(signals.map((signal) => signal.key)).toContain('coffee');
  });
});

describe('rankGiftIdeas', () => {
  it('drops duplicate listings and reports how many', () => {
    const result = rankGiftIdeas(
      [
        idea(1, product('a', 'Milwaukee 2606-20 Cordless Drill Driver', 129)),
        idea(2, product('b', 'Milwaukee 2606-20 Cordless Drill Driver - New', 125)),
        idea(3, product('c', 'Lodge Cast Iron Skillet 12 inch', 30)),
      ],
      options()
    );
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.ideas.map((entry) => entry.product.product.canonicalId)).not.toContain('b');
  });

  it('prefers 60–90% of budget over a much cheaper item', () => {
    const result = rankGiftIdeas(
      [
        idea(1, product('cheap', 'Cheap Espresso Machine', 20)),
        idea(2, product('right', 'Proper Espresso Machine', 150)),
      ],
      options({ budgetMax: 200 })
    );
    expect(result.ideas[0].product.product.canonicalId).toBe('right');
  });

  it('hides replacement parts unless the profile is DIY', () => {
    const parts = [
      idea(1, product('gasket', 'Replacement Gasket for Espresso Machine', 8)),
      idea(2, product('machine', 'Gaggia Classic Espresso Machine', 150)),
    ];
    const hidden = rankGiftIdeas(parts, options());
    expect(hidden.ideas.map((i) => i.product.product.canonicalId)).toEqual(['machine']);
    expect(hidden.hidden.replacementParts).toBe(1);

    const allowed = rankGiftIdeas(parts, options({ allowReplacementParts: true }));
    expect(allowed.ideas).toHaveLength(2);
  });

  it('applies age-bracket exclusions locally', () => {
    const result = rankGiftIdeas(
      [
        idea(1, product('kid', 'Noise Cancelling Headphones for Kids', 150)),
        idea(2, product('adult', 'Noise Cancelling Headphones', 150)),
      ],
      options({ budgetMax: 200, exclusions: ['for kids'] })
    );
    expect(result.hidden.ageExcluded).toBe(1);
    expect(result.ideas.map((i) => i.product.product.canonicalId)).toEqual(['adult']);
  });

  it('never hides an accessory, only demotes it', () => {
    const result = rankGiftIdeas(
      [
        idea(1, product('case', 'Leather Case for Espresso Machine', 150)),
        idea(2, product('beans', 'Espresso Beans 1kg', 150)),
      ],
      options()
    );
    expect(result.ideas).toHaveLength(2);
    const accessory = result.ideas.find((i) => i.product.product.canonicalId === 'case')!;
    expect(accessory.productType).toBe('accessory');
    expect(accessory.score).toBeLessThan(result.ideas.find((i) => i.product.product.canonicalId === 'beans')!.score);
  });

  it('demotes a repeatedly dismissed product type without hiding it', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < 3; i += 1) {
      ledger = recordSignal(ledger, {
        recipientId: 'r1',
        dimension: 'productType',
        key: 'accessory',
        action: 'dismissed',
        at: NOW,
      });
    }
    const result = rankGiftIdeas(
      [
        idea(1, product('case', 'Leather Case for Espresso Machine', 150)),
        idea(2, product('beans', 'Espresso Beans 1kg', 150)),
      ],
      options({ ledger, interests: ['coffee'] })
    );
    // Type-level signals are soft: the accessory stays visible but scores lower.
    expect(result.hidden.dismissed).toBe(0);
    expect(result.ideas).toHaveLength(2);
    const accessory = result.ideas.find((i) => i.product.product.canonicalId === 'case')!;
    expect(accessory.affinity).toBeLessThan(0);
  });

  it('hides a search that keeps getting dismissed', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < 3; i += 1) {
      ledger = recordSignal(ledger, {
        recipientId: 'r1',
        dimension: 'intent',
        key: 'interest/jewelry/necklace-0',
        action: 'dismissed',
        at: NOW,
      });
    }
    const result = rankGiftIdeas(
      [
        idea(1, product('necklace', 'Gold Necklace', 150), {
          intentId: 'interest/jewelry/necklace-0',
          intentLabel: 'Jewelry',
        }),
        idea(2, product('beans', 'Espresso Beans 1kg', 150)),
      ],
      options({ ledger, interests: ['coffee', 'jewelry'] })
    );
    expect(result.hidden.dismissed).toBe(1);
    expect(result.ideas.map((i) => i.product.product.canonicalId)).toEqual(['beans']);
  });

  it('does not let a saved-then-dismissed row count as two dismissals', () => {
    let ledger = recordSignal(emptyLedger(), {
      recipientId: 'r1',
      dimension: 'intent',
      key: 'interest/coffee/espresso-machine-0',
      action: 'saved',
      at: NOW,
    });
    ledger = recordSignal(ledger, {
      recipientId: 'r1',
      dimension: 'intent',
      key: 'interest/coffee/espresso-machine-0',
      action: 'dismissed',
      at: NOW,
    });
    expect(ledger.rows[0].counts).toEqual({ clicked: 0, saved: 1, dismissed: 1 });
    // +3 saved − 4 dismissed = −1 → tanh(−0.25), nowhere near suppression.
    expect(isSuppressed(affinity(ledger, { recipientId: 'r1', dimension: 'intent', key: 'interest/coffee/espresso-machine-0' }, NOW))).toBe(false);
  });

  it('re-ranks with semantic similarity when a vector is present', () => {
    const near = new Float32Array([1, 0, 0]);
    const far = new Float32Array([0, 1, 0]);
    const result = rankGiftIdeas(
      [
        idea(1, product('far', 'Cordless Drill', 150)),
        idea(2, product('near', 'Espresso Machine', 150)),
      ],
      options({
        budgetMax: 200,
        semanticQuery: 'cozy espresso morning',
        semanticVector: near,
        ideaVectors: new Map([
          ['far', far],
          ['near', near],
        ]),
      })
    );
    expect(result.ideas[0].product.product.canonicalId).toBe('near');
    expect(result.ideas[0].semantic).toBeGreaterThan(result.ideas[1].semantic ?? 0);
  });

  it('treats a missing semantic signal as neutral, not zero', () => {
    const result = rankGiftIdeas([idea(1, product('a', 'Espresso Machine', 150))], options());
    expect(result.ideas[0].semantic).toBeNull();
  });

  it('explains itself: budget reason and type tag are on every idea', () => {
    const result = rankGiftIdeas([idea(1, product('a', 'Espresso Machine', 150))], options({ budgetMax: 200 }));
    expect(result.ideas[0].budget.reason).toMatch(/sweet spot/);
    expect(result.ideas[0].productTypeReason.length).toBeGreaterThan(0);
  });

  it('decays relevance with server position', () => {
    expect(relevanceFromPosition(1)).toBeGreaterThan(relevanceFromPosition(20));
    expect(relevanceFromPosition(200)).toBeLessThan(0.1);
  });
});

describe('buildBundles', () => {
  function bundleInputs() {
    const core = idea(1, product('pan', 'Cast Iron Skillet', 60), {
      intentId: 'interest/cooking/chef-knife-0',
      intentLabel: 'Cooking',
      families: ['interest'],
    });
    const partner = idea(2, product('flour', 'Bread Flour 5lb', 12), {
      intentId: 'interest/baking/sourdough-kit-0',
      intentLabel: 'Baking',
      families: ['interest'],
    });
    return [core, partner];
  }

  it('pairs a core gift with a consumable from another interest', () => {
    const ranked = rankGiftIdeas(bundleInputs(), options({ budgetMax: 200, interests: ['cooking', 'baking'] }));
    const bundles = buildBundles(ranked.ideas, options({ budgetMax: 200, interests: ['cooking', 'baking'] }));
    expect(bundles).toHaveLength(1);
    expect(bundles[0].items).toHaveLength(2);
    expect(bundles[0].label).toContain('Cooking');
  });

  it('does not invent bundles for a single-interest profile', () => {
    const ranked = rankGiftIdeas(bundleInputs(), options({ interests: ['cooking'] }));
    expect(ranked.bundles).toEqual([]);
  });

  it('respects the budget ceiling when pairing', () => {
    const priced = [
      idea(1, product('a', 'Cast Iron Skillet', 190), { intentId: 'interest/cooking/x' }),
      idea(2, product('b', 'Baking Sheet Set', 90), { intentId: 'interest/baking/y' }),
    ];
    const ranked = rankGiftIdeas(priced, options({ budgetMax: 200, interests: ['cooking', 'baking'] }));
    expect(ranked.bundles).toEqual([]);
  });
});
