# Shopify Integration (Global Catalog + Cart/Checkout MCP)

This document describes the integration of Shopify's Universal Commerce Protocol (UCP) MCP servers into Emporika: the Global Catalog for discovery, plus Cart MCP and Checkout MCP for agentic cart and checkout handoff.

## Overview

Emporika now searches across 6 major retailers including:
- Walmart
- Best Buy
- Target
- eBay
- Costco
- **Shopify (Global Catalog MCP + Cart/Checkout MCP)**

## Architecture

```
User query → /api/search
  ├─ Walmart API
  ├─ Best Buy API
  ├─ Target API
  ├─ eBay API
  ├─ Costco API
  └─ Shopify Global Catalog MCP  ← search_catalog tool
       │
       │  Each request includes meta.ucp-agent.profile →
       │  Shopify test fixture (dev) or emporika.netlify.app (prod)
       │
       └→ convertShopifyToUnified() → interleaved with other results

Add to cart / checkout → /api/shopify/cart → /api/shopify/checkout
  ├─ Cart MCP ({shop}/api/ucp/mcp)     create_cart / get_cart / update_cart / cancel_cart
  └─ Checkout MCP ({shop}/api/ucp/mcp) create_checkout(cart_id) → continue_url handoff
       ├─ ECP available → embedded checkout iframe (ec_version / ec_delegate)
       └─ otherwise     → buyer completes payment on the merchant storefront
```


## UCP Agent Profile

### How negotiation works

1. Every MCP request includes `meta.ucp-agent.profile` pointing to a profile URL.
2. Shopify fetches the profile, validates it, and intersects its capabilities with Emporika's declared set.
3. The response includes `ucp.capabilities` showing the negotiated set.

### Default profile (development)

By default, the integration uses Shopify's own 2026-08-25 test fixture — no setup required:

```
https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json
```

