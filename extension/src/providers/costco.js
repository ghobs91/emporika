// ── Costco ────────────────────────────────────────────────────────────
//
// Costco replaced its Lucidworks endpoint with a **GRS** (Google Retail
// Search) API. The endpoint, method, headers and body shape below were read
// from costco.com's own `keyword_search_api_service_config` in the live page
// payload, not guessed:
//
//   endpoint   https://gdx-api.costco.com/catalog/search/api/v1/search   (POST)
//   headers    client-identifier, client_id, locale, searchResultProvider: GRS
//   body       visitorId, query, pageSize, offset, orderBy, searchMode,
//              personalizationEnabled, warehouseId, shipToPostal, shipToState,
//              deliveryLocations[], filterBy[]
//
// Why the browser: the old host (`search.costco.com`) returns **HTTP 403 with a
// zero-byte body** from Varnish. The new host answers a plain server request
// with **HTTP 429** and Kasada challenge headers (`x-kpsdk-ct`, `KP_UIDz`
// cookies) — and echoing the challenge cookie back does not clear it, because
// Kasada wants a JS-computed per-request token. Verified: the sibling
// `completeQuery` GET is unprotected and returns live catalogue data, so the
// host itself is fine; only the search POST is challenged.
//
// A real browser session solves Kasada as a side effect of having loaded
// costco.com. This module therefore relies on:
//   • `credentials: 'include'` — the user's own costco.com cookies
//   • being issued from the extension, not from Node
//
// If `capture()` reports `429`, Kasada did not accept this context either and
// Costco needs a real navigation (Tier B) rather than a fetch.

export const HOST = 'gdx-api.costco.com';

/**
 * The page the request is issued *from*. Kasada's token is computed by the
 * retailer's own script in this page's main world, so a page on this origin is
 * the only way to satisfy it (see `page-fetch.js`).
 */
export const PAGE_URL = 'https://www.costco.com/';
export const PAGE_ORIGIN_PATTERN = 'https://www.costco.com/*';

import { fetchInPageContext } from '../page-fetch.js';

const API_BASE = 'https://gdx-api.costco.com/catalog/search/api/v1/search';

/**
 * Client identity from costco.com's own service configuration. These are
 * sent by every visitor's browser, so they are not secrets — but they are
 * versioned by Costco, which is why `capture()` reports them when it fails.
 */
const CLIENT_IDENTIFIER = '168287ea-1201-45f6-9b45-5bbea49f8ee7';
/** USBC = US business centre (the standard US storefront). */
const CLIENT_ID = 'USBC';

/** Costco's own default page size for the GRS endpoint. */
const DEFAULT_PAGE_SIZE = 20;

// ── Helpers ────────────────────────────────────────────────────────────

/** Same shape Costco's own client generates: 32 uppercase hex characters. */
function visitorId() {
  let id = '';
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return id;
}

function money(amount, currency = 'USD') {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { amount: value, currency };
}

/**
 * The GRS projection normally returns `{ results: [{ product: {...} }] }`, but
 * the Costco wrapper adds its own envelope. Rather than assume one shape and
 * silently parse zero products when it shifts, probe the plausible ones and let
 * `capture()` report the structure that was actually returned.
 */
