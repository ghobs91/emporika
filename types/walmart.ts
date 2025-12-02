export interface WalmartProduct {
  itemId: number;
  parentItemId: number;
  name: string;
  msrp: number;
  salePrice: number;
  upc: string;
  categoryPath: string;
  shortDescription?: string;
  longDescription?: string;
  thumbnailImage: string;
  mediumImage?: string;
  largeImage?: string;
  productTrackingUrl: string;
  standardShipRate?: number;
  marketplace?: boolean;
  modelNumber?: string;
  productUrl: string;
  customerRating?: string;
  numReviews?: number;
  customerRatingImage?: string;
  categoryNode?: string;
  bundle?: boolean;
  stock?: string;
  addToCartUrl?: string;
  affiliateAddToCartUrl?: string;
  freeShippingOver35Dollars?: boolean;
  offerType?: string;
  isTwoDayShippingEligible?: boolean;
  availableOnline?: boolean;
}

export interface WalmartSearchResponse {
  query: string;
  sort: string;
  responseGroup: string;
  totalResults: number;
  start: number;
  numItems: number;
  items: WalmartProduct[];
}

export interface WalmartSearchParams {
  query: string;
  sort?: 'relevance' | 'price' | 'title' | 'bestseller' | 'customerRating' | 'new';
  order?: 'ascending' | 'descending';
  start?: number;
  numItems?: number;
  categoryId?: string;
  format?: 'json' | 'xml';
}

export interface WalmartTrendingResponse {
  items: WalmartProduct[];
}
