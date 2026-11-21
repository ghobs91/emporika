// ── Target corpus loader (browser) ─────────────────────────────────────
//
// Fetches and indexes the packed corpus so the app can answer arbitrary Target
// queries locally: no server, no per-query cost, no precomputed vocabulary.
//
// VERIFICATION STATUS: the format, the decode, the index build and the query
// logic are all verified against the real 2.6M-product catalog in Node
// (`scripts/bench-target-relevance.ts --corpus`: 90% relevant@1, 96% precision@5,
// decode+index in ~440ms). This file — the fetch, the caching, and the
// main-thread cost — has NOT been exercised in a browser.
//
// Two things to settle before this goes live:
//   • Building the index blocks for ~0.5s and holds ~200MB (26M postings). Run
//     it in a Worker once the URL is served with a stable cache key; doing it on
//     the main thread will drop frames on first use.
//   • It is opt-in by design: a 53MB download should never happen because
//     someone searched for a phone case.

import { buildCorpusIndex, decodeCorpus, CORPUS_URL, type TargetCorpusIndex } from '@/lib/target-corpus';

let pending: Promise<TargetCorpusIndex> | null = null;

/**
 * Download and index the corpus once per session.
 *
 * Cached in module scope, so repeated searches reuse one index. The HTTP cache
 * does the rest: the artifact is immutable until the weekly refresh changes it.
 */
export function loadTargetCorpusIndex(): Promise<TargetCorpusIndex> {
  if (pending) return pending;

  pending = (async () => {
    const response = await fetch(CORPUS_URL, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Target corpus returned HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return buildCorpusIndex(decodeCorpus(bytes));
  })();

  // Do not cache a failure — a transient network error should not disable
  // Target for the rest of the session.
  pending.catch(() => {
    pending = null;
  });

  return pending;
}

/** Drop the cached index. Used when the artifact is refreshed. */
export function resetTargetCorpusClient(): void {
  pending = null;
}
