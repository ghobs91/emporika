// ── Emporika ↔ extension bridge (content script) ──────────────────────
//
// Injected into the Emporika web origin. A content script's own fetch() is
// subject to the page's CORS, so it must never do the network work — it
// only relays messages to the service worker, which has the host
// permissions and therefore the CORS bypass.
//
// Protocol (window.postMessage, same-origin only):
//   page   → ext  { source: 'emporika-web',       type: 'EMPORIKA_PING' }
//   ext    → page { source: 'emporika-extension', type: 'EMPORIKA_READY', version, providers }
//
//   page   → ext  { source: 'emporika-web',       type: 'EMPORIKA_SEARCH',
//                   requestId, query, providers?, limit? }
//   ext    → page { source: 'emporika-extension', type: 'EMPORIKA_RESULT',
//                   requestId, response }
//
// `EMPORIKA_READY` is re-broadcast on every page load, so the web app can
// detect availability without polling.

const PAGE_ORIGIN = window.location.origin;

const ready = (version, providers) => ({
  source: 'emporika-extension',
  type: 'EMPORIKA_READY',
  version,
  providers,
});

function announce(version, providers) {
  window.postMessage(ready(version, providers), PAGE_ORIGIN);
}
window.addEventListener('message', async (event) => {
  // Same-origin only: both the origin and the message tag must match.
  if (event.origin !== PAGE_ORIGIN) return;
  const message = event.data;
  if (!message || message.source !== 'emporika-web') return;

  if (message.type === 'EMPORIKA_PING') {
    try {
      const ping = await chrome.runtime.sendMessage({ type: 'EMPORIKA_PING' });
      if (ping?.ok) announce(ping.version, ping.providers);
    } catch {
      // Worker asleep or extension reloaded — stay silent.
    }
    return;
  }

  if (message.type === 'EMPORIKA_SEARCH') {
    if (!message.requestId) return;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'EMPORIKA_SEARCH',
        query: message.query,
        providers: message.providers,
        limit: message.limit,
      });
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    window.postMessage(
      { source: 'emporika-extension', type: 'EMPORIKA_RESULT', requestId: message.requestId, response },
      PAGE_ORIGIN
    );
  }
});

// Announce once on load so the page never has to ask first.
chrome.runtime
  .sendMessage({ type: 'EMPORIKA_PING' })
  .then((ping) => {
    if (ping?.ok) announce(ping.version, ping.providers);
  })
  .catch(() => {
    // Extension context invalidated mid-load; nothing to do.
  });
