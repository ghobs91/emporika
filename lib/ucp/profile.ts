// ── UCP agent profile (single source of truth) ────────────────────────────
//
// Emporika acts as a UCP Platform/Agent (consumer of Shopify businesses).
// This profile is what Shopify fetches during negotiation via
// `meta.ucp-agent.profile`.
//
// Truthful scope: Emporika only uses
//   - catalog.search / catalog.lookup (+ Shopify extensions) for discovery
//   - cart (create_cart) for Cart MCP handoff via `continue_url`
// It does NOT implement native checkout (create/update/complete_checkout),
// fulfillment selection, discount codes, buyer consent, or order webhooks —
// so those capabilities are deliberately NOT declared. Declaring them would
// negotiate sessions we cannot fulfill.
//
// Version note: pinned to `2026-04-08` because that is what
// `catalog.shopify.com/api/ucp/mcp` negotiates. `2026-08-25` exists upstream;
// bump only after verifying Shopify accepts it.
//
// Served at two URLs (same content):
//   - /ucp-agent-profile.json (static copy in `public/`)
//   - /.well-known/ucp (dynamic route in `app/.well-known/ucp/route.ts`)
// Keep all three in sync when editing.

export const UCP_VERSION = '2026-04-08' as const;

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
      'dev.ucp.shopping.cart': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/cart`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/cart.json`,
        },
      ],
      'dev.ucp.shopping.catalog.search': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/search`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_search.json`,
        },
      ],
      'dev.ucp.shopping.catalog.lookup': [
        {
          version: UCP_VERSION,
          spec: `https://ucp.dev/${UCP_VERSION}/specification/catalog/lookup`,
          schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/catalog_lookup.json`,
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
