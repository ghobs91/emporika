// ── Emporika browser-side search: MV3 service worker ──────────────────
//
// Every request made here inherits the user's real browser:
//   • the user's home ISP address (no proxy pool)
//   • Chrome's own TLS/JA3 stack
//   • the user's existing cookies for that retailer
//   • no navigator.webdriver, no CDP, no headless tells
//
// Chrome treats fetches from an extension service worker as same-origin
// for any host listed in `host_permissions`: CORS is bypassed entirely and
// the `Origin` request header is deliberately omitted. The remaining
// differences from a real page load are restored as far as the platform
// allows — see syncRefererRules().
//
// Requires: providers/*.js export `search(query, options)`.

import * as backmarket from './providers/backmarket.js';

const PROVIDERS = { backmarket };

/** Minimum gap between requests to the same host (politeness / rate signal). */
const MIN_HOST_INTERVAL_MS = 1200;
const lastHitAt = new Map();

async function throttle(host) {
  const wait = lastHitAt.get(host) + MIN_HOST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastHitAt.set(host, Date.now());
}

/**
 * `Referer` is one of the few fetch-metadata-adjacent headers Chrome still
 * lets an extension set. Restoring it removes an obvious "this request has
 * no navigation context" signal.
 *
 * `Sec-Fetch-*` headers are browser-protected and cannot be set by any
 * extension; they are the one irreducible difference from a real page load.
 */
const REFERER_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.backmarket.com/en-us/' },
      ],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      requestDomains: ['backmarket.com'],
      resourceTypes: ['xmlhttprequest'],
    },
  },
];

async function syncRefererRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: REFERER_RULES.map((r) => r.id),
      addRules: REFERER_RULES,
    });
  } catch (error) {
    // Non-fatal: search still works without Referer restoration.
    console.warn('[emporika] could not install Referer rules', error);
  }
}

chrome.runtime.onInstalled.addListener(syncRefererRules);
chrome.runtime.onStartup.addListener(syncRefererRules);

// The worker cannot use dynamic import() and cannot message itself, so the
// only practical way to exercise the provider modules directly is a page on
// the extension origin. The toolbar button opens it.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('debug.html') });
});

// ── Trust boundary ────────────────────────────────────────────────────
// The content-script bridge (src/bridge.js) is the only entry point, so a
// message is trusted only when it comes from this extension AND from an
// Emporika origin. There is no `externally_connectable` path to keep in
// sync — one bridge, one check.

const ALLOWED_WEB_ORIGINS = new Set([
  'http://localhost:3000',
  'https://emporika.netlify.app',
]);

function isTrusted(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : null);
  return origin !== null && ALLOWED_WEB_ORIGINS.has(origin);
}

// ── Search ────────────────────────────────────────────────────────────

async function searchOne(providerId, query, options) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return { providerId, error: `Unknown provider: ${providerId}` };
  }

  const started = Date.now();
  try {
    await throttle(provider.HOST);
    const products = await provider.search(query, options);
    return {
      providerId,
      query,
      products,
      partial: products.length === 0,
      warnings: products.length === 0 ? ['No listings parsed from the response'] : [],
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      providerId,
      query,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}

async function runSearch(message) {
  const query = typeof message.query === 'string' ? message.query.trim() : '';
  if (!query) return { ok: false, error: 'query is required' };

  const requested = Array.isArray(message.providers) && message.providers.length
    ? message.providers.filter((id) => id in PROVIDERS)
    : Object.keys(PROVIDERS);
  const limit = Math.min(Math.max(Number(message.limit) || 24, 1), 50);

  // Fan out concurrently: each provider is a different host, so throttling
  // is per-host and they do not contend.
  const settled = await Promise.all(
    requested.map((id) => searchOne(id, query, { limit }))
  );

  const providers = {};
  for (const item of settled) providers[item.providerId] = item;
  return { ok: true, providers };
}

// ── Message router ────────────────────────────────────────────────────

function handle(message, sender, sendResponse) {
  if (!isTrusted(sender)) {
    sendResponse({ ok: false, error: 'Untrusted sender' });
    return false;
  }

  if (message?.type === 'EMPORIKA_PING') {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version,
      providers: Object.keys(PROVIDERS),
    });
    return false;
  }

  if (message?.type === 'EMPORIKA_SEARCH') {
    runSearch(message).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: String(error) })
    );
    return true; // keep the channel open for the async reply
  }

  sendResponse({ ok: false, error: `Unsupported message type: ${message?.type}` });
  return false;
}

chrome.runtime.onMessage.addListener(handle);