This is the recommended default from [Shopify's profiles docs](https://shopify.dev/docs/agents/profiles). It works out of the box on `localhost`.

### Production profile (self-hosted)

For production, set `SHOPIFY_AGENT_PROFILE` in `.env.local` (or Netlify env vars):

```env
SHOPIFY_AGENT_PROFILE=https://emporika.netlify.app/ucp-agent-profile.json
```

The profile source of truth is `lib/ucp/profile.ts`, served at both `/ucp-agent-profile.json` (static copy in `public/`) and `/.well-known/ucp` (discovery route). It declares only what Emporika implements — catalog search/lookup, Cart MCP, and Checkout MCP (build + handoff) — and omits native payment completion, fulfillment selection, discount codes, buyer consent, and orders until those are implemented:

| Capability | Purpose |
|---|---|
| `dev.ucp.shopping.catalog.search` | Search products across all Shopify merchants |
| `dev.ucp.shopping.catalog.lookup` | Resolve product/variant IDs |
| `dev.ucp.shopping.cart` | Cart management (`create/get/update/cancel_cart`, handoff via `continue_url`) |
| `dev.ucp.shopping.checkout` | Checkout sessions (`create/get/update/cancel_checkout`, `create_checkout(cart_id)` → `continue_url` handoff) |
| `dev.shopify.catalog` | Shopify storefront catalog extension |
| `dev.shopify.catalog.global` | Shopify global catalog extension |

Once deployed to Netlify, Shopify caches the profile (`Cache-Control: public, max-age=3600, s-maxage=86400`).

## Endpoint & Protocol

- **Endpoint**: `https://catalog.shopify.com/api/ucp/mcp` (Global Catalog); `https://{shop-domain}/api/ucp/mcp` (Cart/Checkout MCP)
- **Protocol**: JSON-RPC 2.0 over HTTP POST
- **UCP version**: `2026-08-25`
- **Global Catalog tools**: `search_catalog`, `lookup_catalog`, `get_product`
- **Cart MCP tools**: `create_cart`, `get_cart`, `update_cart`, `cancel_cart` (unauthenticated)
- **Checkout MCP tools**: `create_checkout`, `get_checkout`, `update_checkout`, `cancel_checkout` (build + handoff; `complete_checkout` requires a purchase-permitted token and is intentionally not exposed)

## API Credentials

The Shopify Global Catalog identifies agents via the UCP agent profile (required) and optionally authenticates via OAuth client credentials for elevated rate limits.

### Configuration

```env
# Override the agent profile URL (default: Shopify test fixture)
SHOPIFY_AGENT_PROFILE=https://emporika.netlify.app/ucp-agent-profile.json

# Optional: OAuth credentials for elevated access
SHOPIFY_CLIENT_ID=your_client_id_here
SHOPIFY_CLIENT_SECRET=your_client_secret_here

# Optional: buyer-linked token (JWT) for personalized catalog results and
# Checkout MCP automatic discounts. Preferred over client credentials when set.
SHOPIFY_BUYER_TOKEN=
```

When `SHOPIFY_BUYER_TOKEN` is set (server-side only), catalog search and checkout calls attach it as a Bearer token; otherwise catalog uses client-credentials tokens for elevated rate limits and checkout stays anonymous (build + handoff).

**Note**: Without OAuth credentials, the integration works with the agent profile alone — sufficient for search in development. Add credentials from [Shopify Dev Dashboard](https://dev.shopify.com/dashboard/) → Catalogs for production rate limits.

### Getting OAuth Credentials (optional)

1. Log into your [Shopify Partner account](https://partners.shopify.com)
2. Navigate to the [**Catalogs** section of Dev Dashboard](https://dev.shopify.com/dashboard/)
3. Generate API credentials (Client ID and Client Secret)
4. Add them to `.env.local`

## Implementation

### Files

| File | Purpose |
|---|---|
| `public/ucp-agent-profile.json` | Static copy of the UCP agent profile (catalog + cart + checkout) |
| `app/.well-known/ucp/route.ts` | UCP discovery endpoint serving the same profile |
| `lib/ucp/profile.ts` | Single source of truth for the agent profile |
| `public/shopify-logo.svg` | Shopify shopping bag logo for UI badges |
| `types/shopify.ts` | TypeScript types for Global Catalog, Cart MCP, and Checkout MCP shapes |
| `types/unified.ts` | `UnifiedProduct` with `checkoutUrl` field for Shopify add-to-cart |
| `lib/shopify.ts` | API client: catalog (`searchShopifyProducts`, `lookupShopifyProducts`, `getShopifyProductDetails`), Cart MCP (`create/get/update/cancelShopifyCart`), Checkout MCP (`create/get/update/cancelShopifyCheckout`, `classifyShopifyCheckout`), `convertShopifyToUnified` |
| `app/api/search/route.ts` | Shopify integrated into unified search via `Promise.allSettled` |
| `app/api/shopify/cart/route.ts` | Cart MCP lifecycle API route |
| `app/api/shopify/checkout/route.ts` | Checkout MCP lifecycle API route (build + handoff); returns `ucpVersion` + ECP `embedded` availability |
| `lib/ucp/ecp.ts` | ECP helpers: embedded URL construction, `config.delegate` negotiation, JSON-RPC parsing/response builders, origin and `window.open` URL validation |
| `lib/ucp/discovery.ts` | Merchant-level ECP discovery: `/.well-known/ucp` probe, hostname validation (SSRF guard), TTL cache + in-flight de-dupe |
| `app/api/shopify/capabilities/route.ts` | `GET /api/shopify/capabilities` merchant capability probe |
| `tests/ucp/discovery.test.ts` | Unit tests for discovery parsing, validation and caching |
| `context/EmbeddedCheckoutContext.tsx` | Shared embedded-checkout session state (cart drawer + product modal) |
| `hooks/useEcpSession.ts` | Host side of an ECP session: origin-validated `postMessage`, `ec.ready` handshake, lifecycle events, delegated links |
| `components/EmbeddedCheckoutModal.tsx` | Embedded checkout iframe with connecting / handoff / completed states |
| `tests/ucp/ecp.test.ts` | Unit tests for the ECP protocol helpers |
| `app/api/trending/route.ts` | Shopify high-rated products injected into trending categories |
| `components/ProductCard.tsx` | Shopify source badge (green, with logo) |
| `components/ProductModal.tsx` | Shopify **Add to Cart** (Cart MCP), **Proceed to Checkout** (Checkout MCP), + **View Product Page** |
| `components/CartDrawer.tsx` | Per-merchant cart editing + combined checkout handoff |
| `hooks/useMerchantCheckout.ts` | Cart → Checkout MCP conversion and `continue_url` handoff |
| `components/RetailerToggle.tsx` | Pill-button toggle for all 6 retailers including Shopify |
| `components/SearchBar.tsx` | Search bar with inline RetailerToggle |
| `netlify.toml` | Cache headers for `ucp-agent-profile.json` and `/.well-known/ucp` |

### Request Example (search_catalog)

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "search_catalog",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json"
        }
      },
      "catalog": {
        "query": "leather jacket",
        "filters": {
          "ships_to": { "country": "US" },
          "price": { "min": 5000, "max": 15000 },
          "available": true
        },
        "pagination": { "limit": 10 }
      }
    }
  }
}
```

### Available Tools

| Tool | Description | When to use |
|---|---|---|
| `search_catalog` | Search products across all Shopify merchants | User searches for a product |
| `lookup_catalog` | Look up products/variants by GID | Resolving known IDs |
| `get_product` | Full product detail with variant selection | Product detail page, variant picking |

### Key API Features

- **Rich filters**: price range, condition (new/secondhand), shipping origin/destination, color, size, target gender, rating, category, price tier
- **Multi-merchant**: results from all Shopify stores, not just one
- **Variant-level data**: individual SKUs with pricing, availability, checkout URLs
- **Pagination**: cursor-based, up to 1,000 results
- **Personalized search**: coming soon (requires buyer-linked token)

## Cart & Checkout MCP

Cart and checkout are merchant-scoped: both target `https://{shop-domain}/api/ucp/mcp`, not the Global Catalog. Catalog results provide the shop domain (`variant.seller.domain`) and the variant GID (`variant.id`).

