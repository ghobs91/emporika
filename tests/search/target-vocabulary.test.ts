import { describe, expect, it } from 'vitest';
import { buildQueryVocabulary, normalizeQuery, MAX_VOCABULARY_QUERIES } from '@/lib/target-vocabulary';

describe('normalizeQuery', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeQuery('  Air   Fryer  ')).toBe('air fryer');
  });

  it('collapses punctuation so equivalent queries share one key', () => {
    // Without this, the vocabulary built from "usb c cable" would never match a
    // shopper typing "USB-C cable".
    expect(normalizeQuery('USB-C cable')).toBe('usb c cable');
    expect(normalizeQuery('usb+cable')).toBe('usb cable');
    expect(normalizeQuery('men’s jacket')).toBe('men s jacket');
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeQuery('  ---  ')).toBe('');
  });
});

describe('buildQueryVocabulary', () => {
  it('unions groups in order, earlier groups first', () => {
    expect(
      buildQueryVocabulary([['first'], ['second', 'third']])
    ).toEqual(['first', 'second', 'third']);
  });

  it('deduplicates case- and punctuation-insensitively', () => {
    expect(
      buildQueryVocabulary([['USB C Cable'], ['usb-c cable'], ['usb  c  cable']])
    ).toEqual(['usb c cable']);
  });

  it('drops queries too short to be useful and non-string noise', () => {
    expect(
      buildQueryVocabulary([['ab', '', '   ', 'ok term', 42 as unknown as string]])
    ).toEqual(['ok term']);
  });

  it('stops at the cap rather than truncating silently at the end', () => {
    const many = Array.from({ length: 50 }, (_, i) => `query number ${i}`);
    const vocabulary = buildQueryVocabulary([many], 5);
    expect(vocabulary).toHaveLength(5);
    expect(vocabulary[0]).toBe('query number 0');
    expect(vocabulary[4]).toBe('query number 4');
  });

  it('defaults to a cap that keeps the artifact small', () => {
    expect(MAX_VOCABULARY_QUERIES).toBeGreaterThan(1_000);
    expect(MAX_VOCABULARY_QUERIES).toBeLessThanOrEqual(50_000);
  });

  it('handles empty input', () => {
    expect(buildQueryVocabulary([])).toEqual([]);
    expect(buildQueryVocabulary([[]])).toEqual([]);
  });
});
