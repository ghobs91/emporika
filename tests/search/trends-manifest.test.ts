// ── Trend manifest integrity ────────────────────────────────────────────
//
// `public/data/trends.json` is committed by a scheduled workflow, so the file
// itself needs a gate: an empty or malformed manifest would silently disable
// the trend boost in production.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_PATH = resolve(process.cwd(), 'public/data/trends.json');

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    version: number;
    updatedAt: string;
    methodology?: { attribution?: string; cohortsWithExplicitAttribution?: number };
    sources?: Array<{ id: string; status: string }>;
    cohorts: Record<string, Record<string, string[]>>;
  };
}

const KNOWN_CATEGORIES = new Set([
  'jewelry',
  'accessories',
  'cooking',
  'tech',
  'home',
  'beauty',
  'fitness',
  'outdoors',
  'kids',
  'pets',
]);

const KNOWN_COHORTS = new Set([
  'women',
  'men',
  'unisex',
  'teens',
  'kids',
  ...['women', 'men', 'unisex'].flatMap((gender) =>
    ['20s', '30s', '40s', '50s', '60plus'].map((decade) => `${gender}-${decade}`)
  ),
]);

describe('public/data/trends.json', () => {
  const manifest = loadManifest();

  it('carries a version and a real timestamp', () => {
    expect(manifest.version).toBeGreaterThanOrEqual(1);
    const parsed = Date.parse(manifest.updatedAt);
    expect(Number.isFinite(parsed)).toBe(true);
    // Guard against a placeholder date slipping in.
    expect(new Date(parsed).getUTCFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it('is not empty', () => {
    const cohorts = Object.keys(manifest.cohorts);
    const terms = cohorts.flatMap((cohort) => Object.values(manifest.cohorts[cohort]).flat());
    expect(cohorts.length).toBeGreaterThanOrEqual(2);
    expect(terms.length).toBeGreaterThanOrEqual(15);
  });

  it('uses known cohorts and categories only', () => {
    for (const [cohort, categories] of Object.entries(manifest.cohorts)) {
      expect(KNOWN_COHORTS.has(cohort), `cohort ${cohort}`).toBe(true);
      for (const [category, terms] of Object.entries(categories)) {
        expect(KNOWN_CATEGORIES.has(category), `category ${category}`).toBe(true);
        expect(terms.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps terms clean and unique within a bucket', () => {
    for (const [cohort, categories] of Object.entries(manifest.cohorts)) {
      for (const [category, terms] of Object.entries(categories)) {
        const seen = new Set<string>();
        for (const term of terms) {
          expect(term, `${cohort}/${category}`).toBe(term.trim());
          expect(term.length).toBeGreaterThanOrEqual(2); // "tv" is legitimate
          expect(term.length).toBeLessThan(60);
          const key = term.toLowerCase();
          expect(seen.has(key), `duplicate "${term}" in ${cohort}/${category}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('records provenance for every source', () => {
    expect(Array.isArray(manifest.sources)).toBe(true);
    expect(manifest.sources!.length).toBeGreaterThan(0);
    for (const source of manifest.sources!) {
      expect(typeof source.id).toBe('string');
      expect(['ok', 'failed']).toContain(source.status);
    }
    // At least one feed must have succeeded, or the manifest would be empty.
    expect(manifest.sources!.some((source) => source.status === 'ok')).toBe(true);
  });

  it('documents that cohort attribution is partly a feed prior', () => {
    expect(manifest.methodology?.attribution).toMatch(/prior|explicit/i);
  });
});
