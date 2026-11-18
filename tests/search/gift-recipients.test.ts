// ── Gift recipient persistence (pure layer) ─────────────────────────────
//
// The storage adapter itself is a thin localStorage wrapper; the logic worth
// testing is the pure part: sanitising what comes back off disk, and the
// bounded insert/update/remove operations.

import { describe, it, expect } from 'vitest';
import {
  createRecipient,
  MAX_RECIPIENTS,
  removeRecipient,
  sanitizeRecipients,
  updateRecipient,
  upsertRecipient,
} from '@/lib/gift-recipients';
import type { GiftRecipient } from '@/search/gift/types';

function recipient(overrides: Partial<GiftRecipient> = {}): GiftRecipient {
  return {
    id: 'r1',
    name: 'Sam',
    gender: 'unspecified',
    age: 30,
    interests: ['coffee'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('sanitizeRecipients', () => {
  it('drops entries that no longer validate', () => {
    const clean = recipient({ id: 'ok' });
    const result = sanitizeRecipients([
      clean,
      { ...recipient({ id: 'stale' }), interests: ['not-an-interest'] },
      { ...recipient({ id: 'ancient' }), age: 999 },
      null,
      'nonsense',
    ]);
    expect(result.map((entry) => entry.id)).toEqual(['ok']);
  });

  it('returns an empty list for non-array input', () => {
    expect(sanitizeRecipients(null)).toEqual([]);
    expect(sanitizeRecipients({})).toEqual([]);
    expect(sanitizeRecipients('[]')).toEqual([]);
  });

  it('caps the number of stored people', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 5 }, (_, index) =>
      recipient({ id: `r${index}` })
    );
    expect(sanitizeRecipients(many)).toHaveLength(MAX_RECIPIENTS);
  });
});

describe('createRecipient', () => {
  it('trims the name and rounds the age', () => {
    const created = createRecipient(
      { name: '  Priya  ', gender: 'woman', age: 34.6, interests: ['coffee'] },
      1000
    );
    expect(created.name).toBe('Priya');
    expect(created.age).toBe(35);
    expect(created.createdAt).toBe(1000);
    expect(created.updatedAt).toBe(1000);
  });

  it('falls back to a placeholder name instead of storing an empty one', () => {
    expect(
      createRecipient({ name: '   ', gender: 'unspecified', age: 30, interests: [] }).name
    ).toBe('Someone');
  });

  it('clamps out-of-range ages', () => {
    expect(createRecipient({ name: 'A', gender: 'unspecified', age: -3, interests: [] }).age).toBe(0);
    expect(createRecipient({ name: 'A', gender: 'unspecified', age: 500, interests: [] }).age).toBe(120);
  });

  it('drops a non-positive budget', () => {
    expect(
      createRecipient({ name: 'A', gender: 'unspecified', age: 30, interests: [], budget: 0 }).budget
    ).toBeUndefined();
    expect(
      createRecipient({ name: 'A', gender: 'unspecified', age: 30, interests: [], budget: 45 }).budget
    ).toBe(45);
  });

  it('keeps merchant exclusions and clears them when removed', () => {
    const created = createRecipient({
      name: 'A',
      gender: 'unspecified',
      age: 30,
      interests: [],
      excludedProviders: ['ebay', 'ebay', 'costco'],
    });
    expect(created.excludedProviders).toEqual(['ebay', 'costco']);

    const cleared = updateRecipient(created, {
      name: 'A',
      gender: 'unspecified',
      age: 30,
      interests: [],
      excludedProviders: [],
    });
    expect(cleared.excludedProviders).toBeUndefined();
  });

  it('de-duplicates interests', () => {
    const created = createRecipient({
      name: 'A',
      gender: 'unspecified',
      age: 30,
      interests: ['coffee', 'coffee', 'reading'],
    });
    expect(created.interests).toEqual(['coffee', 'reading']);
  });
});

describe('updateRecipient', () => {
  it('keeps identity and createdAt while replacing the editable fields', () => {
    const existing = recipient({ id: 'keep-me', createdAt: 500 });
    const next = updateRecipient(existing, { name: 'Sammy', gender: 'man', age: 41, interests: ['gaming'] }, 900);

    expect(next.id).toBe('keep-me');
    expect(next.createdAt).toBe(500);
    expect(next.updatedAt).toBe(900);
    expect(next.name).toBe('Sammy');
    expect(next.gender).toBe('man');
    expect(next.age).toBe(41);
    expect(next.interests).toEqual(['gaming']);
  });

  it('clears a budget that is removed in the editor', () => {
    const existing = recipient({ budget: 200 });
    const next = updateRecipient(existing, { name: 'Sam', gender: 'unspecified', age: 30, interests: [] });
    expect(next.budget).toBeUndefined();
  });
});

describe('upsertRecipient / removeRecipient', () => {
  it('inserts new people at the front', () => {
    const list = [recipient({ id: 'a' })];
    const next = upsertRecipient(list, recipient({ id: 'b' }));
    expect(next.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('replaces an existing person without duplicating them', () => {
    const list = [recipient({ id: 'a', name: 'Old' }), recipient({ id: 'b', name: 'Bee' })];
    const next = upsertRecipient(list, recipient({ id: 'a', name: 'New' }));
    expect(next.map((entry) => entry.name)).toEqual(['New', 'Bee']);
  });

  it('removes by id and leaves the rest untouched', () => {
    const list = [recipient({ id: 'a' }), recipient({ id: 'b' })];
    expect(removeRecipient(list, 'a').map((entry) => entry.id)).toEqual(['b']);
    expect(removeRecipient(list, 'missing')).toHaveLength(2);
  });
});
