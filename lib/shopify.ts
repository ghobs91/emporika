import { UnifiedProduct } from '@/types/unified';
import type {
  ShopifyProduct,
  ShopifySearchParams,
  ShopifySearchResponse,
  ShopifyProductDetailsParams,
  ShopifyProductDetailResponse,
  ShopifyLookupParams,
  ShopifyLookupResponse,
  ShopifyCreateCartParams,
  ShopifyGetCartParams,
  ShopifyUpdateCartParams,
  ShopifyCancelCartParams,
  ShopifyCart,
} from '@/types/shopify';

// ── Configuration ─────────────────────────────────────────────────────

const SHOPIFY_MCP_ENDPOINT = 'https://catalog.shopify.com/api/ucp/mcp';
const TOKEN_ENDPOINT = 'https://api.shopify.com/auth/access_token';
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
// In development / when not explicitly configured, use Shopify's own test fixture.
// This always works and doesn't require a deployment.
// Set SHOPIFY_AGENT_PROFILE in .env.local to use the self-hosted profile in production.
const SHOPIFY_AGENT_PROFILE =
  process.env.SHOPIFY_AGENT_PROFILE ||
  'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json';

// ── Token cache ───────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Get or refresh the bearer token for Shopify API.
 */
async function getBearerToken(): Promise<string | null> {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  // If no credentials are configured, skip token acquisition
  // (the agent profile alone may be sufficient for the MCP endpoint)
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    console.warn(
      'Shopify credentials not configured. Requests will use agent profile only.'
    );
    return null;
  }

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Shopify token request failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      // Don't throw — fall back to agent-profile-only requests
      return null;
    }

    const data = await response.json();
    cachedToken = data.access_token;
    // Tokens typically last 24h; expire at 23h to be safe
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;

    return cachedToken!;
  } catch (error) {
    console.error('Error getting Shopify bearer token:', error);
    return null;
  }
}

// ── JSON-RPC helper ───────────────────────────────────────────────────

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

let jsonRpcId = 0;

/**
 * Generic JSON-RPC call to any UCP endpoint.
 * Used by both the Global Catalog (catalog.shopify.com) and
 * merchant-specific endpoints ({shop}.myshopify.com).
 *
 * Rate-limit behavior (per Shopify Cart MCP docs): on HTTP 429, retries
 * after the `Retry-After` delay (capped at 10s) with a small jittered
 * backoff, up to 2 retries. Safe because every call carries an
 * `idempotency-key` in meta.
 */
