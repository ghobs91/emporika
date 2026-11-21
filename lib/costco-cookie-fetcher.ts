import { costcoCookieCache } from './costco-cookie-cache';

/**
 * Cookies that must be present for a Costco session to look real. These are
 * the names www.costco.com actually sets as of the last verification; the
 * old Akamai pair (`ak_bmsc`, `bm_sz`) is no longer issued, which is why an
 * earlier version of this file always returned `null`.
 *
 * Reported through `diagnose()` so a name change shows up as evidence
 * instead of a silent empty result.
 */
export const REQUIRED_COOKIE_NAMES = ['BCO', 'C_LOC'] as const;

const COSTCO_ORIGIN = 'https://www.costco.com';

/** A browser-shaped request. Costco's edge rejects obviously non-browser shapes. */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
} as const;

interface ParsedCookie {
  name: string;
  value: string;
  maxAgeSeconds: number;
}

function parseSetCookie(header: string): ParsedCookie | null {
  const [nameValue, ...attributes] = header.split(';');
  const separator = nameValue.indexOf('=');
  if (separator <= 0) return null;

  const name = nameValue.slice(0, separator).trim();
  const value = nameValue.slice(separator + 1).trim();
  if (!name) return null;

  let maxAgeSeconds = 7200; // 2 hours, matching Costco's own session window
  for (const attribute of attributes) {
    const [rawKey, rawValue = ''] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    // Max-Age wins over Expires; both are absolute in the response.
    if (key === 'max-age') {
      const parsed = Number.parseInt(rawValue.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) maxAgeSeconds = parsed;
    }
  }

  return { name, value, maxAgeSeconds };
}

/** Header-safe name=value join. Values are opaque; only the first pair of a header is used. */
function toCookieHeader(cookies: ParsedCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Fetch a Costco session by loading the storefront, the same way a browser
 * starts a visit. Returns `null` when the edge serves a page without setting
 * cookies — that is a signal about the block, not a bug to retry around.
 */
export async function fetchCostcoCookies(): Promise<string | null> {
  try {
    const response = await fetch(COSTCO_ORIGIN, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      cache: 'no-store',
    });

    const setCookieHeaders = response.headers.getSetCookie();
    if (setCookieHeaders.length === 0) {
      console.warn(
        `Costco returned HTTP ${response.status} without Set-Cookie — the edge is not issuing a session`
      );
      return null;
    }

    const cookies = setCookieHeaders
      .map(parseSetCookie)
      .filter((cookie): cookie is ParsedCookie => cookie !== null);

    const present = new Set(cookies.map((cookie) => cookie.name));
    const missing = REQUIRED_COOKIE_NAMES.filter((name) => !present.has(name));

    if (missing.length > 0) {
      // Cache anyway: the optional cookies still help, and a hard failure here
      // would hide the more useful "which names did we get" evidence.
      console.warn(
        `Costco session is missing required cookie(s): ${missing.join(', ')}. ` +
          `Received: ${[...present].join(', ') || '(none)'}`
      );
    }

    if (cookies.length === 0) return null;

    const cookieString = toCookieHeader(cookies);
    // Expire on the shortest-lived cookie so a stale member is never reused.
    const ttlSeconds = Math.min(...cookies.map((cookie) => cookie.maxAgeSeconds));
    costcoCookieCache.set(cookieString, ttlSeconds);

    console.log(
      `Cached Costco session (${cookies.map((c) => c.name).join(', ')}) for ${ttlSeconds}s`
    );
    return cookieString;
  } catch (error) {
    console.error('Error fetching Costco cookies:', error);
    return null;
  }
}

/**
 * Report what the storefront actually sets, without caching it. Used by
 * `/api/costco/refresh-cookie` to distinguish "no credentials" from
 * "the edge stopped issuing cookies" — two states that used to look identical.
 */
export async function diagnoseCostcoCookies(): Promise<{
  reachable: boolean;
  status: number;
  cookieNames: string[];
  requiredMissing: string[];
}> {
  try {
    const response = await fetch(COSTCO_ORIGIN, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      cache: 'no-store',
    });

    const names = response.headers
      .getSetCookie()
      .map((header) => parseSetCookie(header)?.name)
      .filter((name): name is string => Boolean(name));

    const present = new Set(names);
    return {
      reachable: true,
      status: response.status,
      cookieNames: names,
      requiredMissing: REQUIRED_COOKIE_NAMES.filter((name) => !present.has(name)),
    };
  } catch {
    return {
      reachable: false,
      status: 0,
      cookieNames: [],
      requiredMissing: [...REQUIRED_COOKIE_NAMES],
    };
  }
}
