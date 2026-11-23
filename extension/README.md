# Emporika Browser Search (Back Market · Costco)

Fetches listings from **Back Market** and **Costco** using the user's own
browser, on Emporika's behalf — no server-side browser, no proxy pool, no
headless Chrome.

All of these retailers are unreachable from a server: Back Market has no public
search API, and Costco's search endpoint is Kasada-guarded. **Target is disabled**
— see its section below. Verified details for each are below.

## Why this shape

Requests made from the extension inherit the user's real browser session: home
ISP address, Chrome's own TLS/JA3 handshake, the user's existing cookies for
that retailer, `navigator.webdriver === undefined`.

Chrome also treats a service-worker `fetch()` to a host in `host_permissions`
as same-origin, which means:

| Signal | Behaviour |
|---|---|
| CORS | bypassed entirely |
| `Origin` | **omitted** by Chrome (deliberate — it prevents sites detecting extension traffic) |
| Cookies | sent with `credentials: 'include'`, including `SameSite=Lax` |
| `Referer` | restored by the `declarativeNetRequest` rule in `background.js` |
| `Sec-Fetch-*` | **browser-protected** — cannot be set by any extension |

That last row is the only irreducible difference from a real page load, and it
is the whole detection surface. Back Market answers it fine (HTTP 200, full
server-rendered HTML); see "Why Swappa is out of scope".

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` directory
3. Reload the extension after any change — the service worker and modules are cached

## The Emporika origin

Scoped to two origins, which must agree in **both** places or the worker will
silently reject the bridge's messages:

| Origin | Purpose |
|---|---|
| `http://localhost:3000` | local development |
| `https://emporika.netlify.app` | production (Netlify) |

Declared in `manifest.json` → `content_scripts.matches`, and mirrored in
`ALLOWED_WEB_ORIGINS` in `src/background.js`.

**Deploy previews and branch deploys do not work as-is.** Netlify serves them
from different hostnames (`https://deploy-preview-123--emporika.netlify.app`,
`https://main--emporika.netlify.app`). Add each exact hostname to both lists
when you need to test one. Do not use a `https://*.netlify.app/*` wildcard: it
grants access to every Netlify site, which is a real permission expansion and a
Web Store review risk.

## Test it

Click the **Emporika** toolbar button. It opens `debug.html`, a page on the
extension origin where the provider modules run directly — host permissions
apply and CORS is bypassed, the same network path the worker uses.

| Buttons | What they do |
|---|---|
| **Back Market** / **Capture** / **Save** | runs `search()`; prints parsed products, or the exact error; capture reports which data layers the page actually has |
| **Costco** / **Capture Costco** | posts to the GRS API and prints products. Capture reports status, body size, the response **structure**, and a verdict (`ok` / `kasada-challenge (429)` / `bad-client-identifier`) |

Target is not listed because it is disabled; see its section below.

**Do not try this from the service-worker console.** Two MV3 constraints make
it impossible, and both produce misleading errors:

- `chrome.runtime.sendMessage` from the worker cannot reach itself →
  *"Could not establish connection. Receiving end does not exist."*
- `import()` is disallowed on `ServiceWorkerGlobalScope` → *"import() is
  disallowed on ServiceWorkerGlobalScope by the HTML specification."*

## Back Market is Nuxt, not Next.js

Its front office serves `/_nuxt/…` assets from
`front-office.statics.backmarket.com`. It is a **Vue/Nuxt** app, so:

- there is **no** `self.__next_f.push` RSC stream and no `__NEXT_DATA__`
- the SSR payload is `__NUXT_DATA__` (a script tag) if present

`search()` tries, in order and each failing closed: `__NUXT_DATA__` → a
whole-page JSON object scan → schema.org JSON-LD → `[]`.

Field names are alias-driven (`FIELD_ALIASES`) because they are not publicly
documented. Extend them **only** from captured evidence: a wrong alias maps a
real value to the wrong meaning, which is worse than returning nothing.

**An earlier version of this adapter assumed Next.js and parsed zero products
from an 840 kB response.** If a result set suddenly goes empty, check the
framework assumption before checking selectors.

## Target — DISABLED

**Target is disabled again (2026-11), and the extension no longer touches it.**
The live collector was built and measured: every page-context request returned
HTTP 435, including from a real user profile, so price — the only field the
catalog lacked — was never obtained. The target.com content scripts, host
permissions and harness controls have been removed, so nothing is injected into
Target's pages any more. `providers/target.js` and `target-live-{hook,relay}.js`
are kept as parked research.

For the record, when it was live: The server-side paths were
measured exhaustively and none carries price:

| Finding | Consequence |
|---|---|
| `redsky…/plp_search_v2` → 435 from Node **and** from the extension worker | No worker-based path exists |
| `/s/<term>` returns 200 but ships **no products** | Scraping the HTML is not an option |
| The PDP shell ships images/ratings but the price module is **empty** | Price hydrates through Redsky only |
| The storefront's own client chunks fetch `redsky_aggregations` from a `www.target.com` page | CORS + the PX sensor are already set up for that origin |