async function ucpRpcCall<T>(
  endpoint: string,
  method: string,
  params: { name: string; arguments: Record<string, unknown> },
  requiresAuth = false,
  retries = 2
): Promise<T | null> {
  const bearerToken = requiresAuth ? await getBearerToken() : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const requestId = ++jsonRpcId;
  const body = {
    jsonrpc: '2.0',
    method,
    id: requestId,
    params,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (response.status === 429 && retries > 0) {
    const parsed = parseInt(response.headers.get('Retry-After') || '', 10);
    const retryAfter = Math.min(Number.isNaN(parsed) ? 1 : Math.max(parsed, 0), 10);
    const delayMs = retryAfter * 1000 + Math.floor(Math.random() * 250);
    console.warn(`Shopify UCP rate-limited (${endpoint}), retrying in ${delayMs}ms (${retries} left)`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return ucpRpcCall<T>(endpoint, method, params, requiresAuth, retries - 1);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Shopify UCP HTTP ${response.status} (${endpoint}):`, errorText.slice(0, 500));
    const err: NodeJS.ErrnoException = new Error(
      `Shopify UCP returned ${response.status}: ${errorText.slice(0, 200)}`
    );
    err.code = `SHOPIFY_UCP_HTTP_${response.status}`;
    throw err;
  }

  const data: JsonRpcResponse = await response.json();

  if (data.error) {
    console.error(`Shopify RPC error:`, JSON.stringify(data.error));
    const err: NodeJS.ErrnoException = new Error(
      `Shopify RPC error ${data.error.code}: ${data.error.message}`
    );
    err.code = `SHOPIFY_RPC_${data.error.code}`;
    throw err;
  }

  return (data.result as T) ?? null;
}

// ── UCP request metadata ────────────────────────────────────────────────

/**
 * Build the `meta` object required on every UCP tools/call.
 * Includes the agent profile plus an `idempotency-key` so retries of the
 * same logical operation (notably create_cart) are safe. Callers may pass
 * their own key to correlate retries; otherwise one is generated.
 */
function buildMeta(idempotencyKey?: string): Record<string, unknown> {
  return {
    'ucp-agent': {
      profile: SHOPIFY_AGENT_PROFILE,
    },
    'idempotency-key':
      idempotencyKey ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Search for products across all Shopify merchants via the Global Catalog.
 */
export async function searchShopifyProducts(
  params: ShopifySearchParams
): Promise<ShopifySearchResponse | null> {
  const result = await ucpRpcCall<{
    structuredContent: ShopifySearchResponse;
  }>(SHOPIFY_MCP_ENDPOINT, 'tools/call', {
    name: 'search_catalog',
    arguments: {
      meta: buildMeta(),
      catalog: {
        query: params.query,
        context: params.context,
        filters: params.filters,
        pagination: params.pagination ?? { limit: 10 },
        view: params.view,
        saved_catalog_slug: params.saved_catalog_slug,
      },
    },
  });

  return result?.structuredContent ?? null;
}

/**
 * Look up products or variants by identifier from across all Shopify merchants.
 */
export async function lookupShopifyProducts(
  params: ShopifyLookupParams
): Promise<ShopifyLookupResponse | null> {
  const result = await ucpRpcCall<{
    structuredContent: ShopifyLookupResponse;
  }>(SHOPIFY_MCP_ENDPOINT, 'tools/call', {
    name: 'lookup_catalog',
    arguments: {
      meta: buildMeta(),
      catalog: {
        ids: params.ids,
        filters: params.filters,
        context: params.context,
        view: params.view,
      },
    },
  });

  return result?.structuredContent ?? null;
}

/**
 * Get full details for a single product with optional variant selection.
 */
export async function getShopifyProductDetails(
  params: ShopifyProductDetailsParams
): Promise<ShopifyProductDetailResponse | null> {
  const result = await ucpRpcCall<{
    structuredContent: ShopifyProductDetailResponse;
  }>(SHOPIFY_MCP_ENDPOINT, 'tools/call', {
    name: 'get_product',
    arguments: {
      meta: buildMeta(),
      catalog: {
        id: params.id,
        selected: params.selected,
        preferences: params.preferences,
        filters: params.filters,
        context: params.context,
        view: params.view,
      },
    },
  });

  return result?.structuredContent ?? null;
}

// ── Cart MCP ───────────────────────────────────────────────────────────

/**
 * Build the merchant UCP endpoint URL from a shop domain.
 * "lulu-and-georgia.myshopify.com" → "https://lulu-and-georgia.myshopify.com/api/ucp/mcp"
 */
function merchantEndpoint(shopDomain: string): string {
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${domain}/api/ucp/mcp`;
}

/**
 * Create a cart on a Shopify merchant's store via Cart MCP.
 *
 * The Cart MCP is unauthenticated — no bearer token is required.
 * Calls the merchant's UCP endpoint directly (not the Global Catalog).
 *
 * Returns the cart object with line items, estimated totals, and a
 * `continue_url` that hands the buyer off to the merchant's checkout.
 */
export async function createShopifyCart(
  params: ShopifyCreateCartParams
): Promise<ShopifyCart | null> {
  const endpoint = merchantEndpoint(params.shopDomain);

  // Build line items: use lineItems array if provided, else fall back to variantId
  const line_items = params.lineItems?.length
    ? params.lineItems.map((li) => ({
        quantity: li.quantity ?? 1,
        item: { id: li.variantId },
      }))
    : params.variantId
      ? [
          {
            quantity: params.quantity ?? 1,
            item: { id: params.variantId },
          },
        ]
      : [];

  if (line_items.length === 0) {
    throw new Error('createShopifyCart: must provide variantId or lineItems');
  }

  // Cart MCP returns the cart object directly in result.structuredContent
  const result = await ucpRpcCall<{
    structuredContent: ShopifyCart;
  }>(
    endpoint,
    'tools/call',
    {
      name: 'create_cart',
      arguments: {
        meta: buildMeta(params.idempotencyKey),
        cart: {
          line_items,
          context: params.context ?? { address_country: 'US' },
        },
      },
    },
    false // Cart MCP is unauthenticated
  );

  return result?.structuredContent ?? null;
}

/**
 * Retrieve the current state of a merchant cart via Cart MCP.
 * Read-only — safe to call after a create that returned recoverable errors
 * to pick up the merchant-validated totals before surfacing them.
 */
export async function getShopifyCart(
  params: ShopifyGetCartParams
): Promise<ShopifyCart | null> {
  const result = await ucpRpcCall<{
    structuredContent: ShopifyCart;
  }>(
    merchantEndpoint(params.shopDomain),
    'tools/call',
    {
      name: 'get_cart',
      arguments: {
        meta: buildMeta(params.idempotencyKey),
        id: params.cartId,
      },
    },
    false // Cart MCP is unauthenticated
  );

  return result?.structuredContent ?? null;
}

/**
 * Replace a merchant cart's contents via Cart MCP.
 *
 * PUT semantics: every call replaces the FULL cart state, so callers must
 * send the complete desired `lineItems` array — never a diff. Used for
 * quantity edits and recoverable-error retries (e.g. drop an unavailable
 * variant and resubmit the rest).
 */
export async function updateShopifyCart(
  params: ShopifyUpdateCartParams
): Promise<ShopifyCart | null> {
  if (!params.lineItems?.length) {
    throw new Error('updateShopifyCart: lineItems must be a non-empty array (PUT semantics)');
  }

  const result = await ucpRpcCall<{
    structuredContent: ShopifyCart;
  }>(
    merchantEndpoint(params.shopDomain),
    'tools/call',
    {
      name: 'update_cart',
      arguments: {
        meta: buildMeta(params.idempotencyKey),
        id: params.cartId,
        cart: {
          line_items: params.lineItems.map((li) => ({
            quantity: li.quantity ?? 1,
            item: { id: li.variantId },
          })),
          context: params.context ?? { address_country: 'US' },
        },
      },
    },
    false // Cart MCP is unauthenticated
  );

  return result?.structuredContent ?? null;
}

/**
 * Cancel a merchant cart via Cart MCP. Best-effort cleanup — callers
 * should still drop local references even if this throws.
 */
export async function cancelShopifyCart(
  params: ShopifyCancelCartParams
): Promise<ShopifyCart | null> {
  const result = await ucpRpcCall<{
    structuredContent: ShopifyCart;
  }>(
    merchantEndpoint(params.shopDomain),
    'tools/call',
    {
      name: 'cancel_cart',
      arguments: {
        meta: buildMeta(params.idempotencyKey),
        id: params.cartId,
      },
    },
    false // Cart MCP is unauthenticated
  );

  return result?.structuredContent ?? null;
}

// ── Conversion ────────────────────────────────────────────────────────

/**
 * Convert Shopify Global Catalog products to the unified format
 * used across the app.
 */
export function convertShopifyToUnified(
  products: ShopifyProduct[]
): UnifiedProduct[] {
  return products.map((product) => {
    // Prefer the first variant's price, fall back to the price range min
    const firstVariant = product.variants?.[0];
    const priceRaw =
      firstVariant?.price?.amount ?? product.price_range?.min?.amount ?? 0;

    // Image: prefer first media image
    const imageUrl =
      product.media?.find((m) => m.type === 'image')?.url ?? '';

    // Product page URL (for "View on Shopify")
    const productUrl =
      firstVariant?.url ?? product.url ?? '';

    // Direct checkout URL (for "Add to Cart") — adds variant directly to cart
    const checkoutUrl = firstVariant?.checkout_url;

    // Original (max) price if there's a range
    const maxAmount = product.price_range?.max?.amount;
    const minAmount = product.price_range?.min?.amount;
    const originalPrice =
      maxAmount && minAmount && maxAmount > minAmount
        ? maxAmount / 100
        : undefined;

    // Availability: true if any variant is available
    const availableOnline = product.variants?.some(
      (v) => v.availability?.available !== false
    ) ?? true;

    // Seller name (from first variant)
    const sellerName = firstVariant?.seller?.name;

    // Seller domain for Cart MCP calls (e.g. "lulu-and-georgia.myshopify.com")
    const sellerDomain = firstVariant?.seller?.domain;

    // Variant GID for Cart MCP calls
    const variantId = firstVariant?.id;

    return {
      id: `shopify-${extractUPID(product.id)}`,
      name: sellerName
        ? `${product.title} — ${sellerName}`
        : product.title,
      price: priceRaw / 100,
      originalPrice,
      image: imageUrl,
      productUrl,
      checkoutUrl,
      sellerDomain,
      variantId,
      source: 'shopify' as const,
      availableOnline,
      shortDescription:
        product.description?.plain ??
        product.description?.html ??
        undefined,
      customerRating: product.rating?.value,
      reviewCount: product.rating?.count,
    };
  });
}

/**
 * Extract the UPID portion from a Shopify GID.
 * "gid://shopify/p/abc123" → "abc123"
 */
export function extractUPID(shopifyId: string): string {
  const match = shopifyId.match(/\/p\/([^?]+)/);
  return match ? match[1] : shopifyId;
}
