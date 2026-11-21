#!/usr/bin/env node
/**
 * Fetch the Target catalog corpus at build time.
 *
 * The corpus is ~93MB and is rebuilt weekly. Committing it — with or without Git
 * LFS — means every refresh adds another full copy to storage and it grows
 * without bound. Instead it is published as a single GitHub release asset that
 * each run overwrites in place, and this script pulls it into `public/` during
 * the build so it is served same-origin.
 *
 * No-ops outside CI so `npm run build` on a workstation never silently downloads
 * 93MB. In CI it is best-effort: a missing asset leaves the file absent, the
 * decode check in the browser fails loudly, and Target falls back to the
 * server-side precomputed map.
 *
 * Override the source with TARGET_CORPUS_URL (e.g. object storage later).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_URL =
  'https://github.com/ghobs91/emporika/releases/download/target-corpus/target-corpus.bin';

/** Below this the download is a redirect page or an error body, not the corpus. */
const MIN_BYTES = 50_000_000;

const inCi = Boolean(process.env.CI || process.env.NETLIFY);
const target = path.resolve(process.cwd(), 'public/data/target-corpus.bin');

if (!inCi) {
  console.log('[target-corpus] not a CI build; skipping download');
  process.exit(0);
}

if (existsSync(target) && statSync(target).size >= MIN_BYTES) {
  console.log('[target-corpus] already present, skipping download');
  process.exit(0);
}

const url = process.env.TARGET_CORPUS_URL || DEFAULT_URL;
console.log(`[target-corpus] fetching ${url}`);

try {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < MIN_BYTES) {
    throw new Error(`suspiciously small response (${bytes.length} bytes)`);
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`[target-corpus] wrote ${(bytes.length / 1e6).toFixed(0)}MB`);
} catch (error) {
  // Never fail the build: the app still serves Target from the precomputed map,
  // and the browser toggle surfaces the failure to the shopper.
  console.warn(
    `[target-corpus] download failed (${error instanceof Error ? error.message : error}); ` +
      'Target will fall back to the server-side precomputed map'
  );
}
