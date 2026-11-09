# Emporika Browser Search (Back Market)

Fetches refurbished-electronics listings from **Back Market** using the user's
own browser, on Emporika's behalf — no server-side browser, no proxy pool, no
headless Chrome.

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
extension origin where the provider module runs directly — host permissions
apply and CORS is bypassed, the same network path the worker uses.

| Button | What it does |
|---|---|
| **Back Market** | runs `search()`; prints parsed products, or the exact error |
| **Capture Back Market** | reports which data layers the page actually has, plus markup around product links |
| **Save BM HTML** | downloads the raw response as `.txt` for offline inspection |

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

- `host_permissions` is limited to `https://www.backmarket.com/*` — not `<all_urls>`
- No analytics, no telemetry, no remote code. Everything runs locally
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
