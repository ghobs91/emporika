# eBay Integration Guide

## Overview
This project now includes eBay as the fourth retailer, alongside Walmart, Best Buy, and Target. The integration uses eBay's Browse API to search for products and display them in the unified product grid.

## API Documentation
- **eBay Browse API**: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
- **OAuth 2.0 Client Credentials**: https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html

## Setup Instructions

### 1. Get eBay API Credentials
1. Go to https://developer.ebay.com/
2. Sign in or create a developer account
3. Navigate to "My Account" → "Application Keys"
4. Create a new application or use an existing one
5. Get your **Client ID** (App ID) and **Client Secret** (Cert ID)

### 2. Configure Environment Variables
Add these to your `.env.local` file:

```bash
EBAY_CLIENT_ID=your_ebay_client_id_here
EBAY_CLIENT_SECRET=your_ebay_client_secret_here
```

### 3. Authentication
The eBay API uses OAuth 2.0 Client Credentials flow:
- The API client automatically obtains access tokens
- Tokens are cached and automatically refreshed when expired
- No manual token management is required

## Features Implemented

### Search API
- **Endpoint**: `/api/search?query=<search_term>`
- Searches across all 4 retailers (Walmart, Best Buy, Target, eBay)
- Returns interleaved results from all sources
- Supports parameters:
  - `query`: Search term (required)
  - `numItems`: Total number of items to return (default: 25)
  - Items are distributed evenly across retailers

### Trending API
- **Endpoint**: `/api/trending`
- Returns newly listed popular items from eBay
- Combined with trending items from other retailers

## Technical Implementation

### Files Created/Modified

#### New Files:
1. **`types/ebay.ts`** - TypeScript interfaces for eBay API
   - Request/response types
   - Product data structures
   - OAuth response types

2. **`lib/ebay.ts`** - eBay API client
   - OAuth token management
   - Search products method
   - Get trending products method

3. **`.env.local.example`** - Environment variables template

#### Modified Files:
1. **`types/unified.ts`** - Added eBay support
   - Added `'ebay'` to `RetailerSource` type
   - Added `normalizeEbayProduct()` function
   - Updated `UnifiedSearchResponse` interface

2. **`app/api/search/route.ts`** - Integrated eBay search
   - Added eBay API calls to parallel fetch
   - Updated interleaving logic for 4 retailers
   - Added error handling for eBay

3. **`app/api/trending/route.ts`** - Integrated eBay trending
   - Added eBay trending API call
   - Added eBay result processing

## Data Normalization

### eBay → Unified Product Mapping:
```typescript
{
  id: `ebay-${itemId}`,
  name: title,
  price: parseFloat(price.value),
  originalPrice: marketingPrice?.originalPrice,
  image: image.imageUrl || thumbnailImages[0] || additionalImages[0],
  productUrl: itemAffiliateWebUrl || itemWebUrl,
  source: 'ebay',
  customerRating: feedbackPercentage / 20, // Convert 0-100 to 0-5 scale
  reviewCount: seller.feedbackScore,
  shortDescription: shortDescription,
  freeShipping: check if any shippingOption has cost of 0,
  availableOnline: true
}
```

## API Features Used

### Search Parameters:
- `q`: Keyword search
- `limit`: Number of results (default: items per source)
- `fieldgroups`: Set to 'EXTENDED' for additional details
- `X-EBAY-C-MARKETPLACE-ID`: Set to 'EBAY_US'

### Response Data Used:
- Item title, price, and images
- Seller feedback (used as rating)
- Shipping options
- Item location and availability
- Marketing/discount prices
- Affiliate tracking URLs (when available)

## Trending Implementation

Since eBay doesn't have a dedicated trending endpoint, the implementation:
1. Searches for newly listed items (`sort=newlyListed`)
2. Filters for Buy It Now items (`buyingOptions:{FIXED_PRICE}`)
3. Filters for new condition (`conditions:{NEW}`)
4. Returns up to 25 items

## Error Handling

- API errors are caught and logged
- Failed API calls don't break the entire search
- Sources with errors return count: 0 with error message
- Other retailers continue to function if eBay fails

## Rate Limits & Costs

- eBay Browse API has rate limits (varies by account type)
- Tokens are cached to reduce OAuth calls
- Consider implementing request caching if needed
- Check your developer account for specific limits

## Testing

### Sandbox vs Production

**Sandbox Environment** (credentials contain "SBX"):
- ⚠️ Very limited test data
- Only returns results for generic terms (e.g., "phone", "laptop", "camera")
- Specific product searches may return 0 results
- Good for testing API integration, not for real product data

**Production Environment** (recommended):
- Full eBay catalog with millions of items
- Returns results for specific product searches
- Required for real-world use

To test the integration:
1. Set up environment variables
2. Run the development server: `npm run dev`
3. Search for products: http://localhost:3000/api/search?query=laptop
4. View trending: http://localhost:3000/api/trending
5. Check the UI at http://localhost:3000

**Note**: If using sandbox credentials and searches return 0 eBay results, try generic terms like "phone" or "laptop" to verify the integration is working.

## Production Deployment

For Netlify or similar platforms:
1. Add `EBAY_CLIENT_ID` to environment variables
2. Add `EBAY_CLIENT_SECRET` to environment variables
3. Deploy as usual

## Future Enhancements

Potential improvements:
- Add category-specific searches
- Implement price range filters
- Add sorting options (price, newly listed, best match)
- Support for auction items
- Advanced filters (condition, location, shipping options)
- eBay Partner Network integration for affiliate commissions
