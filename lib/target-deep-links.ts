// ── Target deep links ──────────────────────────────────────────────────
//
// Target publishes no server-reachable product data (see
// `lib/target-catalog.ts` for the evidence: Redsky is PerimeterX-guarded and
// the storefront HTML carries no price). What it does support is being *linked
// to* — so this module is how a Target result ever reaches a shopper.
//
// Pure string building, no network, no env, no `node:` imports: safe to call
// from a client component when rendering an "also at Target" affordance.
//
// Note on robots.txt: Target disallows the legacy `/*/Ntt`, `/*/Ntk`, `/*/Ntx`
// crawl params. Those are crawler directives and this module never crawls —
// it builds a URL for the shopper's own navigation, which is exactly what
// robots.txt does not govern.

/** Target product ids are numeric. Anything else is not a link we will build. */
const TCIN_RE = /^\d{1,20}$/;

/** Target caps the search term; long queries are truncated rather than 414'd. */
const MAX_QUERY_LENGTH = 200;

/**
 * Search results for a keyword query.
 *
 * `https://www.target.com/s?searchTerm=<q>` is the form the storefront itself
 * uses. Built with `URL` so encoding is correct for `&`, `+` and non-ASCII.
 */
export function targetSearchUrl(query: string): string {
  const url = new URL('https://www.target.com/s');
  url.searchParams.set('searchTerm', query.trim().slice(0, MAX_QUERY_LENGTH));
  return url.toString();
}

/**
 * Canonical product page for a known `tcin`.
 *
 * The slug is cosmetic — Target resolves the `A-<tcin>` suffix — so it is
 * optional. When present it is only used for readability, and it is stripped
 * of path/query characters so a hostile value cannot rewrite the destination.
 */
export function targetProductUrl(tcin: string, slug?: string): string | null {
  const id = tcin.trim();
  if (!TCIN_RE.test(id)) return null;

  const safeSlug = (slug ?? '')
    .trim()
    .replace(/[?#/\\]/g, '')
    .replace(/^-+|-+$/g, '');

  return safeSlug
    ? `https://www.target.com/p/${safeSlug}/-/A-${id}`
    : `https://www.target.com/p/-/A-${id}`;
}

/** Recover a `tcin` from a Target product URL, or null. */
export function targetTcinFromUrl(raw: string): string | null {
  const match = /\/A-(\d{1,20})(?:[?#]|$)/.exec(raw);
  return match ? match[1] : null;
}
