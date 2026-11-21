// ── Page-context fetch ─────────────────────────────────────────────────
//
// Some retailer APIs are protected by JS-based bot detection (Kasada, PerimeterX)
// that computes a per-request token inside the *page*. A service-worker `fetch()`
// cannot produce it, so the request has to be issued from the page's own main
// world, where the retailer's patched `window.fetch` adds the headers.
//
// Chrome offers no way to create a page-origin context without a tab:
//   • service worker  → no DOM, no page JS (this is the 429 path)
//   • offscreen doc   → chrome-extension:// origin, no retailer cookies or
//                       patched fetch; it repeats the 429
//   • sandboxed page  → extension origin, same problem
//
// So the closest achievable to "headless" is a **minimised, unfocused popup
// window**: never in the user's tab strip, never focused, closed as soon as the
// response arrives. When the user already has a tab on that origin it is reused
// and nothing is created at all.

/** How long to keep retrying while the challenge is being satisfied. */
const INJECT_DEADLINE_MS = 12000;
/** How long to wait for the page to reach the *expected* URL. */
const PAGE_READY_TIMEOUT_MS = 20000;
/** Attempts at (acquire → inject). A frame can be replaced by a redirect. */
const MAX_ATTEMPTS = 2;

/** Injected function. Must be self-contained — it is serialised, not closed over. */
async function injectedFetch({ url, body, headers, deadline, expectedOrigin }) {
  // A wrong origin means we were injected before the real navigation committed
  // (a new tab reports `complete` for its initial about:blank). Fetching from an
  // opaque origin throws instead of answering, so fail with the reason instead
  // of burning the whole retry budget on a doomed request.
  if (window.location.origin !== expectedOrigin) {
    return {
      status: 0,
      text: `injected into the wrong origin: ${window.location.origin}`,
      finalUrl: url,
      wrongOrigin: true,
    };
  }

  /**
   * Retry until Kasada's bootstrap has patched `window.fetch`. The patch lands
   * after the page's own scripts run, so early attempts legitimately 429.
   * Timers in a background/minimised window are throttled, so the interval is
   * deliberately generous rather than tight.
   */
  const attempt = () =>
    new Promise((resolve) => {
      const step = async () => {
        try {
          const response = await window.fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body,
          });
          const text = await response.text();

          // 429 = challenge not yet satisfied; anything else is a real answer.
          if (response.status !== 429) {
            resolve({ status: response.status, text, finalUrl: response.url });
            return;
          }
          if (Date.now() > deadline) {
            resolve({ status: 429, text, finalUrl: response.url });
            return;
          }
        } catch (error) {
          // Keep the message: a CORS preflight rejection and a torn-down frame
          // look identical in a bare `status: 0`.
          const message = error instanceof Error ? error.message : String(error);
          if (Date.now() > deadline) {
            resolve({ status: 0, text: `fetch threw: ${message}`, finalUrl: url });
            return;
          }
        }
        setTimeout(step, 600);
      };
      step();
    });

  return attempt();
}

/**
 * Wait until the tab is fully loaded **at the expected origin**.
 *
 * `status === 'complete'` alone is not sufficient: a newly created tab reports
 * it for the initial `about:blank` before the requested navigation commits, and
 * injecting there yields an opaque origin whose fetches throw.
 *
 * Returns the final URL, or `null` on timeout.
 */
async function waitForPageReady(tabId, origin) {
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = typeof tab?.url === 'string' ? tab.url : '';
      if (tab?.status === 'complete' && url.startsWith(origin)) return url;
    } catch {
      return null; // tab closed underneath us
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * Acquire a page on `pageUrl`, preferring the cheapest option:
 *   1. reuse the user's own open tab (no UI changes at all)
 *   2. a minimised, unfocused popup window (invisible, auto-closed)
 *   3. an inactive tab in the current window (visible in the tab strip)
 *
 * Each strategy is validated before it is accepted, because "created" is not the
 * same as "loaded the URL we asked for".
 */
async function acquirePage(pageUrl) {
  const origin = new URL(pageUrl).origin;
  const pattern = `${origin}/*`;

  const existing = await chrome.tabs.query({ url: pattern });
  const reusable = existing.find((tab) => typeof tab.id === 'number');
  if (reusable) {
    const url = await waitForPageReady(reusable.id, origin);
    if (url) return { tabId: reusable.id, owned: false, url };
  }

  // Minimised popup window: not in the tab strip, no focus steal.
  try {
    const win = await chrome.windows.create({
      url: pageUrl,
      type: 'popup',
      focused: false,
      state: 'minimized',
    });
    const created = win?.tabs?.[0];
    if (created?.id !== undefined) {
      const url = await waitForPageReady(created.id, origin);
      if (url) return { tabId: created.id, owned: true, windowId: win.id, url };
      // The window did not reach the page (minimised windows can be throttled
      // into never committing). Close it and fall back.
      await chrome.windows.remove(win.id).catch(() => {});
    }
  } catch {
    // Window creation refused (policy, platform) — fall through.
  }

  // Inactive tab in the current window. Briefly visible, but reliable.
  try {
    const created = await chrome.tabs.create({ url: pageUrl, active: false });
    const url = await waitForPageReady(created.id, origin);
    if (url) return { tabId: created.id, owned: true, url };
    await chrome.tabs.remove(created.id).catch(() => {});
  } catch {
    // Nothing else to try.
  }

  return null;
}

async function releasePage(page) {
  if (!page.owned) return; // never close a tab the user opened
  try {
    if (page.windowId !== undefined) {
      await chrome.windows.remove(page.windowId);
    } else {
      await chrome.tabs.remove(page.tabId);
    }
  } catch {
    // Already gone — nothing to do.
  }
}

/**
 * Issue a request from `pageUrl`'s main world.
 *
 * Never throws: any failure is returned as a `status: 0` result carrying the
 * reason, so callers can fall back and report honestly.
 */
export async function fetchInPageContext({ pageUrl, url, body, headers }) {
  const expectedOrigin = new URL(pageUrl).origin;
  let lastError = 'page context could not be created';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const page = await acquirePage(pageUrl);
    if (!page) break;

    try {
      const deadline = Date.now() + INJECT_DEADLINE_MS;
      const results = await chrome.scripting.executeScript({
        target: { tabId: page.tabId },
        // MAIN is required: an isolated-world fetch is NOT the retailer's
        // patched fetch, and would be challenged exactly like the worker's.
        world: 'MAIN',
        func: injectedFetch,
        args: [{ url, body, headers, deadline, expectedOrigin }],
      });

      const result = results?.[0]?.result;
      if (result && !result.wrongOrigin) {
        return { ...result, transport: 'page', pageUrl: page.url };
      }
      if (result?.wrongOrigin) {
        // The navigation committed elsewhere; a fresh acquisition may land better.
        lastError = result.text;
      } else {
        lastError = 'injected script returned no result';
      }
    } catch (error) {
      // "Frame with ID 0 was removed" and friends: the frame was replaced by a
      // navigation between our readiness check and the injection.
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      await releasePage(page);
    }
  }

  return {
    status: 0,
    text: lastError,
    finalUrl: url,
    transport: 'page-error',
    blocked: true,
  };
}
