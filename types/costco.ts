export interface CostcoProduct {
  id?: string;
  item_number?: string;
  item_name?: string;
  name?: string;
  item_product_name?: string;
  item_short_description?: string;
  description?: string;
  item_collateral_primaryimage?: string;
  item_product_primary_image?: string;
  image?: string;
  item_location_pricing_salePrice?: number;
  item_location_pricing_listPrice?: number;
  minSalePrice?: number;
  maxSalePrice?: number;
  item_ratings?: number;
  item_review_ratings?: string;
  item_review_count?: number;
  item_product_review_count?: number;
  Brand_attr?: string[];
  item_location_availability?: string;
  item_location_stockStatus?: string;
  deliveryStatus?: string;
  isItemInStock?: boolean;
  item_buyable?: boolean;
  item_product_buyable?: boolean;
  // The API returns a lot of fields, these are the main ones we care about
  [key: string]: unknown;
}

export interface CostcoSearchResponse {
  response?: {
    numFound?: number;
    start?: number;
    docs?: CostcoProduct[];
  };
  facet_counts?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CostcoSearchParams {
  query: string;
  start?: number;
  rows?: number;
  userLocation?: string;
  locale?: string;
}
