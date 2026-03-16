# Shopify Catalog Integration

This document describes the integration of Shopify's global catalog API into Emporika.

## Overview

Emporika now searches across 6 major retailers including:
- Walmart
- Best Buy
- Target
- eBay
- Costco
- **Shopify (NEW)**

## API Credentials

The Shopify Catalog API uses OAuth 2.0 client credentials flow. You need to obtain your own credentials from Shopify:

### How to Get Credentials

1. Create or log into your [Shopify Partner account](https://partners.shopify.com)
2. Navigate to the [**Catalogs** section of Dev Dashboard](https://dev.shopify.com/dashboard/)
3. Generate your API credentials (Client ID and Client Secret)

### Configuration

Add your credentials to `.env.local`:

```env
SHOPIFY_CLIENT_ID=your_client_id_here
SHOPIFY_CLIENT_SECRET=your_client_secret_here
```

**Note**: The credentials shown in the documentation are examples only and will not work. You must obtain your own valid credentials from Shopify Dev Dashboard.

### API Endpoints

- **MCP Endpoint**: `https://discover.shopifyapps.com/global/mcp`
- **Token Endpoint**: `https://api.shopify.com/auth/access_token`

## Implementation

### Files Created/Modified

1. **types/shopify.ts** - Type definitions for Shopify Catalog API responses
2. **lib/shopify.ts** - API client with functions for:
   - `searchShopifyProducts()` - Search the global catalog
   - `getShopifyProductDetails()` - Get detailed info for a specific product
   - `convertShopifyToUnified()` - Convert to UnifiedProduct format
   - `getBearerToken()` - Manage OAuth tokens (cached for 23 hours)

3. **types/unified.ts** - Added 'shopify' to RetailerSource type
4. **app/api/search/route.ts** - Integrated Shopify search into unified search
5. **components/ProductCard.tsx** - Added Shopify source label and styling

### Features

- **Global Product Search**: Search across all Shopify merchants
- **Token Caching**: Bearer tokens are cached for 23 hours to minimize API calls
- **Rich Product Data**: Includes:
  - Product variants and options (size, color, etc.)
  - Shop information and policies
  - Ratings and reviews
  - Top features and tech specs
  - Images and pricing
  - Checkout URLs

- **Query Parameters Supported**:
  - `query` - Search term
  - `context` - Additional context (e.g., "sustainable fashion")
  - `include_secondhand` - Include second-hand items
  - `min_price` / `max_price` - Price range filtering
  - `ships_to` - Shipping location (default: 'US')
  - `limit` - Max results to return

## Usage

The integration is automatic - Shopify results will appear alongside other retailers in search results.

### Example API Call

```typescript
import { searchShopifyProducts } from '@/lib/shopify';

const results = await searchShopifyProducts({
  query: 'leather jacket',
  include_secondhand: true,
  max_price: 150,
  ships_to: 'US',
  limit: 10
});
```

### Getting Product Details

```typescript
import { getShopifyProductDetails } from '@/lib/shopify';

const product = await getShopifyProductDetails({
  upid: 'abc123XYZ789defGHI456jk',
  product_options: [{
    key: 'Size',
    values: ['Large (L)']
  }]
});
```

## Shopify Product Data Structure

Products are identified by a Universal Product ID (UPID) in the format:
`gid://shopify/p/{UPID}`

Each product contains:
- **Aggregated data** across all merchants selling that product
- **Individual product variants** from each merchant
- **Shop-specific information** including payment methods and policies
- **Variant options** like color, size, etc.

## UI Display

Shopify products display with:
- Green badge/tag with "Shopify" label
- Product images, title, and description
- Price range (min to max across variants)
- Ratings and reviews (when available)
- Link to product page on the merchant's Shopify store

## TODO

- [ ] Add Shopify favicon image to `/public/shopify-favicon.png`
  - Recommended size: 16x16 or 32x32 pixels
  - Should be the Shopify "bag" logo in green
  - You can download from: https://cdn.shopify.com/shopifycloud/web/assets/v1/favicon.ico

## API Rate Limits

- Token generation: Standard OAuth rate limits apply
- Product search: Check Shopify Catalog API documentation for current limits
- Tokens are cached for 23 hours to minimize token refresh calls

## Error Handling

The integration includes error handling for:
- **Missing credentials**: Clear error message if environment variables are not set
- **Invalid credentials**: Detailed error with status code if authentication fails
- Token generation failures
- API request failures
- Empty or malformed responses

**Important**: If you see "Unauthorized" errors, the credentials in your `.env.local` file are either:
- Not valid credentials from Shopify Dev Dashboard
- Expired or revoked
- Test/example credentials (which won't work)

To fix authentication errors:
1. Visit [Shopify Dev Dashboard](https://dev.shopify.com/dashboard/)
2. Generate new API credentials in the Catalogs section
3. Update your `.env.local` file with the new credentials
4. Restart your development server

Errors are logged to console and gracefully handled - searches continue with other retailers if Shopify fails.

## References

- [Shopify Catalog API Documentation](https://shopify.dev/docs/agents/catalog)
- [MCP Server Documentation](https://shopify.dev/docs/agents/catalog/mcp)
- [Search Tutorial](https://shopify.dev/docs/agents/get-started/search-catalog)
