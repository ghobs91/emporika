'use client';

// ── Client bridge to the browser extension ─────────────────────────────
//
// Back Market has no public search API and the architecture has no
// server-side browser. The extension in `extension/` fetches it in the
// user's own browser; this module drives it from the page and returns a
// validated payload to POST alongside the search request.
//
// Everything here is best-effort: a missing, disabled, or slow extension must
// never delay or fail a normal search.

import {
  BROWSER_PROVIDER_IDS,
  browserResultsSchema,
  type BrowserProviderId,
  type BrowserResults,
} from '@/search/browser-providers';

const PAGE_SOURCE = 'emporika-web';
const EXTENSION_SOURCE = 'emporika-extension';

/**
 * Budget for the extension round-trip. Three retailers are collected
 * concurrently, and Target first reads the visitor's store context from their
 * own target.com session — so this has to cover two sequential requests on that
 * provider. Retailers are throttled per host server-side.
 */
/**
 * Generous because Target does two sequential page-context operations:
 * store discovery from __TGT_DATA__, then the Redsky search. Each has to
 * acquire a target.com page and wait for its scripts. At 6s the whole provider
 * silently timed out before it could answer, so Target never contributed
 * prices. The cost is only paid when the extension is present but slow.
 */
const SEARCH_TIMEOUT_MS = 15000;

interface ExtensionReadyInfo {
  version: string;
  providers: BrowserProviderId[];
}

let readyInfo: ExtensionReadyInfo | null = null;
let listenerInstalled = false;
let pingWaiters: Array<(ok: boolean) => void> = [];
const pending = new Map<string, (value: unknown) => void>();

function installListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;

  window.addEventListener('message', (event) => {
    // Same-origin only — a cross-origin frame can never drive this.
    if (event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== EXTENSION_SOURCE) return;

    if (message.type === 'EMPORIKA_READY') {
      readyInfo = {
        version: String(message.version ?? '0'),
        providers: Array.isArray(message.providers) ? message.providers : [],
      };
      const waiters = pingWaiters;
      pingWaiters = [];
      for (const waiter of waiters) waiter(true);
      return;
    }

    if (message.type === 'EMPORIKA_RESULT' && typeof message.requestId === 'string') {
      const resolve = pending.get(message.requestId);
      if (resolve) {
        pending.delete(message.requestId);
        resolve(message.response);
      }
    }
  });
}

/**
 * Resolve true when the extension has announced itself. The content script
 * announces on every page load, so this normally returns synchronously; the
 * PING is only for a cold service worker or a missed announcement.
 */
export function ensureExtensionReady(timeoutMs = 800): Promise<boolean> {
  if (readyInfo) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(false);

  installListener();

  return new Promise((resolve) => {
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      pingWaiters = pingWaiters.filter((waiter) => waiter !== settle);
      resolve(false);
    }, timeoutMs);

    pingWaiters.push(settle);
    window.postMessage({ source: PAGE_SOURCE, type: 'EMPORIKA_PING' }, window.location.origin);
  });
}

export interface LiveTargetPrice {
  tcin: string;
  price: number;
  title?: string;
}

/**
 * Ask the extension to collect live Target prices.
 *
 * This opens a visible target.com tab and lets Target's own client run the
 * search, so it is an explicit user action, not part of a normal search. The
 * budget is generous because the page has to load, run its sensor, and finish
 * the request; that cost is the reason the path exists at all.
 */
export async function requestLiveTargetPrices(
  query: string,
  timeoutMs = 32000
): Promise<LiveTargetPrice[] | null> {
  const ready = await ensureExtensionReady();
  if (!ready) return null;

  const response = await new Promise<unknown>((resolve) => {
    installListener();

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });

    window.postMessage(
      { source: PAGE_SOURCE, type: 'EMPORIKA_LIVE_TARGET', requestId, query },
      window.location.origin
    );
  });

  const envelope = response as { ok?: boolean; products?: unknown } | null;
  if (!envelope?.ok || !Array.isArray(envelope.products)) return null;

  const prices: LiveTargetPrice[] = [];
  for (const item of envelope.products as Array<Record<string, unknown>>) {
    const id = typeof item.providerProductId === 'string' ? item.providerProductId : '';
    const tcin = /^target-(\d+)$/.exec(id)?.[1];
    const amount = (item.price as { amount?: unknown } | undefined)?.amount;
    if (!tcin || typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    prices.push({
      tcin,
      price: amount,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
    });
  }
  return prices.length > 0 ? prices : null;
}

/**
 * Ask the extension for listings. Returns null when the extension is absent,
 * slow, or returns a payload that fails validation — the caller then simply
 * searches without those two providers.
 */
export async function requestBrowserResults(options: {
  query: string;
  providers?: BrowserProviderId[];
  limit?: number;
}): Promise<BrowserResults | null> {
  const ready = await ensureExtensionReady();
  if (!ready) return null;

  const providers = options.providers?.length ? options.providers : [...BROWSER_PROVIDER_IDS];

  const response = await new Promise<unknown>((resolve) => {
    installListener();

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, SEARCH_TIMEOUT_MS);

    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });

    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: 'EMPORIKA_SEARCH',
        requestId,
        query: options.query,
        providers,
        limit: options.limit,
      },
      window.location.origin
    );
  });

  const envelope = response as { ok?: boolean; providers?: unknown } | null;
  if (!envelope?.ok || typeof envelope.providers !== 'object' || envelope.providers === null) {
    return null;
  }

  // Never post unvalidated user-machine data at the API.
  const parsed = browserResultsSchema.safeParse({ providers: envelope.providers });
  return parsed.success ? parsed.data : null;
}
