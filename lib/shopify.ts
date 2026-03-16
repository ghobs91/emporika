import { UnifiedProduct } from '@/types/unified';
import type {
  ShopifyProduct,
  ShopifySearchParams,
  ShopifySearchResponse,
  ShopifyProductDetailsParams,
} from '@/types/shopify';

const SHOPIFY_MCP_ENDPOINT = 'https://discover.shopifyapps.com/global/mcp';
const TOKEN_ENDPOINT = 'https://api.shopify.com/auth/access_token';
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// Cache for bearer token
let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Get or refresh the bearer token for Shopify API
 */
async function getBearerToken(): Promise<string> {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  // Check if credentials are configured
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error('Shopify credentials not configured. Please set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local');
  }

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
      throw new Error(`Failed to get token: ${response.statusText} (${response.status}). The provided credentials may be invalid or expired. Please check your SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    
    // Tokens typically last 24 hours, but we'll set expiry to 23 hours to be safe
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    
    return cachedToken!;
  } catch (error) {
    console.error('Error getting Shopify bearer token:', error);
    throw error;
  }
}

/**
 * Search for products in the Shopify Catalog
 */
export async function searchShopifyProducts(
  params: ShopifySearchParams
): Promise<ShopifyProduct[]> {
  try {
    const bearerToken = await getBearerToken();

    const response = await fetch(SHOPIFY_MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'search_global_products',
          arguments: {
            query: params.query,
            context: params.context,
            include_secondhand: params.include_secondhand ?? false,
            min_price: params.min_price,
            max_price: params.max_price,
            ships_to: params.ships_to ?? 'US',
            available_for_sale: params.available_for_sale ?? true,
            limit: params.limit ?? 10,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Parse the text field to get the actual offers object
    if (data.result && data.result.content && data.result.content[0]) {
      const offersData: ShopifySearchResponse = JSON.parse(data.result.content[0].text);
      return offersData.offers || [];
    }

    return [];
  } catch (error) {
    console.error('Error searching Shopify products:', error);
    return [];
  }
}

/**
 * Get detailed product information for a specific Universal Product
 */
export async function getShopifyProductDetails(
  params: ShopifyProductDetailsParams
): Promise<ShopifyProduct | null> {
  try {
    const bearerToken = await getBearerToken();

    const response = await fetch(SHOPIFY_MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'get_global_product_details',
          arguments: {
            upid: params.upid,
            product_options: params.product_options,
            ships_to: params.ships_to ?? 'US',
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.result && data.result.content && data.result.content[0]) {
      return JSON.parse(data.result.content[0].text);
    }

    return null;
  } catch (error) {
    console.error('Error getting Shopify product details:', error);
    return null;
  }
}

/**
 * Convert Shopify products to unified format
 */
export function convertShopifyToUnified(products: ShopifyProduct[]): UnifiedProduct[] {
  return products.map((product) => {
    // Get the first product variant for main details
    const firstVariant = product.products[0];
    
    return {
      id: `shopify-${product.id}`,
      name: product.title,
      price: parseFloat(product.priceRange.min.amount),
      currency: product.priceRange.min.currencyCode,
      image: product.images[0]?.url || firstVariant?.featuredImage?.url || '',
      productUrl: firstVariant?.onlineStoreUrl || product.url,
      source: 'shopify' as const,
      availableOnline: product.availableForSale,
      shortDescription: product.description,
      customerRating: product.rating?.value,
      reviewCount: product.rating?.count,
      originalPrice: 
        product.priceRange.max.amount !== product.priceRange.min.amount
          ? parseFloat(product.priceRange.max.amount)
          : undefined,
    };
  });
}

/**
 * Extract UPID from Shopify product ID
 */
export function extractUPID(shopifyId: string): string {
  // Handle both formats: "shopify-gid://shopify/p/{UPID}" or "gid://shopify/p/{UPID}"
  const match = shopifyId.match(/\/p\/([^?]+)/);
  return match ? match[1] : shopifyId;
}
