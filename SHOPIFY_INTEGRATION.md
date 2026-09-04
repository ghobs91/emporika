# Shopify Global Catalog Integration

This document describes the integration of Shopify's Global Catalog MCP API into Emporika.

## Overview

Emporika now searches across 6 major retailers including:
- Walmart
- Best Buy
- Target
- eBay
- Costco
- **Shopify (Global Catalog MCP)**

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
```

## UCP Agent Profile

### How negotiation works

1. Every MCP request includes `meta.ucp-agent.profile` pointing to a profile URL.
2. Shopify fetches the profile, validates it, and intersects its capabilities with Emporika's declared set.
3. The response includes `ucp.capabilities` showing the negotiated set.

### Default profile (development)

By default, the integration uses Shopify's own test fixture — no setup required:

```
https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json
```

This is the recommended default from [Shopify's profiles docs](https://shopify.dev/docs/agents/profiles). It works out of the box on `localhost`.

### Production profile (self-hosted)

For production, set `SHOPIFY_AGENT_PROFILE` in `.env.local` (or Netlify env vars):

```env
SHOPIFY_AGENT_PROFILE=https://emporika.netlify.app/ucp-agent-profile.json
```

The profile source of truth is `lib/ucp/profile.ts`, served at both `/ucp-agent-profile.json` (static copy in `public/`) and `/.well-known/ucp` (discovery route). It deliberately declares only what Emporika implements — cart (Cart MCP handoff via `continue_url`) plus catalog search/lookup — and omits native checkout, fulfillment, discount, buyer consent, and order until those are implemented:

| Capability | Purpose |
|---|---|
| `dev.ucp.shopping.cart` | Cart management (`create_cart` → `continue_url` handoff) |
| `dev.ucp.shopping.catalog.search` | Search products across all Shopify merchants |
| `dev.ucp.shopping.catalog.lookup` | Resolve product/variant IDs |
| `dev.shopify.catalog` | Shopify storefront catalog extension |
| `dev.shopify.catalog.global` | Shopify global catalog extension |

Once deployed to Netlify, Shopify caches the profile (`Cache-Control: public, max-age=3600, s-maxage=86400`).

## Endpoint & Protocol

- **Endpoint**: `https://catalog.shopify.com/api/ucp/mcp`
- **Protocol**: JSON-RPC 2.0 over HTTP POST
- **UCP version**: `2026-04-08`
- **Tools used**: `search_catalog`, `lookup_catalog`, `get_product`

## API Credentials

The Shopify Global Catalog identifies agents via the UCP agent profile (required) and optionally authenticates via OAuth client credentials for elevated rate limits.

### Configuration

```env
# Override the agent profile URL (default: Shopify test fixture)
SHOPIFY_AGENT_PROFILE=https://emporika.netlify.app/ucp-agent-profile.json

# Optional: OAuth credentials for elevated access
SHOPIFY_CLIENT_ID=your_client_id_here
SHOPIFY_CLIENT_SECRET=your_client_secret_here
```

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
| `public/ucp-agent-profile.json` | Static copy of the UCP agent profile (truthful scope: cart + catalog) |
| `app/.well-known/ucp/route.ts` | UCP discovery endpoint serving the same profile |
| `lib/ucp/profile.ts` | Single source of truth for the agent profile |
| `public/shopify-logo.svg` | Shopify shopping bag logo for UI badges |
| `types/shopify.ts` | TypeScript types for Global Catalog MCP request/response shapes |
| `types/unified.ts` | `UnifiedProduct` with `checkoutUrl` field for Shopify add-to-cart |
| `lib/shopify.ts` | API client (`searchShopifyProducts`, `lookupShopifyProducts`, `getShopifyProductDetails`, `convertShopifyToUnified`) |
| `app/api/search/route.ts` | Shopify integrated into unified search via `Promise.allSettled` |
| `app/api/trending/route.ts` | Shopify high-rated products injected into trending categories |
| `components/ProductCard.tsx` | Shopify source badge (green, with logo) |
| `components/ProductModal.tsx` | Dual Shopify buttons: **Add to Cart** (checkoutUrl) + **View Product Page** (productUrl) |
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
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
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
- [Agent Profiles & UCP Negotiation](https://shopify.dev/docs/agents/profiles)
- [Getting Started: Search Catalog](https://shopify.dev/docs/agents/get-started/search-catalog)
