// ── UCP agent profile (single source of truth) ────────────────────────────
//
// Emporika acts as a UCP Platform/Agent (consumer of Shopify businesses).
// This profile is what Shopify fetches during negotiation via
// `meta.ucp-agent.profile`.
//
// Truthful scope: Emporika only uses
//   - catalog.search / catalog.lookup (+ Shopify extensions) for discovery
//   - cart (create/get/update/cancel) for Cart MCP sessions, handed off via
//     `continue_url`
//   - checkout (create/get/update/cancel) for Checkout MCP sessions built
//     from a cart and handed off via `continue_url`
// It does NOT complete payment (`complete_checkout`), select fulfillment,
// apply discount codes, obtain buyer consent, or read orders/webhooks — so
// `dev.ucp.shopping.fulfillment` and Order tools are deliberately NOT
// declared, and checkout is used for build + handoff only. Declaring
// capabilities we cannot fulfill would negotiate sessions we can't complete.
//
// Version note: pinned to `2026-08-25`, the version Shopify's live UCP
// endpoints negotiate (verified against `catalog.shopify.com/api/ucp/mcp`
// and the Cart/Checkout MCP bindings). Bump only after re-verifying against
// the live endpoints.
//
// Served at two URLs (same content):
//   - /ucp-agent-profile.json (static copy in `public/`)
//   - /.well-known/ucp (dynamic route in `app/.well-known/ucp/route.ts`)
// Keep all three in sync when editing.

export const UCP_VERSION = '2026-08-25' as const;

export const UCP_AGENT_PROFILE = {
  ucp: {
    version: UCP_VERSION,
    services: {
      'dev.ucp.shopping': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/overview`,
          transport: 'mcp',
          schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/mcp.openrpc.json`,
        },
      ],
    },
    capabilities: {
      'dev.ucp.shopping.catalog.search': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping/catalog/`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
        },
      ],
      'dev.ucp.shopping.catalog.lookup': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping/catalog/`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`,
        },
      ],
      'dev.ucp.shopping.cart': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping/cart/`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/cart.json`,
        },
      ],
      'dev.ucp.shopping.checkout': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping/checkout/`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/checkout.json`,
        },
      ],
      'dev.shopify.catalog': [
        {
          version: UCP_VERSION,
          spec: 'https://shopify.dev/docs/agents/catalog/storefront-catalog',
          schema: `https://shopify.dev/ucp/schemas/${UCP_VERSION}/shopify_catalog.json`,
          extends: [
            'dev.ucp.shopping.catalog.lookup',
            'dev.ucp.shopping.catalog.search',
          ],
        },
      ],
      'dev.shopify.catalog.global': [
        {
          version: UCP_VERSION,
          spec: 'https://shopify.dev/docs/agents/catalog/global-catalog',
          schema: `https://shopify.dev/ucp/schemas/${UCP_VERSION}/shopify_catalog_global.json`,
          extends: [
            'dev.ucp.shopping.catalog.lookup',
            'dev.ucp.shopping.catalog.search',
          ],
        },
      ],
    },
    payment_handlers: {},
  },
} as const;
