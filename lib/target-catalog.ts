// ── Target catalog: sitemap parsing + change detection ─────────────────
//
// Target is NOT searchable server-side (see `search/providers/availability.ts`):
// `redsky.target.com` answers every non-navigation request with an HTTP 435
// PerimeterX challenge, and the storefront HTML is a bare Next.js shell on
// every URL form — a canonical PDP returns 200 but carries no
// `current_retail`, `formatted_current_price`, `availability_status` or
// JSON-LD `Product`. Price and availability exist only behind Redsky.
//
// What Target *does* publish for crawlers is its product catalog: robots.txt
// advertises `sitemap_pdp-index.xml.gz`, which fans out to ~110 shards of
// ~23k product URLs each (~2.5M total). So the supported shape is an offline
// catalog index built from those sitemaps, searched locally — the storefront
// is then only ever touched by the shopper's own click on a deep link.
//
// Everything in this module is pure: no network, no zlib, no env. The fetch
// side lives in `lib/target-sitemap.ts` so the parsing and diffing logic
// below can be tested without a live retailer, per the repo's test policy.

/** One product recovered from a sitemap URL. Keyed on `tcin`. */
export interface TargetProductRecord {
  /** Target's product id, from the `A-<tcin>` suffix. Stable across renames. */
  tcin: string;
  /** URL slug as published, decoded. Empty for bare `/p/-/A-<tcin>` URLs. */
  slug: string;
  /** Slug humanised for display/matching. Lossy, never authoritative. */
  title: string;
  /** Canonical absolute URL, as published in the sitemap. */
  url: string;
}

/** What a `HEAD` on one shard told us. `ok` is false for 404/5xx. */
export interface ShardProbe {
  /** Absolute shard URL. */
  url: string;
  /** File name, e.g. `sitemap_00-0001.xml.gz` — the manifest key. */
  name: string;
  ok: boolean;
  status: number;
  /** Weak ETag, e.g. `W/"76101cbb..."`. The change-detection signal. */
  etag: string | null;
  lastModified: string | null;
}

/** Per-shard row carried between runs so unchanged shards are never refetched. */
export interface ShardManifestEntry {
  name: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
  productCount: number;
}

/** A manifest entry plus whether we actually hold that shard's rows. */
export type ShardManifestState = ShardManifestEntry & { fetched: boolean };

/** Result of comparing stored manifest against today's probed shard set. */
export interface ShardDelta {
  /** Shards present now that the manifest has never seen. */
  added: ShardProbe[];
  /** Manifest shards whose ETag moved. */
  changed: ShardProbe[];
  /** Manifest shards byte-identical by ETag — carry their rows forward. */
  unchanged: ShardProbe[];
  /** Manifest shards absent from the index now, or answering 404. Drop them. */
  removed: string[];
}

const PRODUCT_URL_RE = /^https?:\/\/www\.target\.com\/p\/(.*?)\/?-\/A-(\d+)(?:[?#].*)?$/;

/**
 * Parse a Target product URL into its stable identity.
 *
 * Accepts both published shapes:
 *   /p/campus-lab-…-hoodie/-/A-1000000076   (slugged, canonical)
 *   /p/-/A-86376363                         (bare, still valid)
 *
 * Anything else — category pages, `/s/` search, image URLs from the
 * `image:` sitemap namespace — returns null and is dropped by the caller.
 */
export function parseProductUrl(raw: string): TargetProductRecord | null {
  const match = PRODUCT_URL_RE.exec(raw.trim());
  if (!match) return null;

  const [, rawSlug = '', tcin] = match;
  let slug = rawSlug;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    // A malformed escape is not worth losing the product over; keep it raw.
  }

  return {
    tcin,
    slug,
    title: humanizeSlug(slug),
    // Built from the *raw* slug so percent-encoding round-trips: the decoded
    // form is for matching and display, never for a URL.
    url: `https://www.target.com/p/${rawSlug ? `${rawSlug}/` : ''}-/A-${tcin}`,
  };
}

/** `campus-lab-…-hoodie` → `campus lab … hoodie`. Case is preserved verbatim. */
export function humanizeSlug(slug: string): string {
  return slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pull every `<loc>` from a `<urlset>` shard.
 *
 * Matches bare `<loc>` only: the shards also declare `image:`/`video:`
 * namespaces, and `<image:loc>` must not be mistaken for a page URL. Callers
 * still run `parseProductUrl` over the result, which is the real filter.
 */
export function parseShardLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) out.push(match[1]);
  return out;
}

/** Pull the shard URLs out of the `<sitemapindex>`. */
export function parseSitemapIndex(xml: string): string[] {
  return parseShardLocs(xml).filter((loc) => loc.includes('/pdp/'));
}

