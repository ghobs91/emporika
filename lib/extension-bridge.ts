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

/** Budget for the extension round-trip. Retailers are throttled server-side. */
const SEARCH_TIMEOUT_MS = 4000;

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
