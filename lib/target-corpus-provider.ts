// ── Target corpus provider (browser) ───────────────────────────────────
//
// Supplies Target results computed locally from the downloaded corpus and hands
// them to the search pipeline through the same `browserResults` channel the
// extension already uses. Ranking stays server-side — the corpus only replaces
// *retrieval*.
//
// Why this exists: the server-side precomputed map can only answer a curated
// vocabulary, which is why "samsung 65 inch tv" came back empty while the
// catalog held thousands of Samsung TVs. With this, any query works and the
// server does no retrieval work at all.
//
// Opt-in on purpose: the corpus is ~53MB gzipped. Downloading that because
// somebody searched for a phone case would be indefensible, so the flag is
// explicit and persisted.

import { loadTargetCorpusIndex } from '@/lib/target-corpus-client';
import { targetProductUrl } from '@/lib/target-deep-links';
import type { BrowserProviderPayload, BrowserResults } from '@/search/browser-providers';
import type { RetailerSource } from '@/types/unified';

const STORAGE_KEY = 'emporika.target-corpus.enabled';

/** Default hit count per query; the server caps provider results anyway. */
const DEFAULT_HITS = 24;

/** True when the shopper has opted into the local Target catalog. */
export function isTargetCorpusEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private mode / storage disabled: treat as off rather than throwing.
    return false;
  }
}

export function setTargetCorpusEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, 'true');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal: the toggle simply will not persist.
  }
}

/**
 * Query the local corpus and shape the result as a browser payload.
 *
 * Returns null when the corpus is disabled, so callers can leave the request
 * untouched. Throws when the download or decode fails — the caller decides
 * whether to fall back to the server path.
 */
export async function getTargetCorpusResult(
  query: string,
  limit: number = DEFAULT_HITS
): Promise<BrowserProviderPayload | null> {
  if (!isTargetCorpusEnabled()) return null;

  const index = await loadTargetCorpusIndex();
  const hits = index.query(query, limit);

  const products: BrowserProviderPayload['products'] = hits.map((hit) => ({
    providerProductId: `target-${hit.tcin}`,
    title: hit.title || `Target item ${hit.tcin}`,
    // Bare product URLs resolve and Target canonicalises them, so the corpus
    // does not need to carry a slug.
    productUrl: targetProductUrl(hit.tcin) ?? `https://www.target.com/p/-/A-${hit.tcin}`,
    imageUrls: [],
    condition: 'unknown' as const,
    availability: 'unknown' as const,
  }));

  return {
    providerId: 'target',
    query,
    products,
    ...(hits.length === 0
      ? { warnings: ['The local Target catalog has no match for these terms.'] }
      : {}),
  };
}

/**
 * Merge locally computed Target results into an existing `browserResults`
 * payload.
 *
 * The extension wins when it already supplied Target: its listings come from a
 * real page and can carry price and availability, which the corpus cannot.
 */
export async function withTargetCorpus(
  results: BrowserResults | null,
  query: string,
  selectedSources?: readonly RetailerSource[]
): Promise<BrowserResults | null> {
  if (!isTargetCorpusEnabled()) return results;
  if (selectedSources && !selectedSources.includes('target')) return results;
  if (results?.providers?.target) return results;

  try {
    const payload = await getTargetCorpusResult(query);
    if (!payload) return results;
    return {
      ...(results ?? { providers: {} }),
      providers: { ...(results?.providers ?? {}), target: payload },
    };
  } catch (error) {
    // Fall back to the server's precomputed map rather than failing the search.
    console.warn(
      'Target corpus unavailable; falling back to server results:',
      error instanceof Error ? error.message : error
    );
    return results;
  }
}