/** `https://www.target.com/pdp/sitemap_00-0001.xml.gz` → `sitemap_00-0001.xml.gz`. */
export function shardName(url: string): string {
  const path = url.split('?')[0];
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Normalise an ETag to its opaque value, dropping the weak-validator prefix.
 *
 * Node's `fetch` returns `"76101cbb…"` while curl returns `W/"76101cbb…"` for
 * the identical response, so a raw value is client-dependent: a manifest
 * written by one tool would look "changed" to another. Only the opaque value
 * matters for change detection, so it is all we store.
 */
export function normalizeEtag(etag: string | null): string | null {
  if (etag === null) return null;
  const value = etag.trim().replace(/^W\//i, '');
  return value === '' ? null : value;
}

/**
 * Diff today's probe against the stored manifest.
 *
 * Target publishes no `<lastmod>`, `<changefreq>` or `<priority>` in either
 * the index or the shards, and it advertises `ETag`/`Last-Modified` but
 * ignores `If-None-Match`/`If-Modified-Since` — a conditional GET returns the
 * full body. `HEAD` does expose a stable ETag, so ETag equality is the only
 * cheap "did this shard change" signal available.
 */
export function diffShards(
  manifest: Readonly<Record<string, ShardManifestEntry>>,
  probes: readonly ShardProbe[]
): ShardDelta {
  const delta: ShardDelta = { added: [], changed: [], unchanged: [], removed: [] };
  const reachable = new Set<string>();

  for (const probe of probes) {
    if (!probe.ok) continue;
    reachable.add(probe.name);

    const known = manifest[probe.name];
    if (!known) {
      delta.added.push(probe);
    } else if (
      // No ETag on either side means we cannot prove equality, so refetch.
      probe.etag === null ||
      known.etag === null ||
      probe.etag !== known.etag
    ) {
      delta.changed.push(probe);
    } else {
      delta.unchanged.push(probe);
    }
  }

  // A manifest shard with no reachable HEAD is gone, whether the index dropped
  // it or the shard itself now 404s. Keying off `reachable` rather than "absent
  // from probes" keeps the two cases from both reporting the same name.
  for (const name of Object.keys(manifest)) {
    if (!reachable.has(name)) delta.removed.push(name);
  }

  return delta;
}

/** Shards that must actually be downloaded this run. */
export function shardsToFetch(delta: ShardDelta): ShardProbe[] {
  return [...delta.added, ...delta.changed];
}

/**
 * Build the manifest to persist after a run.
 *
 * The subtlety this exists for: a shard can be observed to have a *new* ETag
 * while its rows are still the ones we downloaded under the *old* ETag (we ran
 * out of download budget, or chose `--max-shards 0`). Recording the observed
 * ETag there would mark stale rows as current, and the next run would classify
 * the shard `unchanged` and never refresh it — silent, permanent staleness. So
 * the stored ETag always describes the content we actually hold:
 *
 *   downloaded this run      → the freshly observed ETag
 *   not downloaded, have rows → the previous ETag, so the diff keeps firing
 *   not downloaded, no rows   → the observed ETag, with `fetched: false`
 */
export function reconcileManifest(
  previous: Readonly<Record<string, ShardManifestState>>,
  probes: readonly ShardProbe[],
  downloaded: ReadonlySet<string>,
  productCounts: ReadonlyMap<string, number>
): Record<string, ShardManifestState> {
  const next: Record<string, ShardManifestState> = {};

  for (const probe of probes) {
    if (!probe.ok) continue; // an unreachable shard is dropped, not carried

    const prior = previous[probe.name];
    const productCount = productCounts.get(probe.name);
    const holdsRows = productCount !== undefined;

    if (downloaded.has(probe.name)) {
      next[probe.name] = {
        name: probe.name,
        url: probe.url,
        etag: probe.etag,
        lastModified: probe.lastModified,
        productCount: productCount ?? 0,
        fetched: true,
      };
      continue;
    }

    // Rows we hold predate the ETag we just observed: keep the old one so the
    // next run still sees a difference and refetches.
    const staleRows = holdsRows && prior !== undefined;
    next[probe.name] = {
      name: probe.name,
      url: probe.url,
      etag: staleRows ? prior.etag : probe.etag,
      lastModified: staleRows ? prior.lastModified : probe.lastModified,
      productCount: productCount ?? 0,
      fetched: holdsRows,
    };
  }

  return next;
}

/** Number of products per shard, for manifest bookkeeping. */
export function countProducts(xml: string): number {
  let count = 0;
  for (const loc of parseShardLocs(xml)) {
    if (parseProductUrl(loc)) count++;
  }
  return count;
}
