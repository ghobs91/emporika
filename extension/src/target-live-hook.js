// ── Target live capture: page-side hook ────────────────────────────────
//
// Runs in the PAGE's main world at document_start, before Target's own scripts,
// and records the `plp_search_v2` response that Target's client fetches for
// itself.
//
// Why capture instead of request: every request we originate is answered with
// an HTTP 435 PerimeterX challenge — measured from a Node process, the service
// worker, this page's main world from the homepage, and from a real user
// profile. Target's own client succeeds because the page load, the sensor and
// the session are all genuinely the user's. So we do not make the request; we
// read the one Target makes.
//
// The hook is deliberately passive: it clones the response Target already
// received and never alters, blocks, or reorders anything. If it fails, Target
// behaves exactly as it would without the extension.

(() => {
  const MARK = 'EMPORIKA_TARGET_CAPTURE';
  const MATCH = /redsky\.target\.com\/redsky_aggregations\/v1\/web\/plp_search_v2/;

  let published = false;

  function publish(url, text) {
    if (published || !text) return;
    published = true;
    try {
      window.postMessage({ __emporika: MARK, url: String(url), body: text }, window.location.origin);
    } catch {
      // postMessage only fails if the page is being torn down; nothing to do.
    }
  }

  // ── fetch ──
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const result = originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (MATCH.test(url)) {
          result
            .then((response) => {
              // clone(): reading the body must not consume Target's own copy.
              response.clone().text().then((text) => publish(url, text)).catch(() => {});
            })
            .catch(() => {});
        }
      } catch {
        // Never let the hook break Target's fetch.
      }
      return result;
    };
  }

  // ── XMLHttpRequest (the storefront also uses this for some calls) ──
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    try {
      this.__emporikaUrl = url;
    } catch {
      // Ignore: a non-configurable instance still works, just without a URL.
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    try {
      if (MATCH.test(String(this.__emporikaUrl || ''))) {
        this.addEventListener('load', () => {
          try {
            publish(this.__emporikaUrl, this.responseText);
          } catch {
            // responseText throws for non-text response types.
          }
        });
      }
    } catch {
      // As above: never break the host page.
    }
    return originalSend.apply(this, args);
  };
})();
