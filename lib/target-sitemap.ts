// ── Target sitemap: the only server-reachable Target surface ────────────
//
// Network side of `lib/target-catalog.ts`. Kept separate so the parsing and
// diffing stay pure and testable; nothing here is on a request path — it is
// only used by `scripts/target-sitemap.ts`.
//
// Why this and not Redsky: `www.target.com` is *not* PerimeterX-challenged.
// Verified against live traffic — a bare request with no cookies and no PX
// token gets HTTP 200 on both the sitemap and a canonical PDP, while the
// same client gets HTTP 435 from `redsky.target.com`. The challenge is
// scoped to the aggregation API, which is the one host this module never
// touches.
//
// Freshness constraints, measured rather than assumed:
//   • Neither the index nor the shards publish <lastmod>/<changefreq>.
//   • If-None-Match and If-Modified-Since are *ignored* — a conditional GET
//     returns 200 with the full 8.6MB body, so revalidation is free of
//     savings.
//   • HEAD does return a stable weak ETag (`W/"76101cbb…"`, identical across
//     repeated requests, distinct per shard).
//
// So the supported staleness probe is: HEAD every shard, compare ETags, and
// download only what moved. That is ~110 small requests instead of ~950MB.

import { gunzipSync } from 'node:zlib';
import { mapWithConcurrency } from '@/search/concurrency';
import {
  normalizeEtag,
  parseProductUrl,
  parseSitemapIndex,
  shardName,
  type ShardProbe,
  type TargetProductRecord,
} from '@/lib/target-catalog';

export const TARGET_SITEMAP_INDEX_URL = 'https://www.target.com/sitemap_pdp-index.xml.gz';

/** Identifies the crawler honestly; Target's robots.txt has no bot allowlist. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_CONCURRENCY = 4;

function request(url: string, method: 'GET' | 'HEAD'): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'gzip' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'follow',
  });
}

/** Decompress a `.gz` payload, tolerating a server that ignores the extension. */
function gunzip(buffer: Buffer): string {
  // gzip magic: 1f 8b. Anything else is already plain XML.
  const gzipped = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  return (gzipped ? gunzipSync(buffer) : buffer).toString('utf8');
}

async function fetchXml(url: string): Promise<string> {
  const response = await request(url, 'GET');
  if (!response.ok) {
    throw new Error(`Target sitemap ${url} returned HTTP ${response.status}`);
  }
  return gunzip(Buffer.from(await response.arrayBuffer()));
}

/** Shard URLs from the published index. ~110 entries, 1 request. */
export async function fetchShardIndex(): Promise<string[]> {
  const shards = parseSitemapIndex(await fetchXml(TARGET_SITEMAP_INDEX_URL));
  if (shards.length === 0) {
    throw new Error('Target sitemap index contained no product shards');
  }
  return shards;
}

/**
 * `HEAD` one shard and capture its ETag.
 *
 * A non-200 is reported rather than thrown: a shard listed in the index that
 * no longer answers is a catalog removal, and the caller needs to see it as a
 * decision rather than an exception that aborts the whole refresh.
 */
export async function probeShard(url: string): Promise<ShardProbe> {
  const name = shardName(url);
  try {
    const response = await request(url, 'HEAD');
    return {
      url,
      name,
      ok: response.ok,
      status: response.status,
      etag: normalizeEtag(response.headers.get('etag')),
      lastModified: response.headers.get('last-modified'),
    };
  } catch {
    return {
      url,
      name,
      ok: false,
      status: 0,
      etag: null,
      lastModified: null,
    };
  }
}

/** Probe every shard. Bounded concurrency; Target is a guest here. */
export async function probeShards(
  urls: readonly string[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<ShardProbe[]> {
  return mapWithConcurrency([...urls], concurrency, (url) => probeShard(url));
}

/** Download one shard and parse its product URLs. */
export async function fetchShardProducts(url: string): Promise<TargetProductRecord[]> {
  const locs = (await fetchXml(url)).match(/<loc>\s*[^<\s]+\s*<\/loc>/g) ?? [];
  const seen = new Set<string>();
  const products: TargetProductRecord[] = [];

  for (const tag of locs) {
    const loc = tag.replace(/<\/?loc>/g, '').trim();
    const product = parseProductUrl(loc);
    // A shard is claimed to be unique per tcin, but never trust that: a
    // duplicate would double-count the catalog and skew the manifest.
    if (product && !seen.has(product.tcin)) {
      seen.add(product.tcin);
      products.push(product);
    }
  }

  return products;
}

/**
 * Download several shards, returning products keyed by shard name so the
 * caller can carry forward untouched shards row-for-row.
 */
export async function fetchShards(
  probes: readonly ShardProbe[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<Map<string, TargetProductRecord[]>> {
  const results = await mapWithConcurrency(
    [...probes],
    concurrency,
    (probe) => fetchShardProducts(probe.url)
  );
  return new Map(probes.map((probe, index) => [probe.name, results[index]]));
}
