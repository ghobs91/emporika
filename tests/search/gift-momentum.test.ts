// ── Momentum signal: the measured half of the index ─────────────────────
//
// `search/gift/momentum-data.ts` is generated from Walmart's sales-ranked
// search. These tests guard the shape of that table and the one behaviour the
// brief depends on: momentum must move the score without becoming a filter.

import { describe, it, expect } from 'vitest';
import {
  MOMENTUM_WEIGHT,
  hasMomentum,
  momentumAgeDays,
  momentumFor,
  momentumSampleSize,
  momentumSampledAt,
  normalizeMomentumKey,
} from '@/search/gift/momentum';
import { MOMENTUM_BY_QUERY } from '@/search/gift/momentum-data';
import { scoreIntent, totalScore } from '@/search/gift/brief';
import type { GiftIntent } from '@/search/gift/types';

function hotQuery(): string {
  const [query] = Object.entries(MOMENTUM_BY_QUERY).sort((a, b) => b[1] - a[1])[0];
  return query;
}

function intent(query: string, overrides: Partial<GiftIntent> = {}): GiftIntent {
  return {
    id: 'test/intent',
    query,
    kind: 'product',
    tier: 'standard',
    strength: 0.7,
    lean: 'neutral',
    facets: ['interest:coffee'],
    why: 'Test intent used to exercise momentum scoring.',
    ...overrides,
  };
}

describe('momentum table', () => {
  it('covers most of the index', () => {
    expect(momentumSampleSize).toBeGreaterThanOrEqual(400);
    expect(Object.keys(MOMENTUM_BY_QUERY).length).toBe(momentumSampleSize);
  });

  it('holds values in [0, 1]', () => {
    for (const [query, value] of Object.entries(MOMENTUM_BY_QUERY)) {
      expect(value, query).toBeGreaterThanOrEqual(0);
      expect(value, query).toBeLessThanOrEqual(1);
    }
  });

  it('uses normalized keys so lookups are case and whitespace insensitive', () => {
    for (const query of Object.keys(MOMENTUM_BY_QUERY)) {
      expect(normalizeMomentumKey(query)).toBe(query);
    }
    const sample = Object.keys(MOMENTUM_BY_QUERY)[0];
    expect(momentumFor(sample.toUpperCase())).toBe(MOMENTUM_BY_QUERY[sample]);
    expect(momentumFor(`  ${sample}  `)).toBe(MOMENTUM_BY_QUERY[sample]);
  });

  it('carries a parseable sample timestamp', () => {
    expect(Number.isFinite(Date.parse(momentumSampledAt))).toBe(true);
    expect(momentumAgeDays()).toBeGreaterThanOrEqual(0);
  });

  it('does not pretend to know queries it never sampled', () => {
    expect(hasMomentum('zzzz not a real gift query')).toBe(false);
    expect(momentumFor('zzzz not a real gift query')).toBe(0);
  });
});

describe('momentum in scoring', () => {
  it('adds a bounded bonus for a query that is selling', () => {
    const query = hotQuery();
    const breakdown = scoreIntent(intent(query), { budgetMax: 200, gender: 'unspecified' });
    expect(breakdown.momentum).toBeGreaterThan(0);
    expect(breakdown.momentum).toBeLessThanOrEqual(MOMENTUM_WEIGHT);
  });

  it('contributes nothing for an unsampled query', () => {
    const breakdown = scoreIntent(intent('zzzz unsigned product'), {
      budgetMax: 200,
      gender: 'unspecified',
    });
    expect(breakdown.momentum).toBe(0);
  });

  it('re-ranks otherwise identical intents, and is in the total', () => {
    const hot = scoreIntent(intent(hotQuery()), { budgetMax: 200, gender: 'unspecified' });
    const cold = scoreIntent(intent('zzzz unsigned product'), {
      budgetMax: 200,
      gender: 'unspecified',
    });
    expect(totalScore(hot)).toBeGreaterThan(totalScore(cold));
    // Everything except momentum is identical, so the gap is exactly the bonus.
    expect(totalScore(hot) - totalScore(cold)).toBeCloseTo(hot.momentum, 6);
  });

  it('never filters: a zero-momentum intent still scores', () => {
    const cold = scoreIntent(intent('zzzz unsigned product'), {
      budgetMax: 200,
      gender: 'unspecified',
    });
    expect(totalScore(cold)).toBeGreaterThan(0);
  });

  it('is small relative to a trait combination', () => {
    // A single-trait intent with maximum momentum must not outrank a
    // three-trait intent with none — combinations stay the stronger signal.
    const hotSingle = scoreIntent(intent(hotQuery()), { budgetMax: 200, gender: 'unspecified' });
    const coldCombo = scoreIntent(
      intent('zzzz unsigned product', {
        facets: ['age:adult', 'gender:man', 'combo:adult:man'],
      }),
      { budgetMax: 200, gender: 'unspecified' }
    );
    expect(totalScore(coldCombo)).toBeGreaterThan(totalScore(hotSingle));
  });
});
