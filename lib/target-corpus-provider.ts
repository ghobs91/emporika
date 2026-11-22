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

/**
 * Whether this device can hold the index at all.
 *
 * The corpus is ~98MB on the wire, and indexing it needs roughly 250MB resident
 * (the buffer, a 26M-entry postings array, and 396k vocabulary strings). iOS
 * Safari's per-tab budget is below that: the process is killed, Safari reloads,
 * the persisted flag re-triggers the download, and the result is an endless
 * crash/reload loop — observed on a phone.
 *
 * So this is a desktop feature. Narrow viewports and low-memory devices are
 * excluded, and the toggle is not rendered for them at all.
 */
export function isTargetCorpusSupported(): boolean {
  if (typeof window === 'undefined') return false;

  // Layout is the reliable signal: the index is offered in the desktop results
  // header, and every phone viewport is below this breakpoint.
  const narrow =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 1023px)').matches;
  if (narrow) return false;

  // Chrome-only hint; Firefox/Safari omit it, so absence is not disqualifying.
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number' && memory > 0 && memory < 4) return false;

  return true;
}

/** Default hit count per query; the server caps provider results anyway. */
const DEFAULT_HITS = 24;

/**
 * How many results to enrich with images/ratings per search.
 *
 * Each enrichment is one request to our own `/api/target/product`, which is
 * CDN- and process-cached per tcin. Eight left most of a full grid on
 * placeholders, so this covers a whole page; the cost is paid once per product
 * ever, not once per search.
 */
const ENRICH_LIMIT = 24;
const ENRICH_CONCURRENCY = 8;

/** True when the shopper has opted into the local Target catalog. */
export function isTargetCorpusEnabled(): boolean {
  // Unsupported devices must never see this as "on", or a reload would restart
  // the download that crashed the tab in the first place.
  if (!isTargetCorpusSupported()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private mode / storage disabled: treat as off rather than throwing.
    return false;
  }
}

export function setTargetCorpusEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled && !isTargetCorpusSupported()) return;
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

  await enrichProducts(products);

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
 * Fill in images, real titles and ratings from the PDP.
 *
 * The corpus only has what the sitemap publishes (a slug-derived title), so
 * cards would otherwise show placeholders. Price is absent from the PDP shell
 * entirely — the module ships empty and hydrates through the blocked API — so it
 * is never faked here.
 *
 * Best-effort by design: a failed lookup leaves the generated title and the
 * placeholder. Skipped outside a browser so tests and SSR do no network I/O.
 */
async function enrichProducts(
  products: BrowserProviderPayload['products']
): Promise<void> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const targets = products.slice(0, ENRICH_LIMIT);
  if (targets.length === 0) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const item = targets[cursor++];
      const tcin = item.providerProductId.replace(/^target-/, '');
      try {
        const response = await window.fetch(
          `/api/target/product?tcin=${encodeURIComponent(tcin)}`
        );
        if (!response.ok) continue;
        const details = (await response.json()) as {
          title?: string;
          imageUrls?: string[];
          rating?: number;
          reviewCount?: number;
        };
        if (details.title) item.title = details.title;
        if (details.imageUrls?.length) item.imageUrls = details.imageUrls;
        if (typeof details.rating === 'number') item.rating = details.rating;
        if (typeof details.reviewCount === 'number') item.reviewCount = details.reviewCount;
      } catch {
        // Placeholder is the correct fallback; never fail a search over it.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, worker)
  );
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
    // A failed load must not survive to the next reload, or every reload repeats
    // it. Clearing the flag makes the failure terminal instead of a loop.
    setTargetCorpusEnabled(false);
    // Fall back to the server's precomputed map rather than failing the search.
    console.warn(
      'Target corpus unavailable; falling back to server results:',
      error instanceof Error ? error.message : error
    );
    return results;
  }
}
