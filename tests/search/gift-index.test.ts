// ── Gift index integrity ────────────────────────────────────────────────
//
// The index is data, so these tests are the compiler for it: every
// invariant `search/gift/brief.ts` relies on is asserted here.

import { describe, it, expect } from 'vitest';
import {
  AGE_BRACKET_PROFILES,
  COMBO_INTENTS,
  GENDER_INTENTS,
  INTEREST_PROFILES,
} from '@/search/gift/index-data';
import { BRANDS } from '@/search/gift/brands';
import { currentGiftIndex, validateGiftIndex } from '@/search/gift/schema';
import { AGE_BRACKETS, INTEREST_IDS } from '@/search/gift/types';
import type { AgeBracket } from '@/search/gift/types';

const MINORS: AgeBracket[] = ['infant', 'toddler', 'child', 'tween', 'teen'];

describe('gift index structure', () => {
  it('validates against its own schema and semantics', () => {
    expect(validateGiftIndex(currentGiftIndex())).toEqual([]);
  });

  it('covers every declared interest exactly once', () => {
    const ids = INTEREST_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...INTEREST_IDS].sort());
  });

  it('covers every age bracket exactly once', () => {
    expect(AGE_BRACKET_PROFILES.map((b) => b.id)).toEqual([...AGE_BRACKETS]);
  });

  it('gives every interest real intents with a usable query', () => {
    for (const profile of INTEREST_PROFILES) {
      expect(profile.intents.length).toBeGreaterThanOrEqual(3);
      for (const intent of profile.intents) {
        // One-word queries are legitimate ("headphones", "necklace"); what
        // matters is that the query is a real, non-empty retailer search.
        expect(intent.query.trim().length).toBeGreaterThanOrEqual(3);
        expect(intent.query).toBe(intent.query.trim());
        expect(intent.why.length).toBeGreaterThan(10);
        expect(intent.facets).toContain(`interest:${profile.id}`);
      }
    }
  });

  it('gives every age bracket its own standalone layer', () => {
    for (const bracket of AGE_BRACKET_PROFILES) {
      expect(bracket.ageIntents.length).toBeGreaterThanOrEqual(5);
      for (const intent of bracket.ageIntents) {
        expect(intent.facets).toContain(`age:${bracket.id}`);
      }
    }
  });

  it('offers a standalone gender layer for both binary genders', () => {
    for (const gender of ['woman', 'man'] as const) {
      expect(GENDER_INTENTS[gender].length).toBeGreaterThanOrEqual(12);
      for (const intent of GENDER_INTENTS[gender]) {
        expect(intent.facets).toContain(`gender:${gender}`);
      }
    }
  });

  it('makes combination intents answer more than one trait', () => {
    expect(COMBO_INTENTS.length).toBeGreaterThan(0);
    for (const intent of COMBO_INTENTS) {
      expect(intent.facets.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('carries a brand catalog big enough to be combinatorial', () => {
    expect(BRANDS.length).toBeGreaterThanOrEqual(150);
    for (const brand of BRANDS) {
      expect(brand.categories.length).toBeGreaterThanOrEqual(1);
      expect(brand.ages.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('is large overall — the whole matrix, not just the interest layer', () => {
    const authored =
      INTEREST_PROFILES.reduce((sum, p) => sum + p.intents.length, 0) +
      AGE_BRACKET_PROFILES.reduce((sum, b) => sum + b.ageIntents.length + b.universalIntents.length, 0) +
      GENDER_INTENTS.woman.length +
      GENDER_INTENTS.man.length +
      COMBO_INTENTS.length;
    // The authored matrix alone is ~1.7x the previous interest-only index;
    // with the brand layer every profile can reach ~470 distinct searches.
    expect(authored).toBeGreaterThanOrEqual(275);
    expect(authored + BRANDS.length).toBeGreaterThanOrEqual(460);
  });

  it('never lets an alcohol-related intent reach a minor bracket', () => {
    const wine = INTEREST_PROFILES.find((p) => p.id === 'wine_spirits');
    expect(wine).toBeDefined();
    for (const intent of wine!.intents) {
      expect(intent.avoidAgeBrackets).toBeDefined();
      for (const minor of MINORS) {
        expect(intent.avoidAgeBrackets).toContain(minor);
      }
    }
  });

  it('keeps minors out of the wine interest entirely', () => {
    const wine = INTEREST_PROFILES.find((p) => p.id === 'wine_spirits');
    for (const minor of MINORS) {
      expect(wine!.giftableAgeBrackets).not.toContain(minor);
    }
  });

  it('gives every age bracket at least two neutral fallback gifts', () => {
    for (const bracket of AGE_BRACKET_PROFILES) {
      const neutral = bracket.universalIntents.filter((i) => i.lean === 'neutral');
      expect(neutral.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses ascending, non-overlapping bracket ranges', () => {
    for (let i = 1; i < AGE_BRACKET_PROFILES.length; i += 1) {
      const previous = AGE_BRACKET_PROFILES[i - 1];
      const current = AGE_BRACKET_PROFILES[i];
      expect(previous.maxAge).not.toBeNull();
      expect(current.minAge).toBe(previous.maxAge! + 1);
    }
    expect(AGE_BRACKET_PROFILES[AGE_BRACKET_PROFILES.length - 1].maxAge).toBeNull();
  });
});

describe('validateGiftIndex rejects broken data', () => {
  const good = () => structuredClone(currentGiftIndex());

  it('flags a duplicated intent id', () => {
    const clone = good();
    clone.interests[1].intents[0].id = clone.interests[0].intents[0].id;
    expect(validateGiftIndex(clone).join('\n')).toMatch(/duplicate intent id/);
  });

  it('flags a repeated query inside one source', () => {
    const clone = good();
    // Same interest profile, same query twice: a copy-paste bug, not variety.
    clone.interests[0].intents[1].query = clone.interests[0].intents[0].query;
    expect(validateGiftIndex(clone).join('\n')).toMatch(/repeats query/);
  });

  it('allows the same query across different layers', () => {
    // A genuinely good gift can answer "age" and "interest" at once; selection
    // de-duplicates it at runtime, so this must not be an index error.
    const clone = good();
    clone.interests[0].intents[0].query = clone.brackets[0].ageIntents[0].query;
    expect(validateGiftIndex(clone).join('\n')).not.toMatch(/repeats query/);
  });

  it('flags an interest reachable at an age with nothing to offer', () => {
    const clone = good();
    const reading = clone.interests.find((p) => p.id === 'reading')!;
    reading.giftableAgeBrackets = ['infant'];
    for (const intent of reading.intents) {
      intent.onlyAgeBrackets = ['adult'];
      delete intent.avoidAgeBrackets;
    }
    expect(validateGiftIndex(clone).join('\n')).toMatch(/no offerable intent/);
  });

  it('flags a bracket with too few neutral fallbacks', () => {
    const clone = good();
    clone.brackets[0].universalIntents = clone.brackets[0].universalIntents.map((intent) => ({
      ...intent,
      lean: 'woman' as const,
    }));
    expect(validateGiftIndex(clone).join('\n')).toMatch(/at least 2 neutral universal intents/);
  });

  it('flags an unknown facet value', () => {
    const clone = good();
    clone.interests[0].intents[0].facets = ['interest:not_a_thing'];
    expect(validateGiftIndex(clone).join('\n')).toMatch(/unknown interest facet/);
  });

  it('flags a brand that can never serve its interest', () => {
    const clone = good();
    clone.brands[0] = { ...clone.brands[0], ages: ['infant'], interests: ['wine_spirits'] };
    expect(validateGiftIndex(clone).join('\n')).toMatch(/none of its ages overlap/);
  });

  it('flags a duplicate brand slug', () => {
    const clone = good();
    clone.brands[1] = { ...clone.brands[1], slug: clone.brands[0].slug };
    expect(validateGiftIndex(clone).join('\n')).toMatch(/duplicate brand slug/);
  });

  it('flags a bracket that lost its age-alone layer', () => {
    const clone = good();
    clone.brackets[0].ageIntents = clone.brackets[0].ageIntents.slice(0, 2);
    expect(validateGiftIndex(clone).join('\n')).toMatch(/at least 5 age-alone intents/);
  });
});
