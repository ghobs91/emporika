// ── Target ────────────────────────────────────────────────────────────
//
// ⚠ PARKED — NOT REGISTERED. Target is disabled in
// Re-enabled 2026-11 as a Tier B collector: the fetch is issued from a real
// target.com page's MAIN world, where PerimeterX's own sensor is running and
// its patched fetch mints valid tokens. Verified paths, 2026-11:
//
//   service-worker fetch        -> 435 on every request (the parked attempt)
//   www.target.com pages        -> 200, but the HTML carries no products
//   redsky from the page        -> the storefront's own client does exactly
//                                  this, so CORS and the sensor are already
//                                  set up for it
//
// The visible cost, by design: the collector acquires a real target.com page
// (the user's own tab when one is open, else a minimised popup) and the
// request runs in the open, under the user's own session. It does not defeat
// the challenge; it satisfies it the way any human browsing Target does.
//
// Target's Redsky aggregation API answers server requests with an HTTP 435
// PerimeterX challenge (`blockScript: captcha.px-cdn.net/…`). It answers a real
// browser — with its own TLS stack, cookies and a `_px3` token minted on
// target.com — very differently, which is the entire reason this adapter
// exists instead of calling the API from Node.
//
// Two useful facts were verified against a live capture (2026-11):
//
//   1. /s/<term> ships NO products. `__NEXT_DATA__.props.pageProps` contains
//      only { statusCode, pageContentQuerySSRPreloadVars }. Scraping the HTML
//      is not an option; the products only ever arrive over Redsky.
//
//   2. The storefront's own `__TGT_DATA__` blob DOES carry the visitor's store
//      context:
//        serverLocationVariables.primaryStore.id      → "$storeId"
//        serverLocationVariables.location.zipCode     → "$zip"
//      So store-level pricing needs no configuration: it is whatever the
//      user's own target.com session already selected.
//
// The payload field names below mirror `lib/target.ts` exactly. They are not
// publicly documented, so `capture()` exists to replace guesses with evidence.

import { fetchInPageContext } from '../page-fetch.js';

export const HOST = 'redsky.target.com';

const API_BASE = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2';
const STOREFRONT = 'https://www.target.com/';

/** Public key embedded in target.com's own client bundle — not a secret. */
const PUBLIC_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';

/** Used only when the storefront payload cannot be read. Mirrors lib/target.ts. */
const FALLBACK_STORE_ID = '1264';
const FALLBACK_ZIP = '10001';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Store context is stable for a session, so it is discovered once. */
let storeContextPromise = null;

// ── Helpers ────────────────────────────────────────────────────────────

/** Same shape Target's own client generates: 32 uppercase hex characters. */
function visitorId() {
  let id = '';
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return id;
}

function money(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { amount: value, currency: 'USD' };
}

/**
 * Extract the JSON object handed to `JSON.parse("…")` inside the
 * `__TGT_DATA__` bootstrap. The blob is a JS string literal, so it must be
 * unescaped once before it can be parsed as JSON.
 */
function extractTgtData(html) {
  const marker = html.indexOf('__TGT_DATA__');
  if (marker === -1) return null;

  const parseAt = html.indexOf('JSON.parse("', marker);
  if (parseAt === -1) return null;

  const start = parseAt + 'JSON.parse("'.length;
  let escaped = false;
  let end = -1;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  try {
    // Unescape the JS string literal, then parse the JSON it contains.
    return JSON.parse(JSON.parse(`"${html.slice(start, end)}"`));
  } catch {
    return null;
  }
}

/**
 * Read the visitor's store context out of their own target.com session.
 * Never throws: an unreadable payload just falls back to documented defaults.
 */
