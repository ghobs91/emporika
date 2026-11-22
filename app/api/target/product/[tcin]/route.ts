import { NextRequest, NextResponse } from 'next/server';
import { parseTargetProductDetails, type TargetProductDetails } from '@/lib/target-pdp';

/**
 * Per-product Target metadata (images, title, description, rating).
 *
 * The tcin is a PATH SEGMENT, not a query parameter, on purpose: the CDN in front
 * of this app keys cache entries by path and ignored `?tcin=`, so every product
 * received whichever body was cached first (verified in production — three
 * tcins, one product). A distinct path gives each product its own cache entry,
 * which is what makes caching here correct rather than catastrophic.
 *
 * Why a server hop: the PDP shell carries this in `<meta>` tags and an embedded
 * module blob, but it does NOT carry a price — the price module ships empty and
 * is hydrated through the PerimeterX-blocked API. So this endpoint enriches the
 * four fields that exist and says nothing about the ones that do not.
 *
 * Why it is safe to call at request time: `www.target.com/p/…` is not
 * challenge-protected (only `redsky.target.com` is), `/p/` is explicitly
 * allowed by Target's robots.txt and advertised in its PDP sitemap, and this is
 * a bounded, cached, one-request-per-product fetch — not a crawl.
 */

export const runtime = 'nodejs';

/**
 * MUST stay dynamic.
 *
 * Next prerenders GET route handlers at build time by default, which froze this
 * endpoint to a single build-time response: every `?tcin=` returned the same
 * product (verified on the deployed site — eight different tcins, one body). The
 * card then showed one image across the whole grid.
 */
export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const cache = new Map<string, { details: TargetProductDetails; expiresAt: number }>();
/** Deduplicates concurrent requests for the same product. */
const inFlight = new Map<string, Promise<TargetProductDetails | null>>();

function cacheGet(tcin: string): TargetProductDetails | undefined {
  const entry = cache.get(tcin);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(tcin);
    return undefined;
  }
  return entry.details;
}

function cacheSet(tcin: string, details: TargetProductDetails): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Cheapest eviction: drop the oldest insertion. Good enough for a
    // per-product metadata cache that is also CDN-cached downstream.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(tcin, { details, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchDetails(tcin: string): Promise<TargetProductDetails | null> {
  try {
    const response = await fetch(`https://www.target.com/p/-/A-${tcin}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) return null;

    const html = await response.text();
    const details = parseTargetProductDetails(html, tcin);
    // A challenge shell parses to an empty record; do not cache it as success.
    if (details.imageUrls.length === 0 && !details.title) return null;
    return details;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tcin: string }> }
): Promise<NextResponse> {
  const { tcin: raw } = await params;
  const tcin = (raw ?? '').trim();
  if (!/^\d{1,20}$/.test(tcin)) {
    return NextResponse.json({ error: 'A numeric tcin is required' }, { status: 400 });
  }

  const cached = cacheGet(tcin);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  }

  let pending = inFlight.get(tcin);
  if (!pending) {
    pending = fetchDetails(tcin).finally(() => inFlight.delete(tcin));
    inFlight.set(tcin, pending);
  }

  const details = await pending;
  if (!details) {
    // Never 500: the caller (a result card) just renders its placeholder.
    return NextResponse.json(
      { tcin, imageUrls: [] },
      { status: 200, headers: { 'cache-control': 'public, s-maxage=300' } }
    );
  }

  cacheSet(tcin, details);
  return NextResponse.json(details, {
    headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
  });
}
