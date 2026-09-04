// ── Search result cache ─────────────────────────────────────────────────
//
// Short-TTL in-memory cache for full search responses. Keyed on the
// normalized request (query + destination + preferences + candidate plan),
// so only byte-identical logical searches hit.
//
// Only cacheable statuses are stored ('results', 'no_results') — never
// errors, clarification requests, or partial results (transient provider
// failures must not stick). Served hits are marked via metadata.cacheHit.
//
// Note: this is per-process memory. On serverless hosts each instance holds
// its own copy — still a large win for repeated searches (back-navigation,
// re-search) with zero infrastructure.

import type { SearchApiResponse, SearchRequest } from './types';

const CACHEABLE_STATUSES: ReadonlySet<SearchApiResponse['status']> = new Set([
  'results',
  'no_results',
]);

/** Deterministic JSON with sorted object keys (array order preserved). */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Cache key for a search request. The candidate plan is included in full:
 * a WebLLM plan changes ranking weights, so it must never share entries
 * with fallback-planned searches.
 */
export function buildSearchCacheKey(request: SearchRequest): string {
  return stableStringify({
    q: request.query.trim().toLowerCase().replace(/\s+/g, ' '),
    d: request.destination ?? null,
    p: request.preferences ?? {},
    c: request.candidatePlan ?? null,
  });
}

interface CacheEntry {
  response: SearchApiResponse;
  storedAt: number;
}

export class ResultCache {
  private store = new Map<string, CacheEntry>();

  constructor(
    private ttlMs: number = 5 * 60 * 1000,
    private maxEntries: number = 200
  ) {}

  get(key: string): SearchApiResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.response;
  }

  set(key: string, response: SearchApiResponse): void {
    if (!CACHEABLE_STATUSES.has(response.status)) return;
    if (this.store.has(key)) this.store.delete(key);
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
    this.store.set(key, { response, storedAt: Date.now() });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Process-wide cache used by the orchestrator. */
export const defaultSearchCache = new ResultCache(
  parseInt(process.env.SEARCH_CACHE_TTL_MS || '300000', 10),
  parseInt(process.env.SEARCH_CACHE_MAX_ENTRIES || '200', 10)
);
