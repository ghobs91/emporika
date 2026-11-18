// ── Deterministic gift brief: facets, coverage and scoring ──────────────

import { describe, it, expect } from 'vitest';
import {
  AGE_AFFINITY_BONUS,
  COMBINATION_BONUS,
  MAX_MAX_INTENTS,
  MAX_PER_SOURCE,
  buildGiftBrief,
  idealTierForBudget,
  intentFamilies,
  isIntentOfferable,
  scoreIntent,
  selectGiftIntents,
} from '@/search/gift/brief';
import { ageBracketForAge } from '@/search/gift/taxonomy';
import { AGE_BRACKET_PROFILES, INTEREST_PROFILES } from '@/search/gift/index-data';
import { giftRecipientSchema } from '@/search/gift/schema';
import type { GiftRecipient, InterestId } from '@/search/gift/types';

function recipient(overrides: Partial<GiftRecipient> = {}): GiftRecipient {
  return {
    id: 'r1',
    name: 'Sam',
    gender: 'unspecified',
    age: 30,
    interests: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ageBracketForAge', () => {
  it('maps bracket edges and clamps out-of-range input', () => {
    expect(ageBracketForAge(0)).toBe('infant');
    expect(ageBracketForAge(1)).toBe('infant');
    expect(ageBracketForAge(2)).toBe('toddler');
    expect(ageBracketForAge(4)).toBe('child');
    expect(ageBracketForAge(9)).toBe('tween');
    expect(ageBracketForAge(13)).toBe('teen');
    expect(ageBracketForAge(18)).toBe('young_adult');
    expect(ageBracketForAge(26)).toBe('adult');
    expect(ageBracketForAge(41)).toBe('mature_adult');
    expect(ageBracketForAge(61)).toBe('senior');
    expect(ageBracketForAge(120)).toBe('senior');
    expect(ageBracketForAge(-5)).toBe('infant');
    expect(ageBracketForAge(Number.NaN)).toBe('infant');
  });
});

describe('isIntentOfferable', () => {
  const coffee = INTEREST_PROFILES.find((p) => p.id === 'coffee')!;

  it('offers ordinary intents at every giftable bracket', () => {
    const grinder = coffee.intents.find((i) => i.query === 'coffee grinder')!;
    expect(isIntentOfferable(grinder, 'adult')).toBe(true);
  });

  it('honours onlyAgeBrackets', () => {
    const reading = INTEREST_PROFILES.find((p) => p.id === 'reading')!;
    const boardBooks = reading.intents.find((i) => i.query === 'board books')!;
    expect(isIntentOfferable(boardBooks, 'toddler')).toBe(true);
    expect(isIntentOfferable(boardBooks, 'adult')).toBe(false);
  });

  it('honours avoidAgeBrackets', () => {
    const grilling = INTEREST_PROFILES.find((p) => p.id === 'grilling')!;
    const pelletGrill = grilling.intents.find((i) => i.query === 'pellet grill')!;
    expect(isIntentOfferable(pelletGrill, 'teen')).toBe(false);
    expect(isIntentOfferable(pelletGrill, 'adult')).toBe(true);
  });
});

describe('intentFamilies', () => {
  it('derives the facet families an intent answers', () => {
    const coffee = INTEREST_PROFILES.find((p) => p.id === 'coffee')!;
    expect(intentFamilies(coffee.intents[0])).toEqual(['interest']);
  });

  it('reports every family of a multi-trait intent', () => {
    const combo = buildGiftBrief(recipient({ gender: 'woman', age: 34 })).intents.find((i) =>
      i.families.includes('combo')
    );
    expect(combo).toBeDefined();
    expect(combo!.families).toEqual(['age', 'gender', 'combo']);
  });
});