async function discoverStore({ signal } = {}) {
  try {
    // Page-context, like the search fetch: the service worker's direct fetch
    // of the storefront was challenged when this provider was first built.
    // Same-origin from the target.com page, and `Accept` is CORS-safelisted, so
    // no preflight is triggered.
    const viaPage = await fetchInPageContext({
      pageUrl: STOREFRONT,
      url: STOREFRONT,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!viaPage || viaPage.transport !== 'page' || viaPage.status !== 200) {
      return { storeId: FALLBACK_STORE_ID, zip: FALLBACK_ZIP };
    }
    const data = extractTgtData(viaPage.text);
    const vars = data?.serverLocationVariables;

    const storeId = vars?.primaryStore?.id ?? vars?.store_id;
    const zip = vars?.location?.zipCode ?? vars?.zipCode;

    if (storeId && zip) return { storeId: String(storeId), zip: String(zip) };
  } catch {
    // Fall through to defaults.
  }
  return { storeId: FALLBACK_STORE_ID, zip: FALLBACK_ZIP };
}

function storeContext(options = {}) {
  if (options.storeId && options.zip) {
    return Promise.resolve({ storeId: String(options.storeId), zip: String(options.zip) });
  }
  storeContextPromise ??= discoverStore(options);
  return storeContextPromise;
}

// ── Raw request ────────────────────────────────────────────────────────

/**
 * `raw()` is shared by search(), capture() and the debug harness so all three
 * exercise the identical network path.
 */
export async function raw(query, { limit = 24, offset = 0, storeId, zip, signal } = {}) {
  const context = await storeContext({ storeId, zip, signal });

  const params = new URLSearchParams({
    keyword: query,
    count: String(Math.min(Math.max(limit, 1), 24)),
    offset: String(Math.max(offset, 0)),
    default_purchasability_filter: 'true',
    include_sponsored: 'false',
    include_review_summarization: 'true',
    new_search: 'true',
    page: `/s/${query}`,
    platform: 'desktop',
    pricing_store_id: context.storeId,
    store_ids: context.storeId,
    scheduled_delivery_store_id: context.storeId,
    zip: context.zip,
    visitor_id: visitorId(),
    channel: 'WEB',
    key: PUBLIC_KEY,
    spellcheck: 'true',
    include_dmc_dmr: 'true',
    useragent: USER_AGENT,
  });

  // Issued from the page's MAIN world, not the service worker: the worker's
  // fetch is challenged on every request, while the storefront's own client
  // fetches this exact URL from this exact origin in the open.
  const viaPage = await fetchInPageContext({
    pageUrl: STOREFRONT,
    url: `${API_BASE}?${params.toString()}`,
    headers: {
      // Only CORS-safelisted headers. `x-requested-with` is NOT safelisted, so
      // including it forced a preflight that redsky.target.com does not answer
      // and the request died as "Failed to fetch" before PerimeterX was ever
      // reached. Measured from a real target.com page:
      //   Accept + Accept-Language  -> 435 with a 415-byte JSON body (reachable)
      //   + x-requested-with        -> TypeError: Failed to fetch
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  let status = 0;
  let finalUrl = `${API_BASE}`;
  let text = '';
  if (viaPage && viaPage.transport === 'page') {
    status = viaPage.status;
    finalUrl = viaPage.finalUrl;
    text = viaPage.text;
  } else {
    // No page could be acquired. Report it distinctly from a challenge so the
    // caller does not tell the shopper "blocked" when it was "not attempted".
    text = viaPage?.text ?? 'page context could not be created';
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A challenge page is HTML, not JSON — handled by the caller.
  }

  return {
    status,
    finalUrl,
    text,
    json,
    storeId: context.storeId,
    zip: context.zip,
  };
}

// ── Response → shared payload ──────────────────────────────────────────

/**
 * Map one Redsky product to the shared payload contract
 * (see `search/browser-providers.ts`). Field names mirror `lib/target.ts`.
 *
 * Only fields the Zod schema accepts may appear here: the payload schema is
 * `.strict()`, so an extra key rejects the whole batch.
 */
function parseProduct(product) {
  const tcin = product?.tcin;
  const title = product?.item?.product_description?.title;
  if (!tcin || !title) return null;

  const current = product?.price?.current_retail ?? product?.price?.current_retail_min;
  const price = money(current);
  if (!price) return null;

  const regular = money(product?.price?.reg_retail);
  const image = product?.item?.enrichment?.images?.primary_image_url;

  const shippingStatus = product?.fulfillment?.shipping_options?.availability_status;

  return {
    providerProductId: `target-${tcin}`,
    title,
    brand: product?.item?.primary_brand?.name || undefined,
    price,
    // Only report a list price when it is genuinely higher than what is shown.
    listPrice: regular && regular.amount > price.amount ? regular : undefined,
    // Everything Redsky returns here is sold as new.
    condition: 'new',
    productUrl: `https://www.target.com/p/-/A-${tcin}`,
    imageUrls: image ? [image] : [],
    rating: Number(product?.ratings_and_reviews?.statistics?.rating?.average) || undefined,
    reviewCount: Number(product?.ratings_and_reviews?.statistics?.rating?.count) || undefined,
    category: product?.item?.product_classification?.product_type_name || undefined,
    availability:
      shippingStatus === 'IN_STOCK'
        ? 'in_stock'
        : shippingStatus === 'OUT_OF_STOCK'
          ? 'out_of_stock'
          : 'unknown',
  };
}

/** Pure JSON → products. Exported so the parser is testable without network. */
export function parseResponse(json, { limit = 24 } = {}) {
  const products = json?.data?.search?.products;
  if (!Array.isArray(products)) return [];

  const seen = new Set();
  const parsed = [];

  for (const product of products) {
    if (parsed.length >= limit) break;

    const candidate = parseProduct(product);
    if (!candidate || seen.has(candidate.providerProductId)) continue;

    seen.add(candidate.providerProductId);
    parsed.push(candidate);
  }

  return parsed;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function search(query, { limit = 24, storeId, zip, signal } = {}) {
  const { status, json, storeId: usedStore, zip: usedZip } = await raw(query, {
    limit,
    storeId,
    zip,
    signal,
  });

  if (status !== 200) {
    throw new Error(
      `Target returned HTTP ${status}${status === 435 ? ' (PerimeterX challenge)' : ''} for store ${usedStore}/${usedZip}`
    );
  }
  if (!json) {
    throw new Error('Target returned a non-JSON body (likely a challenge page)');
  }

  return parseResponse(json, { limit });
}

/**
 * Report what actually happened, so a block can be diagnosed from evidence
 * rather than inferred from an empty result set.
 */
/**
 * Collect live results by letting Target search for itself.
 *
 * Opens a VISIBLE tab at Target's own search URL. Target's client performs the
 * request, PerimeterX sees a genuine page load in the user's session, and
 * `target-live-hook.js` records the plp_search_v2 body. We never ask Redsky
 * ourselves — every request we originate is answered 435, measured repeatedly.
 *
 * Costs one visible tab per search, which is the honest price of this path.
 * The tab is closed as soon as the capture arrives or the timeout fires.
 */
export async function collectLive(query, { liveWaiters, timeoutMs = 25000 } = {}) {
  if (!liveWaiters) throw new Error('collectLive requires the background waiters map');

  const url = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
  const tab = await chrome.tabs.create({ url, active: true });

  try {
    const captured = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        liveWaiters.delete(tab.id);
        resolve(null);
      }, timeoutMs);
      liveWaiters.set(tab.id, { query, resolve, timer });
    });

    if (!captured) {
      return { ok: false, error: `Target did not return search results within ${timeoutMs}ms` };
    }

    let json = null;
    try {
      json = JSON.parse(captured.body);
    } catch {
      return { ok: false, error: 'Captured body was not JSON (likely a challenge page)' };
    }

    const products = parseResponse(json, { limit: 24 });
    if (products.length === 0) {
      return { ok: false, error: 'Captured a search response but parsed no products' };
    }
    return { ok: true, products, count: products.length, capturedUrl: captured.url };
  } finally {
    // Never leave a stray tab behind, even on error or timeout.
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export async function capture(query) {
  const { status, finalUrl, text, json, storeId, zip } = await raw(query);

  return {
    status,
    finalUrl,
    storeId,
    zip,
    bytes: text.length,
    parsedAsJson: json !== null,
    productCount: Array.isArray(json?.data?.search?.products)
      ? json.data.search.products.length
      : 0,
    // 435 is PerimeterX; status 0 means no response at all, which is a different
    // failure (page context failed, or a CORS preflight the host does not
    // answer) and must not be reported as a challenge.
    verdict:
      status === 200 && json
        ? 'ok'
        : status === 0
          ? 'no-response'
          : status === 435
            ? 'perimeterx-challenge'
            : status === 403
              ? 'forbidden'
              : 'unexpected',
    bodySample: text.slice(0, 600),
  };
}
