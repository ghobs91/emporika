// ── Target live capture: relay ─────────────────────────────────────────
//
// The hook runs in the page's main world, which has no `chrome.*` APIs, so it
// hands the captured body to this isolated-world content script, which forwards
// it to the service worker.
//
// Only the marker + origin this extension itself writes are accepted, so a page
// script cannot inject fabricated listings into the search pipeline.

(() => {
  const MARK = 'EMPORIKA_TARGET_CAPTURE';

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.__emporika !== MARK || typeof data.body !== 'string') return;

    try {
      chrome.runtime.sendMessage({
        type: 'EMPORIKA_TARGET_CAPTURED',
        url: String(data.url || ''),
        body: data.body,
      });
    } catch {
      // The service worker may be asleep or the extension reloading; the
      // collector times out and reports that instead.
    }
  });
})();
