import { WalmartProduct } from './walmart';
import { BestBuyProduct } from './bestbuy';

export type RetailerSource = 'walmart' | 'bestbuy';

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
    originalPrice: product.onSale && product.regularPrice > product.salePrice ? product.regularPrice : undefined,
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
  };
}
