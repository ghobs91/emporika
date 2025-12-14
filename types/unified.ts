import { WalmartProduct } from './walmart';
import { BestBuyProduct, BestBuyTrendingProduct } from './bestbuy';
import { TargetProduct, TargetFeaturedDealsProduct } from './target';
import { EbayItemSummary } from './ebay';
import { CostcoProduct } from './costco';

export type RetailerSource = 'walmart' | 'bestbuy' | 'target' | 'ebay' | 'costco';

// Unified product interface that works across all retailers
export interface UnifiedProduct {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  productUrl: string;
  source: RetailerSource;
  customerRating?: number;
  reviewCount?: number;
  shortDescription?: string;
  freeShipping?: boolean;
  availableOnline?: boolean;
}

export function normalizeWalmartProduct(product: WalmartProduct): UnifiedProduct {
  // Extract clean product URL from tracking URL
  // Tracking URLs look like: https://goto.walmart.com/c/568844/9383?veh=aff&sourceid=...&u=https%3A%2F%2Fwww.walmart.com%2Fip%2F516833054
  // We want just: https://www.walmart.com/ip/516833054
  let productUrl = product.productUrl;
  
  if (product.productTrackingUrl) {
    try {
      const url = new URL(product.productTrackingUrl);
      const targetUrl = url.searchParams.get('u');
      if (targetUrl) {
        productUrl = decodeURIComponent(targetUrl);
      }
    } catch (e) {
      // If parsing fails, fall back to productUrl
      console.error('Failed to parse Walmart tracking URL:', e);
    }
  }
  
  return {
    id: `walmart-${product.itemId}`,
    name: product.name,
    price: product.salePrice,
    originalPrice: product.msrp > product.salePrice ? product.msrp : undefined,
    image: product.largeImage || product.mediumImage || product.thumbnailImage,
    productUrl: productUrl,
    source: 'walmart',
    customerRating: product.customerRating ? parseFloat(product.customerRating) : undefined,
    reviewCount: product.numReviews,
    shortDescription: product.shortDescription,
    freeShipping: product.freeShippingOver35Dollars,
    availableOnline: product.availableOnline,
  };
}

export function normalizeBestBuyProduct(product: BestBuyProduct): UnifiedProduct {
  return {
    id: `bestbuy-${product.sku}`,
    name: product.name,
    price: product.salePrice,
    originalPrice: product.regularPrice > product.salePrice ? product.regularPrice : undefined,
    image: product.largeFrontImage || product.image || product.mediumImage || product.thumbnailImage || '',
    productUrl: product.url,
    source: 'bestbuy',
    customerRating: product.customerReviewAverage,
    reviewCount: product.customerReviewCount,
    shortDescription: product.shortDescription,
    freeShipping: product.freeShipping,
    availableOnline: product.onlineAvailability,
  };
}

export function normalizeBestBuyTrendingProduct(product: BestBuyTrendingProduct): UnifiedProduct {
  return {
    id: `bestbuy-${product.sku}`,
    name: product.names.title,
    price: product.prices.current,
    originalPrice: product.prices.regular > product.prices.current ? product.prices.regular : undefined,
    image: product.images.standard,
    productUrl: product.links.web,
    source: 'bestbuy',
    customerRating: product.customerReviews?.averageScore,
    reviewCount: product.customerReviews?.count,
    shortDescription: product.descriptions?.short || undefined,
    freeShipping: undefined,
    availableOnline: true,
  };
}

export function normalizeTargetProduct(product: TargetProduct | TargetFeaturedDealsProduct, index?: number): UnifiedProduct {
  const title = product.item?.product_description?.title || 'Untitled';
  
  // Handle different price structures between TargetProduct and TargetFeaturedDealsProduct
  const price = product.price?.current_retail || 
    ('current_retail_min' in (product.price || {}) ? (product.price as any).current_retail_min : 0) || 0;
  const originalPrice = product.price?.reg_retail;
  let imageUrl = product.item?.enrichment?.images?.primary_image_url || '';
  
  // Fix protocol-relative URLs for Next.js Image component
  if (imageUrl.startsWith('//')) {
    imageUrl = `https:${imageUrl}`;
  }
  
  const rating = product.ratings_and_reviews?.statistics?.rating?.average;
  const reviewCount = product.ratings_and_reviews?.statistics?.rating?.count;
  
  // Handle different description structures
  const description = 'bullet_descriptions' in (product.item?.product_description || {})
    ? (product.item?.product_description as any).bullet_descriptions?.join(' ')
    : undefined;
  
  // Handle fulfillment (only exists on TargetProduct)
  const isAvailable = 'fulfillment' in product
    ? product.fulfillment?.shipping_options?.availability_status === 'IN_STOCK'
    : undefined;

  // Create unique ID using tcin and optional index to prevent duplicates
  const uniqueId = index !== undefined ? `target-${product.tcin}-${index}` : `target-${product.tcin}`;
  
  // Use buy_url from enrichment if available (from featured deals), otherwise construct it
  const buyUrl = 'buy_url' in (product.item?.enrichment || {})
    ? (product.item?.enrichment as any).buy_url
    : undefined;
  const productUrl = buyUrl || `https://www.target.com/p/-/A-${product.tcin}`;

  return {
    id: uniqueId,
    name: title,
    price: price,
    originalPrice: originalPrice && originalPrice > price ? originalPrice : undefined,
    image: imageUrl,
    productUrl: productUrl,
    source: 'target',
    customerRating: rating,
    reviewCount: reviewCount,
    shortDescription: description,
    freeShipping: undefined, // Target doesn't provide this in the search API
    availableOnline: isAvailable,
  };
}

