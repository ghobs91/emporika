import { WalmartProduct } from './walmart';
import { BestBuyProduct } from './bestbuy';
import { TargetProduct } from './target';

export type RetailerSource = 'walmart' | 'bestbuy' | 'target';

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
  return {
    id: `walmart-${product.itemId}`,
    name: product.name,
    price: product.salePrice,
    originalPrice: product.msrp > product.salePrice ? product.msrp : undefined,
    image: product.mediumImage || product.thumbnailImage,
    productUrl: product.productTrackingUrl,
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
    image: product.mediumImage || product.thumbnailImage || product.image || '',
    productUrl: product.url,
    source: 'bestbuy',
    customerRating: product.customerReviewAverage,
    reviewCount: product.customerReviewCount,
    shortDescription: product.shortDescription,
    freeShipping: product.freeShipping,
    availableOnline: product.onlineAvailability,
  };
}

export function normalizeTargetProduct(product: TargetProduct, index?: number): UnifiedProduct {
  const title = product.item?.product_description?.title || 'Untitled';
  const price = product.price?.current_retail || product.price?.current_retail_min || 0;
  const originalPrice = product.price?.reg_retail;
  let imageUrl = product.item?.enrichment?.images?.primary_image_url || '';
  
  // Fix protocol-relative URLs for Next.js Image component
  if (imageUrl.startsWith('//')) {
    imageUrl = `https:${imageUrl}`;
  }
  
  const rating = product.ratings_and_reviews?.statistics?.rating?.average;
  const reviewCount = product.ratings_and_reviews?.statistics?.rating?.count;
  const description = product.item?.product_description?.bullet_descriptions?.join(' ');
  const isAvailable = product.fulfillment?.shipping_options?.availability_status === 'IN_STOCK';

  // Create unique ID using tcin and optional index to prevent duplicates
  const uniqueId = index !== undefined ? `target-${product.tcin}-${index}` : `target-${product.tcin}`;

  return {
    id: uniqueId,
    name: title,
    price: price,
    originalPrice: originalPrice && originalPrice > price ? originalPrice : undefined,
    image: imageUrl,
    productUrl: `https://www.target.com/p/-/A-${product.tcin}`,
    source: 'target',
    customerRating: rating,
    reviewCount: reviewCount,
    shortDescription: description,
    freeShipping: undefined, // Target doesn't provide this in the search API
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
  };
}