### Cart MCP (unauthenticated)

| Tool | Description |
|---|---|
| `create_cart` | Start a cart with line items + context/attribution/buyer |
| `get_cart` | Refresh merchant-validated totals |
| `update_cart` | Replace the cart's full state (PUT semantics) |
| `cancel_cart` | Delete the cart (requires `idempotency-key`) |

### Checkout MCP (build + handoff)

| Tool | Description |
|---|---|
| `create_checkout` | Start a checkout session, or pass `cart_id` inside `checkout` (`line_items: []`) to convert a cart |
| `get_checkout` | Refresh checkout state and messages |
| `update_checkout` | Replace the checkout's full state (PUT semantics) |
| `cancel_checkout` | Cancel a session (requires `idempotency-key`) |

`create_checkout` takes a required `checkout` object. To convert a cart, send `cart_id` **inside** that object together with `line_items: []` — the merchant then inherits the cart's line items, context, buyer, and attribution (overlapping fields are ignored). A top-level `cart_id` is rejected by the live tool ("Missing required arguments: checkout"). The response `status` drives the next step — `incomplete` / `requires_escalation` / `ready_for_complete` hand off via `continue_url`, `completed` returns `order.permalink_url`, `canceled` starts over. `classifyShopifyCheckout()` maps these to an `action` hint (`handoff` / `completed` / `canceled` / `retry_or_fallback`).

`complete_checkout` is intentionally not implemented: it requires a token granted permission to complete purchases. Emporika uses the general-access build + handoff flow where the buyer completes payment on the merchant's prefilled checkout.

Attribution defaults to `utm_source=emporika` / `utm_medium=agentic_commerce` and is overridable per call.

## Embedded Checkout (ECP)

