// ── Deterministic gift brief ────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  buildGiftBrief,
  idealTierForBudget,
  isIntentOfferable,
  selectGiftIntents,
  scoreIntent,
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
    expect(ageBracketForAge(3)).toBe('toddler');
    expect(ageBracketForAge(4)).toBe('child');
    expect(ageBracketForAge(8)).toBe('child');
    expect(ageBracketForAge(9)).toBe('tween');
    expect(ageBracketForAge(13)).toBe('teen');
    expect(ageBracketForAge(17)).toBe('teen');
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
    const grinder = coffee.intents.find((i) => i.id === 'coffee/burr-grinder')!;
    expect(isIntentOfferable(grinder, 'adult')).toBe(true);
  });

  it('honours onlyAgeBrackets', () => {
    const reading = INTEREST_PROFILES.find((p) => p.id === 'reading')!;
    const boardBooks = reading.intents.find((i) => i.id === 'reading/board-books')!;
    expect(isIntentOfferable(boardBooks, 'toddler')).toBe(true);
    expect(isIntentOfferable(boardBooks, 'adult')).toBe(false);
  });

  it('honours avoidAgeBrackets', () => {
    const grilling = INTEREST_PROFILES.find((p) => p.id === 'grilling')!;
    const pelletGrill = grilling.intents.find((i) => i.id === 'grilling/pellet-grill')!;
    expect(isIntentOfferable(pelletGrill, 'teen')).toBe(false);
    expect(isIntentOfferable(pelletGrill, 'adult')).toBe(true);
  });
});

describe('buildGiftBrief', () => {
  it('is deterministic for identical input', () => {
    const input = recipient({ gender: 'woman', age: 34, interests: ['coffee', 'reading'] });
    expect(buildGiftBrief(input)).toEqual(buildGiftBrief(input));
  });

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

  it('applies the interest the shopper picked', () => {
    const brief = buildGiftBrief(recipient({ interests: ['coffee'] }));
    expect(brief.appliedInterests).toContain('coffee');
    const interests = brief.intents.map((i) => i.interest);
    expect(interests).toContain('coffee');
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
      const brief = buildGiftBrief(
        recipient({ gender, age: 30, interests: ['beauty_skincare'] }),
        { maxIntents: 3 }
      );
      const neutral = brief.intents.filter((i) => i.intent.lean === 'neutral').length;
      expect(neutral).toBeGreaterThanOrEqual(2);
    }
  });

  it('offers the same candidate pool to every gender', () => {
    const base = { age: 30, interests: ['coffee', 'jewelry'] as InterestId[] };
    const asWoman = buildGiftBrief(recipient({ ...base, gender: 'woman' }), { maxIntents: 5 });
    const asMan = buildGiftBrief(recipient({ ...base, gender: 'man' }), { maxIntents: 5 });

    // Same size, and no intent exists for one gender that cannot exist for the
    // other — gender changes the ordering, never the available set.
    expect(asWoman.intents.length).toBe(asMan.intents.length);
    const all = new Set([
      ...asWoman.intents.map((i) => i.intent.id),
      ...asMan.intents.map((i) => i.intent.id),
    ]);
    for (const id of all) {
      const intent = [...asWoman.intents, ...asMan.intents].find((i) => i.intent.id === id)!;
      expect(isIntentOfferable(intent.intent, 'adult')).toBe(true);
    }
  });

  it('treats unspecified gender as fully neutral', () => {
    const brief = buildGiftBrief(recipient({ gender: 'unspecified', age: 30 }), { maxIntents: 5 });
    for (const entry of brief.intents) {
      expect(entry.breakdown.leanNudge).toBe(0);
    }
  });

  it('respects the requested number of intents', () => {
    for (const maxIntents of [1, 2, 3, 5]) {
      const brief = buildGiftBrief(recipient({ age: 30, interests: ['coffee'] }), { maxIntents });
      expect(brief.intents.length).toBe(maxIntents);
    }
  });

  it('clamps out-of-range intent counts instead of failing', () => {
    const brief = buildGiftBrief(recipient({ age: 30 }), { maxIntents: 99 });
    expect(brief.intents.length).toBeLessThanOrEqual(5);
    expect(brief.intents.length).toBeGreaterThan(0);
  });

  it('caps how much one interest can dominate', () => {
    // 'coffee' has four intents; only two may be searched at once.
    const brief = buildGiftBrief(recipient({ age: 30, interests: ['coffee'] }), { maxIntents: 5 });
    const coffeeCount = brief.intents.filter((i) => i.interest === 'coffee').length;
    expect(coffeeCount).toBeLessThanOrEqual(2);
  });

  it('prefers small gifts when the budget is small', () => {
    const brief = buildGiftBrief(
      recipient({ age: 30, interests: ['coffee'], budget: 30 }),
      { maxIntents: 2 }
    );
    expect(brief.intents[0].intent.tier).toBe('stocking');
  });

  it('carries the bracket exclusions used for title filtering', () => {
    const brief = buildGiftBrief(recipient({ age: 2 }));
    expect(brief.exclusions).toContain('small parts');
    expect(brief.exclusions).toContain('alcohol');
  });

  it('sorts intents by descending score with a stable id tiebreak', () => {
    const brief = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
      maxIntents: 5,
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
    const espresso = coffee.intents.find((i) => i.id === 'coffee/espresso-machine')!;
    const cheap = scoreIntent(espresso, { budgetMax: 30, gender: 'unspecified', universal: false });
    const rich = scoreIntent(espresso, { budgetMax: 400, gender: 'unspecified', universal: false });
    expect(cheap.tierFit).toBeLessThan(rich.tierFit);
  });

  it('nudges by lean without ever excluding', () => {
    const jewelry = INTEREST_PROFILES.find((p) => p.id === 'jewelry')!;
    const necklace = jewelry.intents.find((i) => i.id === 'jewelry/necklace')!;
    const woman = scoreIntent(necklace, { budgetMax: 200, gender: 'woman', universal: false });
    const man = scoreIntent(necklace, { budgetMax: 200, gender: 'man', universal: false });
    expect(woman.leanNudge).toBeGreaterThan(0);
    expect(man.leanNudge).toBeLessThan(0);
    expect(Math.abs(woman.leanNudge)).toBeLessThanOrEqual(0.05);
  });
});

describe('selectGiftIntents', () => {
  const ranked = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
    maxIntents: 5,
  });

  it('returns the ranked candidates unchanged when asked for all of them', () => {
    const all = buildGiftBrief(recipient({ age: 30, interests: ['coffee', 'gaming'] }), {
      maxIntents: 5,
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

  it('rejects unknown interests, bad ages and negative budgets', () => {
    expect(giftRecipientSchema.safeParse({ ...recipient(), interests: ['nope'] }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), age: 200 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), age: 3.5 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), budget: -10 }).success).toBe(false);
    expect(giftRecipientSchema.safeParse({ ...recipient(), gender: 'other' }).success).toBe(false);
  });
});