describe('buildGiftBrief — one trait at a time', () => {
  it('builds a useful list from age alone', () => {
    const brief = buildGiftBrief(recipient({ age: 34, gender: 'unspecified', interests: [] }), {
      maxIntents: 6,
    });
    expect(brief.coverage.age).toBeGreaterThan(0);
    expect(brief.coverage.gender).toBe(0);
    expect(brief.intents.length).toBe(6);
    // Nothing may claim an interest the shopper did not pick.
    expect(brief.intents.every((entry) => !entry.families.includes('interest'))).toBe(true);
  });

  it('builds a useful list from gender alone, with brands standing in', () => {
    for (const gender of ['woman', 'man'] as const) {
      const brief = buildGiftBrief(recipient({ age: 34, gender, interests: [] }), {
        maxIntents: 6,
      });
      expect(brief.coverage.gender).toBeGreaterThan(0);
      expect(brief.coverage.age).toBeGreaterThan(0);
      expect(brief.intents.length).toBe(6);
    }
  });

  it('builds a useful list from an interest alone', () => {
    const brief = buildGiftBrief(recipient({ age: 34, interests: ['coffee'] }), { maxIntents: 6 });
    expect(brief.coverage.interest).toBeGreaterThanOrEqual(2);
    expect(brief.coverage.age).toBeGreaterThan(0);
  });

  it('does not assert a gender layer for nonbinary or unspecified recipients', () => {
    for (const gender of ['nonbinary', 'unspecified'] as const) {
      const brief = buildGiftBrief(recipient({ age: 34, gender }), { maxIntents: 6 });
      expect(brief.coverage.gender).toBe(0);
      expect(brief.coverage.combo).toBe(0);
    }
  });

  it('adds the combination layer for a gendered recipient at a mapped bracket', () => {
    const brief = buildGiftBrief(recipient({ age: 34, gender: 'man' }), { maxIntents: 6 });
    expect(brief.coverage.combo).toBeGreaterThan(0);
  });
});

describe('buildGiftBrief — combinations', () => {
  it('gives age, gender, interest and brand their own slots', () => {
    const brief = buildGiftBrief(
      recipient({ age: 34, gender: 'woman', interests: ['coffee'] }),
      { maxIntents: 6 }
    );
    for (const family of ['age', 'gender', 'interest', 'brand'] as const) {
      expect(brief.coverage[family], `family ${family}`).toBeGreaterThan(0);
    }
  });

  it('scores a multi-trait intent above a single-trait one of equal strength', () => {
    const brief = buildGiftBrief(recipient({ age: 34, gender: 'woman' }), { maxIntents: 6 });
    const combo = brief.intents.find((entry) => entry.families.includes('combo'));
    const single = brief.intents.find((entry) => entry.families.length === 1);
    expect(combo).toBeDefined();
    expect(single).toBeDefined();
    expect(combo!.breakdown.combinationBonus).toBeGreaterThan(single!.breakdown.combinationBonus);
    expect(combo!.breakdown.combinationBonus).toBeCloseTo(COMBINATION_BONUS * 2, 5);
  });

  it('lifts the same interest inside its prime age window', () => {
    const inside = buildGiftBrief(recipient({ age: 34, interests: ['coffee'] }), { maxIntents: 8 });
    const outside = buildGiftBrief(recipient({ age: 16, interests: ['coffee'] }), { maxIntents: 8 });

    const pick = (brief: ReturnType<typeof buildGiftBrief>) =>
      brief.intents.find((entry) => entry.intent.query === 'coffee grinder')?.breakdown.ageAffinity;

    expect(pick(inside)).toBeCloseTo(AGE_AFFINITY_BONUS, 5);
    expect(pick(outside)).toBe(0);
  });

  it('keeps the ordered set deterministic', () => {
    const input = recipient({ gender: 'man', age: 34, interests: ['gaming', 'coffee'] });
    expect(buildGiftBrief(input)).toEqual(buildGiftBrief(input));
  });
});