export function normalizeEbayProduct(product: EbayItemSummary): UnifiedProduct {
  const price = product.price ? parseFloat(product.price.value) : 0;
  const originalPrice = product.marketingPrice?.originalPrice 
    ? parseFloat(product.marketingPrice.originalPrice.value) 
    : undefined;
  
  // Use the best available image
  const imageUrl = product.image?.imageUrl || 
    product.thumbnailImages?.[0]?.imageUrl || 
    product.additionalImages?.[0]?.imageUrl || 
    '';
  
  // Note: eBay's feedback data is for the seller, not the product, so we exclude it

  return {
    id: `ebay-${product.itemId}`,
    name: product.title,
    price: price,
    originalPrice: originalPrice && originalPrice > price ? originalPrice : undefined,
    image: imageUrl,
    productUrl: product.itemAffiliateWebUrl || product.itemWebUrl || `https://www.ebay.com/itm/${product.legacyItemId || product.itemId}`,
    source: 'ebay',
    customerRating: undefined, // eBay only provides seller ratings, not product ratings
    reviewCount: undefined, // eBay only provides seller feedback, not product reviews
    shortDescription: product.shortDescription,
    freeShipping: product.shippingOptions?.some(option => 
      option.shippingCost?.value === '0' || option.shippingCost?.value === '0.0'
    ),
    availableOnline: true, // eBay items are always available online
  };
}

export function normalizeCostcoProduct(product: CostcoProduct): UnifiedProduct {
  // Extract price - try different fields
  const price = product.item_location_pricing_salePrice ?? 
    product.minSalePrice ?? 
    product.maxSalePrice ?? 
    0;

  const listPrice = product.item_location_pricing_listPrice;
  const originalPrice = listPrice && listPrice > price ? listPrice : undefined;

  // Extract product name
  const name = product.item_name || 
    product.item_product_name || 
    product.name || 
    product.item_short_description || 
    'Untitled';

  // Extract item number
  const itemNumber = product.item_number || 
    (product.id ? product.id.split('!')[0] : undefined);

  // Construct product URL
  const productUrl = itemNumber 
    ? `https://www.costco.com/.product.${itemNumber}.html`
    : '#';

  // Extract image URL
  const imageUrl = product.item_collateral_primaryimage || 
    product.item_product_primary_image || 
    product.image || 
    '';

  // Extract rating
  const rating = product.item_ratings || 
    (product.item_review_ratings ? parseFloat(product.item_review_ratings) : undefined);

  // Extract review count
  const reviewCount = product.item_product_review_count ?? 
    product.item_review_count ?? 
    undefined;

  // Check availability
  const isAvailable = product.isItemInStock ?? 
    product.item_buyable ?? 
    product.item_product_buyable ?? 
    (product.deliveryStatus === 'in stock' ||
    product.item_location_availability === 'in stock' ||
    product.item_location_stockStatus === 'in stock');

  return {
    id: `costco-${itemNumber || Math.random().toString(36).substr(2, 9)}`,
    name: name,
    price: price,
    originalPrice: originalPrice,
    image: imageUrl,
    productUrl: productUrl,
    source: 'costco',
    customerRating: rating,
    reviewCount: reviewCount,
    shortDescription: product.item_short_description || product.description,
    freeShipping: undefined, // Costco doesn't provide this info in search results
    availableOnline: isAvailable,
  };
}

export interface UnifiedSearchResponse {
  query: string;
  totalResults: number;
  items: UnifiedProduct[];
  sources: {
    walmart?: {
      count: number;
      error?: string;
    };
    bestbuy?: {
      count: number;
      error?: string;
    };
    target?: {
      count: number;
      error?: string;
    };
    ebay?: {
      count: number;
      error?: string;
    };
    costco?: {
      count: number;
      error?: string;
    };
  };
}
