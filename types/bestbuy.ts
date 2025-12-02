export interface BestBuyProduct {
  sku: number;
  name: string;
  type: string;
  regularPrice: number;
  salePrice: number;
  onSale: boolean;
  url: string;
  addToCartUrl?: string;
  image?: string;
  thumbnailImage?: string;
  mediumImage?: string;
  largeFrontImage?: string;
  customerReviewAverage?: number;
  customerReviewCount?: number;
  shortDescription?: string;
  longDescription?: string;
  manufacturer?: string;
  modelNumber?: string;
  upc?: string;
  categoryPath?: Array<{
    id: string;
    name: string;
  }>;
  freeShipping?: boolean;
  inStoreAvailability?: boolean;
  onlineAvailability?: boolean;
}

export interface BestBuySearchResponse {
  from: number;
  to: number;
  currentPage: number;
  total: number;
  totalPages: number;
  queryTime: string;
  totalTime: string;
  partial: boolean;
  canonicalUrl: string;
  products: BestBuyProduct[];
}

export interface BestBuySearchParams {
  query: string;
  pageSize?: number;
  page?: number;
  sort?: string;
  show?: string;
}