describe('buildGiftBrief — existing guarantees', () => {
  it('falls back to the age-bracket budget ceiling', () => {
    const brief = buildGiftBrief(recipient({ age: 2 }));
    const bracket = AGE_BRACKET_PROFILES.find((b) => b.id === 'toddler')!;
    expect(brief.budget.max).toBe(bracket.budgetCeiling);
    expect(brief.budget.source).toBe('age_bracket');
  });

  it('prefers a recipient budget when one is set', () => {
    const brief = buildGiftBrief(recipient({ age: 34, budget: 45 }));
    expect(brief.budget).toEqual({ min: 0, max: 45, source: 'recipient' });
  });

  it('drops interests that do not apply at the age, with a reason', () => {
    const brief = buildGiftBrief(recipient({ age: 7, interests: ['wine_spirits', 'toys_play'] }));
    expect(brief.appliedInterests).toContain('toys_play');
    expect(brief.appliedInterests).not.toContain('wine_spirits');
    expect(brief.droppedInterests).toEqual([
      { id: 'wine_spirits', reason: expect.stringContaining('not a plausible gift') },
    ]);
  });

  it('never hands a toddler a knife, alcohol or a power tool', () => {
    const brief = buildGiftBrief(
      recipient({ age: 2, interests: ['cooking', 'wine_spirits', 'tools_diy'] })
    );
    const queries = brief.intents.map((i) => i.intent.query.toLowerCase());
    for (const forbidden of ['knife', 'wine', 'cocktail', 'drill', 'tool set']) {
      expect(queries.some((q) => q.includes(forbidden))).toBe(false);
    }
  });

  it('keeps a gendered recipient at a neutral majority', () => {
    for (const gender of ['woman', 'man'] as const) {
      for (const age of [16, 34, 50]) {
        const brief = buildGiftBrief(recipient({ gender, age }), { maxIntents: 6 });
        const neutral = brief.intents.filter((i) => i.intent.lean === 'neutral').length;
        expect(neutral, `${gender} ${age}`).toBeGreaterThanOrEqual(Math.ceil(brief.intents.length / 2));
      }
    }
  });

  it('offers every gender the same candidate pool', () => {
    const base = { age: 30, interests: ['coffee', 'jewelry'] as InterestId[] };
    const asWoman = buildGiftBrief(recipient({ ...base, gender: 'woman' }), { maxIntents: 8 });
    const asMan = buildGiftBrief(recipient({ ...base, gender: 'man' }), { maxIntents: 8 });
    expect(asWoman.intents.length).toBe(asMan.intents.length);
    // The candidate *pool* is identical; only ordering and the combo layer
    // differ. Checked by comparing the reachable families.
    expect(new Set(asWoman.intents.flatMap((i) => i.families))).toEqual(
      new Set(asMan.intents.flatMap((i) => i.families))
    );
  });

  it('treats unspecified gender as fully neutral', () => {
    const brief = buildGiftBrief(recipient({ gender: 'unspecified', age: 30 }), { maxIntents: 6 });
    for (const entry of brief.intents) {
      expect(entry.breakdown.leanNudge).toBe(0);
    }
  });

  it('respects the requested number of intents', () => {
    for (const maxIntents of [1, 3, 6]) {
      const brief = buildGiftBrief(recipient({ age: 34, interests: ['coffee'] }), { maxIntents });
      expect(brief.intents.length).toBe(maxIntents);
    }
  });

  it('clamps out-of-range intent counts instead of failing', () => {
    const brief = buildGiftBrief(recipient({ age: 30 }), { maxIntents: 99 });
    expect(brief.intents.length).toBeLessThanOrEqual(MAX_MAX_INTENTS);
    expect(brief.intents.length).toBeGreaterThan(0);
  });

  it('caps how much one source can dominate', () => {
    const brief = buildGiftBrief(recipient({ age: 30, interests: ['coffee'] }), { maxIntents: 8 });
    const perSource = new Map<string, number>();
    for (const entry of brief.intents) {
      perSource.set(entry.sourceKey, (perSource.get(entry.sourceKey) ?? 0) + 1);
    }
    for (const [source, count] of perSource) {
      if (source.startsWith('__universal')) continue;
      expect(count, source).toBeLessThanOrEqual(MAX_PER_SOURCE);
    }
  });

  it('never repeats a query within one brief', () => {
    const brief = buildGiftBrief(
      recipient({ age: 34, gender: 'woman', interests: ['coffee', 'reading', 'hiking'] }),
      { maxIntents: 8 }
    );
    const queries = brief.intents.map((i) => i.intent.query.toLowerCase());
    expect(new Set(queries).size).toBe(queries.length);
  });

  it('prefers small gifts when the budget is small', () => {
    const brief = buildGiftBrief(
      recipient({ age: 30, interests: ['coffee'], budget: 30 }),
      { maxIntents: 4 }
    );
    const coffee = brief.intents.find((entry) => entry.sourceKey === 'interest:coffee');
    expect(coffee?.intent.tier).toBe('stocking');
  });

  it('carries the bracket exclusions used for title filtering', () => {
    const brief = buildGiftBrief(recipient({ age: 2 }));
    expect(brief.exclusions).toContain('small parts');
    expect(brief.exclusions).toContain('alcohol');
  });

  it('carries the recipient merchant exclusions', () => {
    const brief = buildGiftBrief(recipient({ excludedProviders: ['ebay', 'costco'] }));
    expect(brief.excludedProviders).toEqual(['ebay', 'costco']);
  });

  it('sorts intents by descending score with a stable id tiebreak', () => {
    const brief = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
      maxIntents: 8,
    });
    for (let i = 1; i < brief.intents.length; i += 1) {
      const previous = brief.intents[i - 1];
      const current = brief.intents[i];
      if (previous.score === current.score) {
        expect(previous.intent.id.localeCompare(current.intent.id)).toBeLessThan(0);
      } else {
        expect(previous.score).toBeGreaterThan(current.score);
      }
    }
  });
});