When a checkout response advertises the `embedded` service binding, Emporika opens the merchant's checkout **inside the app** using the [Embedded Checkout Protocol](https://shopify.dev/docs/agents/carts-and-checkout/ecp) instead of a new tab. Redirect handoff stays the default whenever ECP is unavailable.

### Flow

```
create_checkout(cart_id)
  └─ checkout.continue_url + checkout.ucp.version
       ├─ ucp.services['dev.ucp.shopping'] has transport: "embedded"?
       │    ├─ yes → iframe(continue_url + ec_version + ec_delegate + ec_color_scheme)
       │    │         ├─ ec.ready        → host responds with the UCP envelope (checkout renders only after this)
       │    │         ├─ ec.start        → checkout is visible
       │    │         ├─ ec.*.change     → informational; merchant UI already updated
       │    │         ├─ ec.window.open_request → buyer confirms → host opens the https link, then responds
       │    │         ├─ ec.complete     → order created; Emporika clears that merchant's cart lines
       │    │         └─ ec.error        → host tears down and offers the redirect handoff
       │    └─ no  → window.open(continue_url)
       └─ no continue_url → cart continue_url fallback
```

### URL parameters

| Parameter | Value |
|---|---|
| `ec_version` | `checkout.ucp.version` from the Checkout MCP response (session-bound) |
| `ec_delegate` | `window.open` — only if the merchant lists it in `config.delegate` |
| `ec_color_scheme` | Emporika's current theme (`light` / `dark`) |

`ec_auth` is **never** sent. Emporika has no buyer identity to hand the merchant, and minting one would expose `SHOPIFY_BUYER_TOKEN` to the browser.

### Delegations

Only `window.open` is requested, because it is the only delegation Emporika can genuinely fulfil:

- `payment.credential` and `payment.instruments_change` need a payment handler/wallet.
- `fulfillment.address_change` needs a saved address book.

Both stay inside the merchant's checkout UI, which is the protocol's non-delegated (Option A) path. Every delegated link is confirmed by the buyer in the modal before it opens, and only `https:` URLs are allowed.

### Messages handled

| Message | Type | Host behavior |
|---|---|---|
| `ec.ready` | request | Respond `{ ucp: { status: "success", version } }`; an `auth` request fails the handshake because no credential can be supplied |
| `ec.start` | notification | Mark the embedded checkout as visible |
| `ec.*.change` | notification | Ignored — merchant UI already reflects the change |
| `ec.complete` | notification | Show the order, clear that merchant's cart lines |
| `ec.error` | notification | Tear down the iframe, offer the `continue_url` handoff |
| `ec.window.open_request` | request | Buyer confirms → open the `https:` URL → respond success, otherwise `abort_error` |
| anything else | request | JSON-RPC `-32601` so checkout is never left waiting |

### Security

- Inbound messages must come from the iframe's `contentWindow` **and** match the `continue_url` origin; responses are posted back to that origin only.
- The iframe uses `sandbox="allow-scripts allow-forms allow-same-origin"`, `credentialless`, and `referrer-policy: no-referrer` per the UCP security guidance.
- `window.open` payloads are untrusted input: non-`https` schemes are rejected with `window_open_rejected_error`.

### Filtering for ECP-capable merchants

Merchants advertise ECP in their `/.well-known/ucp` profile with a
`transport: "embedded"` service binding. That is discoverable **before**
creating a checkout:

```
GET /api/shopify/capabilities?shopDomain=www.allbirds.com[&refresh=1]
```

```json
{
  "shopDomain": "www.allbirds.com",
  "profileUrl": "https://www.allbirds.com/.well-known/ucp",
  "ok": true,
  "embedded": true,
  "delegates": [],
  "transports": ["mcp", "embedded"],
  "version": "2026-08-25",
  "mcpEndpoint": "https://weareallbirds.myshopify.com/api/ucp/mcp",
  "fetchedAt": "2026-11-02T09:04:32.984Z",
  "cached": false
}
```