export function extractResults(json) {
  if (!json || typeof json !== 'object') return [];

  const candidates = [
    json.results,
    json.data?.results,
    json.items,
    json.data?.items,
    json.searchResult?.results,
    json.data?.searchResult?.results,
    json.products,
    json.data?.products,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/** The GRS projection wraps each hit in a `product`; some wrappers inline it. */
function productOf(result) {
  if (!result || typeof result !== 'object') return null;
  return (result.product && typeof result.product === 'object') ? result.product : result;
}

// ── Result → shared payload ────────────────────────────────────────────

/**
 * Map one GRS hit to the shared payload contract
 * (see `search/browser-providers.ts`).
 *
 * Only fields the Zod schema accepts may appear here: the payload schema is
 * `.strict()`, so an extra key rejects the whole batch.
 *
 * This is deliberately tolerant of field-name variants because the exact
 * projection was not observable from a server; `capture()` exists so the
 * aliases can be narrowed to the real names after one run.
 */
function parseResult(result) {
  const product = productOf(result);
  if (!product) return null;

  const id = product.id ?? product.productId ?? result.id ?? result.productId;
  // In GRS, `name` is a resource path (`projects/…/products/…`) and must never
  // be used as a display title. `title` is the display string.
  const title = product.title ?? product.productName ?? product.displayName;
  if (!id || !title) return null;

  const priceInfo = product.priceInfo ?? product.price ?? {};
  const price =
    money(priceInfo.price, priceInfo.currencyCode) ??
    money(priceInfo.currentPrice, priceInfo.currencyCode) ??
    money(product.salePrice, product.currencyCode);
  if (!price) return null;

  const listPrice =
    money(priceInfo.originalPrice, priceInfo.currencyCode) ??
    money(product.listPrice, product.currencyCode);

  const images = Array.isArray(product.images)
    ? product.images
    : Array.isArray(product.imageUrls)
      ? product.imageUrls
      : [];

  const brand = Array.isArray(product.brands)
    ? product.brands[0]
    : typeof product.brand === 'string'
      ? product.brand
      : undefined;

  const category = Array.isArray(product.categories) ? product.categories[0] : undefined;

  const availabilityField =
    product.availability ?? product.availabilityStatus ?? result.availability;
  const inStock =
    availabilityField === 'IN_STOCK' ||
    availabilityField === 'in_stock' ||
    Number(product.availableQuantity) > 0;

  const numericId = String(id);
  // Costco's own product URL shape is `/.product.<itemNumber>.html`. A GRS
  // `uri` is preferred when present because it is authoritative.
  const productUrl =
    typeof product.uri === 'string' && /^https?:\/\//i.test(product.uri)
      ? product.uri
      : `https://www.costco.com/.product.${numericId}.html`;

  return {
    providerProductId: numericId,
    title,
    brand: brand || undefined,
    price,
    listPrice: listPrice && listPrice.amount > price.amount ? listPrice : undefined,
    // Costco's catalogue is new-goods only.
    condition: 'new',
    productUrl,
    imageUrls: images.filter((value) => typeof value === 'string').slice(0, 3),
    rating: Number.isFinite(Number(product.rating)) ? Number(product.rating) : undefined,
    reviewCount: Number.isFinite(Number(product.reviewCount))
      ? Number(product.reviewCount)
      : undefined,
    category: category || undefined,
    availability: inStock ? 'in_stock' : 'unknown',
  };
}

/** Pure JSON → products. Exported so the parser is testable without network. */
export function parseResponse(json, { limit = DEFAULT_PAGE_SIZE } = {}) {
  const results = extractResults(json);
  const seen = new Set();
  const parsed = [];

  for (const result of results) {
    if (parsed.length >= limit) break;

    const candidate = parseResult(result);
    if (!candidate || seen.has(candidate.providerProductId)) continue;

    seen.add(candidate.providerProductId);
    parsed.push(candidate);
  }

  return parsed;
}

// ── Raw request ────────────────────────────────────────────────────────

/**
 * `raw()` is shared by search(), capture() and the debug harness so all three
 * exercise the identical network path.
 *
 * Transport order:
 *   1. page context — the user's own browser, where Kasada's patched `fetch`
 *      adds the per-request token. This is the only path expected to succeed.
 *   2. direct worker fetch — kept as a fallback so a future change on Costco's
 *      side (or a Kasada lapse) is picked up without a code change. Expected to
 *      answer 429 today.
 */
export async function raw(query, { limit = DEFAULT_PAGE_SIZE, offset = 0, postalCode, signal } = {}) {
  const body = {
    visitorId: visitorId(),
    query,
    pageSize: Math.min(Math.max(limit, 1), DEFAULT_PAGE_SIZE),
    offset: Math.max(offset, 0),
    orderBy: '',
    searchMode: '',
    personalizationEnabled: true,
    // Left to Costco's default warehouse unless the caller knows one; the GRS
    // endpoint resolves fulfilment from the visitor's own context.
    warehouseId: '',
    shipToPostal: postalCode ?? '',
    shipToState: '',
    deliveryLocations: [],
    filterBy: [],
  };

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'client-identifier': CLIENT_IDENTIFIER,
    client_id: CLIENT_ID,
    locale: 'en-US',
    searchResultProvider: 'GRS',
  };

  const viaPage = await fetchInPageContext({
    pageUrl: PAGE_URL,
    originPattern: PAGE_ORIGIN_PATTERN,
    url: API_BASE,
    body: JSON.stringify(body),
    headers,
  });

  if (viaPage && viaPage.transport === 'page') {
    let json = null;
    try {
      json = viaPage.text ? JSON.parse(viaPage.text) : null;
    } catch {
      // Keep the raw text for the diagnosis.
    }
    return {
      status: viaPage.status,
      finalUrl: viaPage.finalUrl,
      text: viaPage.text,
      json,
      transport: 'page',
    };
  }

  // Fallback. Report the page-context failure alongside the direct result so a
  // 429 here is not mistaken for "the page path was never tried".
  const pageFailure = viaPage?.blocked ? viaPage.text : undefined;

  const response = await fetch(API_BASE, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 403/429 bodies are empty or plain text; keep `text` for the diagnosis.
  }

  return {
    status: response.status,
    finalUrl: response.url,
    text,
    json,
    transport: 'worker',
    pageFailure,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

export async function search(query, { limit = DEFAULT_PAGE_SIZE, postalCode, signal } = {}) {
  const { status, json, text, transport, pageFailure } = await raw(query, { limit, postalCode, signal });

  if (status === 429) {
    // Kasada. Distinct from a credential problem and from a plain block, so it
    // must not be reported as a generic failure. Which transport produced the
    // 429 matters: `page` means the challenge beat the user's own browser too.
    throw new Error(
      transport === 'page'
        ? 'Costco returned HTTP 429 (Kasada challenge) from the page context'
        : `Costco returned HTTP 429 (Kasada challenge) via ${transport}${pageFailure ? `; page context failed: ${pageFailure}` : ''}`
    );
  }
  if (status !== 200) {
    // status 0 means the request never got an HTTP answer at all (injection
    // failed, wrong origin, or fetch threw) — the reason is in `text`.
    throw new Error(
      status === 0
        ? `Costco page-context request failed: ${text}`
        : `Costco returned HTTP ${status} via ${transport}`
    );
  }
  if (!json) {
    throw new Error('Costco returned a non-JSON body');
  }

  return parseResponse(json, { limit });
}

/**
 * Report what actually happened, including which transport ran and the response
 * *structure*, so the field aliases in `parseResult()` can be narrowed to
 * reality after one run.
 */
export async function capture(query) {
  const { status, finalUrl, text, json, transport, pageFailure } = await raw(query, { limit: 4 });

  const results = extractResults(json);
  const first = results[0];
  const firstProduct = productOf(first);

  return {
    status,
    finalUrl,
    // `page` = the accepted path; `worker` = the fallback that is expected to 429.
    transport,
    pageFailure: pageFailure ?? null,
    bytes: text.length,
    parsedAsJson: json !== null,
    topLevelKeys: json && typeof json === 'object' ? Object.keys(json) : [],
    resultCount: results.length,
    firstResultKeys: first && typeof first === 'object' ? Object.keys(first) : [],
    firstProductKeys: firstProduct && typeof firstProduct === 'object' ? Object.keys(firstProduct) : [],
    parsedProductCount: parseResponse(json, { limit: 4 }).length,
    verdict:
      status === 200 && json
        ? 'ok'
        : status === 429
          ? transport === 'page'
            ? 'kasada-challenge (429) even from the page context'
            : 'kasada-challenge (429) — page context unavailable'
          : status === 403
            ? 'forbidden'
            : status === 401
              ? 'bad-client-identifier'
              : status === 0
                ? 'page context could not be used — read pageUrl / pageFailure / bodySample'
                : 'unexpected',
    bodySample: text.slice(0, 600),
  };
}