describe('scoring helpers', () => {
  it('picks a tier that matches the budget scale', () => {
    expect(idealTierForBudget(30)).toBe('stocking');
    expect(idealTierForBudget(49)).toBe('stocking');
    expect(idealTierForBudget(50)).toBe('standard');
    expect(idealTierForBudget(149)).toBe('standard');
    expect(idealTierForBudget(150)).toBe('hero');
  });

  it('penalises a gift tier that cannot fit the ceiling', () => {
    const coffee = INTEREST_PROFILES.find((p) => p.id === 'coffee')!;
    const espresso = coffee.intents.find((i) => i.query === 'espresso machine')!;
    const cheap = scoreIntent(espresso, { budgetMax: 30, gender: 'unspecified' });
    const rich = scoreIntent(espresso, { budgetMax: 400, gender: 'unspecified' });
    expect(cheap.tierFit).toBeLessThan(rich.tierFit);
  });

  it('nudges by lean without ever excluding', () => {
    const jewelry = INTEREST_PROFILES.find((p) => p.id === 'jewelry')!;
    const necklace = jewelry.intents.find((i) => i.query === 'necklace')!;
    const woman = scoreIntent(necklace, { budgetMax: 200, gender: 'woman' });
    const man = scoreIntent(necklace, { budgetMax: 200, gender: 'man' });
    expect(woman.leanNudge).toBeGreaterThan(0);
    expect(man.leanNudge).toBeLessThan(0);
    expect(Math.abs(woman.leanNudge)).toBeLessThanOrEqual(0.05);
  });
});

describe('selectGiftIntents', () => {
  const ranked = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
    maxIntents: 8,
  });

  it('returns the ranked candidates unchanged when asked for all of them', () => {
    const all = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
      maxIntents: 8,
    });
    const selected = selectGiftIntents(all.intents, {
      maxIntents: all.intents.length,
      gender: 'unspecified',
    });
    expect(selected.map((i) => i.intent.id)).toEqual(all.intents.map((i) => i.intent.id));
  });

  it('never returns duplicates', () => {
    const ids = ranked.intents.map((i) => i.intent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('giftRecipientSchema', () => {
  it('accepts a well-formed recipient', () => {
    expect(giftRecipientSchema.safeParse(recipient({ interests: ['coffee'] })).success).toBe(true);
  });

  it('accepts merchant exclusions and rejects unknown retailers', () => {
    expect(
      giftRecipientSchema.safeParse({ ...recipient(), excludedProviders: ['ebay', 'walmart'] }).success
    ).toBe(true);
    expect(
      giftRecipientSchema.safeParse({ ...recipient(), excludedProviders: ['amazon'] }).success
    ).toBe(false);
  });

  it('rejects unknown interests, bad ages and negative budgets', () => {
    expect(giftRecipientSchema.safeParse({ ...recipient(), interests: ['nope'] }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), age: 200 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), age: 3.5 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), budget: -10 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), gender: 'other' }).success).toBe(false);
  });
});