So `providers/target.js` is registered again, with one change from the parked
attempt: the Redsky request is issued from a real target.com page's **main
world**, where PX's sensor runs and its patched fetch mints valid tokens — the
same mechanism `page-fetch.js` provides for Costco's Kasada. Store discovery
reads `__TGT_DATA__` through the same page context.

This satisfies the challenge the way any human browsing Target does, under the
user's own session, in a page the collector acquires (their open tab when one
exists, else a minimised popup). It does not defeat PX.

The server keeps its fallbacks for when no extension is present: the
corpus/precomputed catalog (`lib/target-index.ts`). Extension listings win when
supplied — they are the only ones carrying price.

## Costco

Costco **replaced** its old Lucidworks endpoint with a GRS (Google Retail
Search) API. Both the old and new hosts refuse a server request, for different
reasons — which is why "Costco is blocked" was only half the story:

| Host | Status from Node | Cause |
|---|---|---|
| `search.costco.com/api/apps/…` (retired) | **403**, zero-byte body | Varnish edge block |
| `gdx-api.costco.com/catalog/search/api/v1/search` (current) | **429**, empty body | **Kasada** challenge (`x-kpsdk-ct`, `KP_UIDz` cookies) |

The endpoint, method, headers and body shape in `costco.js` were read from
costco.com's own `keyword_search_api_service_config` in the live page payload —
not guessed:

```
POST https://gdx-api.costco.com/catalog/search/api/v1/search
client-identifier: 168287ea-1201-45f6-9b45-5bbea49f8ee7
client_id: USBC   locale: en-US   searchResultProvider: GRS
body: { visitorId, query, pageSize, offset, orderBy, searchMode,
        personalizationEnabled, warehouseId, shipToPostal, shipToState,
        deliveryLocations[], filterBy[] }
```

Kasada wants a **JS-computed per-request token**. Echoing its challenge cookie
back to a second request does not clear the 429 — verified. The sibling
`…/search/completeQuery` GET is *unprotected* and returns live catalogue data,
so the host itself is fine; only the search POST is challenged.

That is why the request is issued from **costco.com's own page context** rather
than from the worker — see "Transport: page context" below.

### Transport: page context

Kasada's token is computed by the retailer's script inside the page, so the
request runs in the page's **main world**, where Kasada has patched
`window.fetch`. `page-fetch.js` does this with
`chrome.scripting.executeScript({ world: 'MAIN' })`.

A `world: 'ISOLATED'` injection would **not** work: an isolated world gets the
plain `fetch`, so it is challenged exactly like the worker's request.

**There is no fully headless option.** Chrome gives an extension no way to create
a `costco.com` origin without a tab:

| Context | Origin | Kasada cookies / patched fetch | Works? |
|---|---|---|---|
| Service worker | extension | cookies only, no patch | ❌ 429 (verified) |
| Offscreen document | `chrome-extension://` | cookies only, no patch | ❌ same 429 |
| Sandboxed page | extension | cookies only, no patch | ❌ same 429 |
| Content script, isolated world | page | but plain `fetch` | ❌ 429 |
| **`executeScript`, MAIN world** | page | **full page context** | ✅ the accepted path |

So "unseen" is achieved as closely as the platform allows, in this order. **Every
strategy is validated before it is accepted** — "created" is not the same as
"loaded the URL we asked for":

1. **Reuse** an open costco.com tab — nothing is created.
2. **Minimised, unfocused popup window** — never in the user's tab strip, never
   takes focus, closed as soon as the response arrives (typically 1–3 s). It can
   still flash in the OS window list, and Chrome may throttle a minimised window
   hard enough that it never commits the navigation — if it does not reach the
   page, it is closed and step 3 runs.
3. Inactive tab in the current window — briefly visible in the tab strip, but
   reliable. This is the fallback that actually works when a minimised window
   will not load.

A tab the user opened is never closed; only windows/tabs the extension created
are removed.

`status === 'complete'` is **not** a sufficient readiness signal: a new tab
reports it for its initial `about:blank` before the requested navigation
commits, and injecting there yields an opaque origin whose cross-origin `fetch`
throws. The extension waits for `complete` **at the expected origin** before
injecting, and the injected script re-checks `location.origin` and reports the
mismatch instead of burning the retry budget.

Because a redirect can replace the frame between the readiness check and the
injection (*"Frame with ID 0 was removed"*), acquisition + injection is retried
once.

Kasada's patch lands after the page's own scripts boot, so the injected fetch
legitimately sees early `429`s and **retries for up to 12 s**. Background and
minimised windows have throttled timers, hence the generous interval.

If Costco ever stops challenging, the direct worker fetch is still attempted as a
fallback, so nothing here has to be undone.

### Reading the capture

**Capture Costco** reports the transport as well as the status, because the two
failure modes need opposite responses:

