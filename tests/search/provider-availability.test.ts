// ── Provider availability gating ───────────────────────────────────────
//
// Two separate concerns share this file:
//
//  1. Regression tests for the bug where Target and Costco were silently
//     dropped before any network call: `getAvailableProviders()` gated them on
//     env vars that were not set, so the retailers vanished from every result
//     set with no explanation.
//
//  2. The deliberate disablement registry. A disabled retailer must be
//     unreachable from *every* entry point — env vars, a local catalog
//     artifact, browser results, and a hand-edited `?sources=` link — and
//     re-enabling must not require touching the orchestrator.
//
// Target is disabled again (2026-11) and this time permanently: every route to
// its price returned an HTTP 435 PerimeterX challenge, including from a page's
// main world in a real user profile. The registry entry is the whole switch.
//
// Every test here pins TARGET_INDEX_PATH at a path that cannot exist, so a
// developer who has run the catalog scripts locally still gets the same answers.

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAvailableProviders } from '@/search/providers/adapter';
import {
  DISABLED_PROVIDERS,
  getDisabledProviders,
  isProviderDisabled,
  withoutDisabledProviders,
} from '@/search/providers/availability';

const KEYS = [
  'WALMART_CONSUMER_ID',
  'WALMART_PRIVATE_KEY_BASE64',
  'BESTBUY_API_KEY',
  'TARGET_STORE_ID',
  'TARGET_ZIP',
  'TARGET_INDEX_PATH',
  'EBAY_CLIENT_ID',
  'EBAY_CLIENT_SECRET',
  'COSTCO_COOKIES',
  'SHOPIFY_AGENT_PROFILE',
  'SHOPIFY_CLIENT_ID',
] as const;

/** Somewhere the Target index definitely is not. */
const missingIndex = () => path.join(tmpdir(), 'emporika-no-such-target-index.json');

beforeEach(() => {
  process.env.TARGET_INDEX_PATH = missingIndex();
});

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('getAvailableProviders', () => {
  it('advertises nothing when no credentials and no browser results exist', () => {
    expect(getAvailableProviders()).toEqual([]);
  });

  it('advertises browser-supplied retailers without any env configuration', () => {
    // This is the whole point of the browser channel: it must not depend on
    // server credentials that the retailer's edge no longer accepts anyway.
    expect(getAvailableProviders(['costco'])).toEqual(['costco']);
  });

  it('still advertises the server fallback path when its env is configured', () => {
    process.env.COSTCO_COOKIES = 'BCO=opaque';
    expect(getAvailableProviders()).toContain('costco');
  });

  it('does not duplicate a retailer supplied by both paths', () => {
    process.env.COSTCO_COOKIES = 'BCO=opaque';
    const available = getAvailableProviders(['costco']);
    expect(available.filter((id) => id === 'costco')).toHaveLength(1);
  });

  it('keeps browser-only retailers out of the server path', () => {
    // Back Market has no server adapter; supplying it must not require env, and
    // creating env for it must not invent a server provider.
    expect(getAvailableProviders(['backmarket'])).toEqual(['backmarket']);
    expect(getAvailableProviders()).not.toContain('backmarket');
  });

  it('never advertises Target, whatever the inputs', () => {
    process.env.TARGET_STORE_ID = '1264';
    process.env.TARGET_ZIP = '10001';
    expect(getAvailableProviders()).not.toContain('target');
    expect(getAvailableProviders(['target'])).not.toContain('target');
  });

  it('never advertises Target even when a catalog artifact exists on disk', () => {
    // The catalog pipeline still works and is still tested; a built artifact
    // must not resurrect a retailer that has no price to offer.
    const dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-index-'));
    const artifact = path.join(dir, 'target.sqlite');
    writeFileSync(artifact, 'SQLite format 3\0');
    expect(existsSync(artifact)).toBe(true);

    process.env.TARGET_INDEX_PATH = artifact;
    expect(getAvailableProviders()).not.toContain('target');
    expect(getAvailableProviders(['target'])).not.toContain('target');
  });
});

describe('disabled provider registry', () => {
  it('reports Target as disabled', () => {
    expect(isProviderDisabled('target')).toBe(true);
    expect(getDisabledProviders()).toContain('target');
  });

  it('leaves working retailers enabled', () => {
    for (const id of ['walmart', 'bestbuy', 'ebay', 'costco', 'shopify', 'backmarket'] as const) {
      expect(isProviderDisabled(id)).toBe(false);
    }
  });

  it('explains why each retailer is off, and what would re-enable it', () => {
    for (const id of getDisabledProviders()) {
      const entry = DISABLED_PROVIDERS[id];
      expect(entry?.reason.length).toBeGreaterThan(0);
      // The engineering note is what stops someone "fixing" a disabled provider
      // by re-enabling it without addressing the block.
      expect(entry?.blockedBy.length).toBeGreaterThan(20);
    }
  });

  it('records the evidence for Target, not just "it does not work"', () => {
    const blockedBy = DISABLED_PROVIDERS.target?.blockedBy ?? '';
    expect(blockedBy).toMatch(/435/);
    expect(blockedBy).toMatch(/PerimeterX/);
  });

  it('filters a list without reordering it', () => {
    expect(
      withoutDisabledProviders(['walmart', 'target', 'costco', 'target', 'ebay'])
    ).toEqual(['walmart', 'costco', 'ebay']);
  });

  it('is a no-op when nothing in the list is disabled', () => {
    expect(withoutDisabledProviders(['walmart', 'ebay'])).toEqual(['walmart', 'ebay']);
  });
});
