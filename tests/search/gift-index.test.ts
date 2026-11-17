// ── Gift index integrity ────────────────────────────────────────────────
//
// The index is data, so these tests are the compiler for it: every
// invariant `search/gift/brief.ts` relies on is asserted here.

import { describe, it, expect } from 'vitest';
import { AGE_BRACKET_PROFILES, INTEREST_PROFILES } from '@/search/gift/index-data';
import { validateGiftIndex } from '@/search/gift/schema';
import { AGE_BRACKETS, INTEREST_IDS } from '@/search/gift/types';
import type { AgeBracket } from '@/search/gift/types';

const MINORS: AgeBracket[] = ['infant', 'toddler', 'child', 'tween', 'teen'];

describe('gift index structure', () => {
  it('validates against its own schema and semantics', () => {
    const issues = validateGiftIndex({
      interests: INTEREST_PROFILES,
      brackets: AGE_BRACKET_PROFILES,
    });
    expect(issues).toEqual([]);
  });

  it('covers every declared interest exactly once', () => {
    const ids = INTEREST_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...INTEREST_IDS].sort());
  });

  it('covers every age bracket exactly once', () => {
    const ids = AGE_BRACKET_PROFILES.map((b) => b.id);
    expect(ids).toEqual([...AGE_BRACKETS]);
  });

  it('namespaces intent ids under their interest', () => {
    for (const profile of INTEREST_PROFILES) {
      for (const intent of profile.intents) {
        expect(intent.id.startsWith(`${profile.id}/`)).toBe(true);
      }
    }
    for (const bracket of AGE_BRACKET_PROFILES) {
      for (const intent of bracket.universalIntents) {
        expect(intent.id.startsWith(`universal/${bracket.id}/`)).toBe(true);
      }
    }
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
      }
    }
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
  const good = {
    interests: INTEREST_PROFILES,
    brackets: AGE_BRACKET_PROFILES,
  };

  it('flags a duplicated intent id', () => {
    const clone = structuredClone(good);
    clone.interests[1].intents[0].id = clone.interests[0].intents[0].id;
    expect(validateGiftIndex(clone).join('\n')).toMatch(/duplicate intent id/);
  });

  it('flags a duplicated query across intents', () => {
    const clone = structuredClone(good);
    clone.interests[1].intents[0].query = clone.interests[0].intents[0].query;
    expect(validateGiftIndex(clone).join("\n")).toMatch(/share the query/);
  });

  it('flags an interest reachable at an age with nothing to offer', () => {
    const clone = structuredClone(good);
    const reading = clone.interests.find((p) => p.id === 'reading')!;
    reading.giftableAgeBrackets = ['infant'];
    for (const intent of reading.intents) {
      intent.onlyAgeBrackets = ['adult'];
      delete intent.avoidAgeBrackets;
    }
    expect(validateGiftIndex(clone).join('\n')).toMatch(/no offerable intent/);
  });

  it('flags a bracket with too few neutral fallbacks', () => {
    const clone = structuredClone(good);
    clone.brackets[0].universalIntents = clone.brackets[0].universalIntents.map((intent) => ({
      ...intent,
      lean: 'woman' as const,
    }));
    expect(validateGiftIndex(clone).join('\n')).toMatch(/at least 2 neutral universal intents/);
  });
});
