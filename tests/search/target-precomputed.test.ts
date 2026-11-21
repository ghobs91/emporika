import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPrecomputedTargetAvailable,
  lookupPrecomputedTarget,
  precomputedTargetStats,
  TARGET_PRECOMPUTED_PATH,
} from '@/lib/target-precomputed';

const ARTIFACT = resolve(process.cwd(), TARGET_PRECOMPUTED_PATH);

function loadArtifact() {
  return JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
    version: number;
    generatedAt: string;
    source: { products: number; shards: number; hitLimit: number };
    queries: Record<string, Array<[string, string]>>;
  };
}

describe('lookupPrecomputedTarget', () => {
  it('reports the artifact as available', () => {
    expect(isPrecomputedTargetAvailable()).toBe(true);
    expect(precomputedTargetStats().queryCount).toBeGreaterThan(0);
  });

  it('returns undefined for a query outside the vocabulary', () => {
    // Distinct from [] — this is a coverage gap, not an empty Target result set.
    expect(lookupPrecomputedTarget('zzzz not a curated query qqqq')).toBeUndefined();
  });

  it('returns hits for a seeded query', () => {
    const hits = lookupPrecomputedTarget('usb c cable');
    expect(hits).toBeDefined();
    expect(hits!.length).toBeGreaterThan(0);
    expect(hits![0].tcin).toMatch(/^\d+$/);
    expect(hits![0].title.length).toBeGreaterThan(0);
  });

  it('normalises punctuation and case so equivalent queries share one key', () => {
    // The whole reason normalisation is shared with the generator.
    const canonical = lookupPrecomputedTarget('usb c cable');
    expect(canonical).toBeDefined();
    for (const variant of ['USB-C cable', '  USB   C   CABLE  ', 'usb-c-cable']) {
      const hits = lookupPrecomputedTarget(variant);
      expect(hits, variant).toBeDefined();
      expect(hits![0].tcin).toBe(canonical![0].tcin);
    }
  });

  it('returns a fresh array so callers cannot mutate the shared index', () => {
    const first = lookupPrecomputedTarget('air fryer')!;
    first.pop();
    const second = lookupPrecomputedTarget('air fryer')!;
    expect(second.length).toBe(first.length + 1);
    expect(second).not.toBe(first);
  });
});

describe('data/target-precomputed.json', () => {
  // Committed by a scheduled job, like public/data/trends.json, so the file
  // itself needs a gate: a placeholder or truncated artifact would silently
  // degrade Target to "coverage gap" for every query in production.
  it('is a versioned artifact generated from a real catalog', () => {
    const artifact = loadArtifact();
    expect(artifact.version).toBe(1);
    expect(artifact.source.products).toBeGreaterThan(100_000);
    expect(artifact.source.shards).toBeGreaterThan(0);
    expect(artifact.source.hitLimit).toBeGreaterThan(0);
  });

  it('is not the placeholder left behind by a failed generation', () => {
    const artifact = loadArtifact();
    expect(new Date(artifact.generatedAt).getTime()).toBeGreaterThan(
      Date.UTC(2025, 0, 1)
    );
    expect(Object.keys(artifact.queries).length).toBeGreaterThan(100);
  });

  it('holds only well-formed hits', () => {
    const artifact = loadArtifact();
    let totalHits = 0;
    for (const [query, hits] of Object.entries(artifact.queries)) {
      expect(query).toBe(query.toLowerCase().trim());
      expect(Array.isArray(hits)).toBe(true);
      expect(hits.length).toBeLessThanOrEqual(artifact.source.hitLimit);
      for (const hit of hits) {
        expect(Array.isArray(hit)).toBe(true);
        expect(hit).toHaveLength(2);
        expect(hit[0]).toMatch(/^\d+$/);
        expect(typeof hit[1]).toBe('string');
        totalHits += 1;
      }
    }
    expect(totalHits).toBeGreaterThan(1_000);
  });

  it('stays small enough to bundle into a serverless function', () => {
    // The entire premise of Option A: a couple of MB, not hundreds.
    expect(statSync(ARTIFACT).size).toBeLessThan(20_000_000);
  });
});