- Read-only `https` probe of `<shopDomain>/.well-known/ucp`; `embedded: true` means the merchant advertises the ECP transport.
- In-memory cache: 1 hour on success, 5 minutes on failure. Concurrent probes for the same domain share one request; `refresh=1` bypasses the cache.
- `shopDomain` must be a public hostname. IP literals, `localhost`, and `.local` / `.internal` suffixes are rejected with `400` because the value becomes a server-side request.
- **Candidate filter only.** A merchant-level advertisement does not guarantee that a specific checkout enables ECP — cart contents, agent authorization, and merchant policy can narrow it. `/api/shopify/checkout` returns the authoritative `embedded.available` + `config.delegate` used by the UI.
- `delegates` at this level is only a hint and is usually empty; delegation is negotiated per checkout.

Verified live on 2026-11-02: `www.allbirds.com` and `www.deathwishcoffee.com` advertise `embedded`, while `www.gymshark.com` returns no profile (`ok: false`).

### Per-checkout availability today

Merchant discovery and per-checkout enablement are different things. On 2026-11-02, `create_checkout` against `weareallbirds.myshopify.com` and `deathwishcoffee.myshopify.com` returned `status: requires_escalation` with `ucp.services['dev.ucp.shopping'] = []` — no `embedded` binding, so no ECP session — even though both stores advertise `embedded` in `/.well-known/ucp`. Declaring `embedded` in Emporika's own agent profile did not change the response.

Per the UCP spec an absent binding means redirect-only continuation, so the app hands off to `continue_url` in a new tab. Embedded checkout turns on automatically once a merchant returns the binding; no client change is needed.

To make that visible, the checkout modal shows a green **Embedded checkout** badge when the binding is present, and an amber **Merchant checkout** badge with an explanation plus an "Open merchant checkout" button when it is not. The checkout route also logs `returned no embedded binding` for every such session, so the switch-over is visible in server logs.

### Fallback

If `ec.ready` never arrives within 12 s (for example the merchant cannot be framed), or checkout signals a fatal `ec.error`, Emporika hands off to `continue_url` in a new tab and keeps an "Open checkout in a new tab" button visible, since browsers may block a programmatic `window.open`.


## Usage

```typescript
import { searchShopifyProducts, getShopifyProductDetails } from '@/lib/shopify';

// Search
const results = await searchShopifyProducts({
  query: 'trail running shoes',
  filters: {
    ships_to: { country: 'US' },
    price: { max: 15000 },
    attributes: [
      { name: 'Color', values: ['Black'] },
      { name: 'Size', values: ['10'] },
    ],
    rating: { variant: { min: 4, min_count: 10 } },
  },
  pagination: { limit: 10 },
});

// Get product details
const product = await getShopifyProductDetails({
  id: 'gid://shopify/p/abc123',
  selected: [
    { name: 'Color', label: 'Black' },
    { name: 'Size', label: '10' },
  ],
});
```

## Error Handling

- **Missing agent profile**: Falls back to Shopify's public test fixture (always works)
- **Missing OAuth credentials**: Requests proceed with agent profile only
- **Profile fetch failures**: Shopify returns an error if the profile can't be loaded or is invalid; surfaced in API response
- **HTTP / RPC errors**: Now throw descriptive errors caught by `Promise.allSettled`, visible in the `sources.shopify.error` field
- **Token failures**: Gracefully degrades — does not block other retailers

## References

- [Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog)
- [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp)
- [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp)
- [Embedded Checkout Protocol](https://shopify.dev/docs/agents/carts-and-checkout/ecp)
- [UCP Embedded Protocol](https://ucp.dev/2026-08-25/specification/embedded-protocol/)
- [UCP Checkout — EP binding](https://ucp.dev/2026-08-25/specification/shopping/checkout/embedded/)
- [Auth and rate limiting](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting)
- [Agent Profiles & UCP Negotiation](https://shopify.dev/docs/agents/profiles)
- [Getting Started: Search Catalog](https://shopify.dev/docs/agents/get-started/search-catalog)