| Field | Why it matters |
|---|---|
| `transport: page` + `verdict: ok` | Costco works. `topLevelKeys` / `firstProductKeys` confirm the field names |
| `pageUrl` | The page the script actually ran in. Should be a `costco.com` URL; `about:blank` means the navigation never committed |
| `verdict: kasada-challenge (429) even from the page context` | The page patch did not cover this call. Costco is out of reach without Tier B |
| `verdict: kasada-challenge (429) — page context unavailable` | `transport: worker`, i.e. injection never ran. Read `pageFailure` |
| `verdict: page context could not be used` | `status: 0` — no HTTP answer at all. `bodySample` carries the throw message (`injected into the wrong origin: …`, `fetch threw: …`) |
| `resultCount: 0` with `verdict: ok` | The envelope shape differs — read `topLevelKeys` and extend `extractResults()` |
| `parsedProductCount: 0` with `resultCount > 0` | The *field* names differ — read `firstProductKeys` and narrow the aliases in `parseResult()` |

`costco.js` deliberately probes several envelope placements (`results`, `data.results`,
`items`, `searchResult.results`, …) and rejects GRS resource paths
(`projects/…/products/…`) as titles. Narrow the aliases **only** from captured
evidence.

### The old cookie bootstrap

The previous `costco-cookie-fetcher.ts` only accepted `ak_bmsc` / `bm_sz`, which
`www.costco.com` no longer issues — it now sets `BCO`, `C_LOC`, `f_as` and
`client-zip-short`. That filter is why the fetcher always returned `null`. It now
captures every cookie and reports the names it actually received.

## Reintroducing a provider

Target and Costco are wired into the same places Back Market already was. The
full checklist is: `search/providers/availability.ts` (clear any disablement
entry), `search/browser-providers.ts` (`BROWSER_PROVIDER_IDS` plus a bucket in
`BROWSER_ONLY_PROVIDER_IDS` or `BROWSER_FIRST_PROVIDER_IDS`),
`search/providers/adapter.ts`, `search/providers/capabilities.ts`,
`extension/manifest.json` (host permissions **and** the matching Referer rule in
`background.js`), `extension/src/background.js` and `extension/src/debug.js`,
the retailer lists in `app/api/search/route.ts`, `lib/retailer.ts`,
`components/RetailerToggle.tsx`, `components/SearchFilters.tsx`, and
`lib/search-url.ts`.

`browser-first` (Target, Costco) means a server adapter still exists and is used
as a fallback and by `/api/deals` / `/api/explore`. `browser-only` (Back Market)
means there is no server adapter and the id must never be routed to one.

## Capture flow (when search returns nothing)

Use **Capture Back Market** and read it like this:

| Field | Means |
|---|---|
| `status: 403` | the site challenged the request — report it, do not retry harder |
| `finalUrl` ≠ the request URL | the keyword route redirected; `SEARCH_URL` is wrong |
| `htmlLength` tiny (< 5 kB) | you got a challenge page, not results |
| `nuxtChunks: 0` | the framework assumption may have changed again |
| `hasNuxtDataScript: false` | no Nuxt 3 payload; rely on the object scan / JSON-LD |
| `productLinks: 0` | the keyword page shows no products at all — probably the wrong route |
| `cardSamples` | raw markup around product links; this is the evidence a DOM parser needs |

## Privacy / scope

- `host_permissions` is limited to the three retailers actually used —
  `backmarket.com`, `costco.com` and `gdx-api.costco.com` — plus `target.com` and
  `redsky.target.com` for the Target collector. Never `<all_urls>`
- `scripting` is used for exactly one thing: issuing Costco's search request from
  a costco.com page's main world so Kasada's own token is applied. It targets a
  single tab the extension created (or an already-open costco.com tab) and is
  never used against other origins
- No analytics, no telemetry, no remote code. Everything runs locally. Kasada's
  script is executed by the retailer's own page, not bundled or `eval`'d here
- Requests are throttled per host (`MIN_HOST_INTERVAL_MS`, default 1.2s) so a
  single user's browsing never looks like a crawl

## Why Swappa is out of scope

Swappa sits behind a Cloudflare managed challenge (`"Just a moment..."`, 403 on
every unauthenticated request). A `fetch()` cannot execute the challenge JS, so
it can never mint `cf_clearance` — the extension's real browser and residential
IP do not help, because the block is on the *request shape*, not the client.

Making it work would require a real navigation (Tier B), which costs a visible
tab per search. Swappa also prohibits automated access in its Terms of Use and
sells the same data commercially, so the defensible route is their paid
data-services product, not an extension.

That provider was implemented and then removed. To reintroduce it, the adapter
would need to be restored **and** the pipeline re-widened in:
`search/browser-providers.ts`, `search/schemas.ts`, `search/providers/capabilities.ts`,
`types/unified.ts`, and the retailer lists in `app/page.tsx`, `app/api/search/route.ts`,
`components/RetailerToggle.tsx`, `components/SearchFilters.tsx`, `lib/retailer.ts`.
