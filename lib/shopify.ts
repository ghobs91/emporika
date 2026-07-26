import { UnifiedProduct } from '@/types/unified';
import type {
  ShopifyProduct,
  ShopifySearchParams,
  ShopifySearchResponse,
  ShopifyProductDetailsParams,
  ShopifyProductDetailResponse,
  ShopifyLookupParams,
  ShopifyLookupResponse,
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

async function rpcCall<T>(
  method: string,
  params: { name: string; arguments: Record<string, unknown> }
): Promise<T | null> {
  const bearerToken = await getBearerToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const id = ++jsonRpcId;
  const body = {
    jsonrpc: '2.0',
    method,
    id,
    params,
  };

  const response = await fetch(SHOPIFY_MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Shopify MCP HTTP ${response.status}:`, errorText.slice(0, 500));
    // Surface a useful error so the caller can distinguish causes
    const err: NodeJS.ErrnoException = new Error(
      `Shopify MCP returned ${response.status}: ${errorText.slice(0, 200)}`
    );
    err.code = `SHOPIFY_MCP_HTTP_${response.status}`;
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

// ── Public API ────────────────────────────────────────────────────────

/**
 * Search for products across all Shopify merchants via the Global Catalog.
 */
export async function searchShopifyProducts(
  params: ShopifySearchParams
): Promise<ShopifySearchResponse | null> {
  const result = await rpcCall<{
    structuredContent: ShopifySearchResponse;
  }>('tools/call', {
    name: 'search_catalog',
    arguments: {
      meta: {
        'ucp-agent': {
          profile: SHOPIFY_AGENT_PROFILE,
        },
      },
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
  const result = await rpcCall<{
    structuredContent: ShopifyLookupResponse;
  }>('tools/call', {
    name: 'lookup_catalog',
    arguments: {
      meta: {
        'ucp-agent': {
          profile: SHOPIFY_AGENT_PROFILE,
        },
      },
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
  const result = await rpcCall<{
    structuredContent: ShopifyProductDetailResponse;
  }>('tools/call', {
    name: 'get_product',
    arguments: {
      meta: {
        'ucp-agent': {
          profile: SHOPIFY_AGENT_PROFILE,
        },
      },
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
