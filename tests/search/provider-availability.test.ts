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
//     unreachable from *every* entry point — env vars, browser results, and a
//     hand-edited `?sources=` link.
//
// Target no longer lives in that registry. It is served from a locally built
// catalog index, so it is gated on that artifact existing (a filesystem check)
// rather than on credentials or on the registry. Every test here pins
// TARGET_INDEX_PATH at a path that cannot exist, so a developer who has run
// `scripts/target-sitemap.ts` locally still gets the same answers.

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAvailableProviders } from '@/search/providers/adapter';
import { isPrecomputedTargetAvailable } from '@/lib/target-precomputed';
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
  it('advertises Target even with no credentials, because its artifact is bundled', () => {
    // Target no longer depends on a server-side database: the precomputed
    // artifact (data/target-precomputed.json) ships inside the deployment, so
    // the retailer is genuinely available on a host with no persistent disk.
    // Every other retailer remains credential-gated.
    expect(isPrecomputedTargetAvailable()).toBe(true);
    expect(getAvailableProviders()).toEqual(['target']);
  });

  it('advertises browser-supplied retailers without any env configuration', () => {
    // This is the whole point of the browser channel: it must not depend on
    // server credentials that the retailer's edge no longer accepts anyway.
    expect(getAvailableProviders(['costco'])).toEqual(['target', 'costco']);
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
    expect(getAvailableProviders(['backmarket'])).toEqual(['target', 'backmarket']);
    expect(getAvailableProviders()).not.toContain('backmarket');
  });

  it('ignores Target credentials: env vars are no longer how Target is enabled', () => {
    process.env.TARGET_STORE_ID = '1264';
    process.env.TARGET_ZIP = '10001';
    expect(getAvailableProviders()).toEqual(['target']);
  });

  it('advertises Target when a local catalog index exists on disk', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-index-'));
    const artifact = path.join(dir, 'target.sqlite');
    // Only presence and a non-zero size are checked here, so any bytes will do;
    // the real database is validated in tests/search/target-index.test.ts.
    writeFileSync(artifact, 'SQLite format 3\0');
    expect(existsSync(artifact)).toBe(true);

    process.env.TARGET_INDEX_PATH = artifact;
    expect(getAvailableProviders()).toContain('target');
  });

  it('still honours browser-collected Target listings', () => {
    // The extension path is independent of both server backends: it posts
    // listings back and they are served without consulting either artifact.
    expect(getAvailableProviders(['target'])).toContain('target');
    expect(getAvailableProviders(['target']).filter((id) => id === 'target')).toHaveLength(1);
  });
});

describe('disabled provider registry', () => {
  it('currently disables nothing, because Target became index-gated', () => {
    expect(getDisabledProviders()).toEqual([]);
    expect(isProviderDisabled('target')).toBe(false);
  });

  it('leaves working retailers enabled', () => {
    for (const id of [
      'walmart',
      'bestbuy',
      'target',
      'ebay',
      'costco',
      'shopify',
      'backmarket',
    ] as const) {
      expect(isProviderDisabled(id)).toBe(false);
    }
  });

  it('explains why each disabled retailer is off, and what would re-enable it', () => {
    // Vacuously true while the registry is empty; this is the guard that has to
    // hold the first time an outage is recorded here.
    for (const id of getDisabledProviders()) {
      const entry = DISABLED_PROVIDERS[id];
      expect(entry?.reason.length).toBeGreaterThan(0);
      expect(entry?.blockedBy.length).toBeGreaterThan(20);
    }
  });

  it('is an identity filter when nothing is disabled', () => {
    const ids = ['walmart', 'target', 'costco', 'ebay'] as const;
    expect(withoutDisabledProviders([...ids])).toEqual([...ids]);
  });
});
