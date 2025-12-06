// eBay Browse API types based on the official documentation
// https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search

export interface EbayImage {
  imageUrl: string;
  height?: number;
  width?: number;
}

export interface EbayConvertedAmount {
  value: string;
  currency: string;
  convertedFromValue?: string;
  convertedFromCurrency?: string;
}

export interface EbaySeller {
  username: string;
  feedbackPercentage?: string;
  feedbackScore?: number;
  sellerAccountType?: string;
}

export interface EbayShippingOption {
  shippingCostType?: string;
  shippingCost?: EbayConvertedAmount;
  minEstimatedDeliveryDate?: string;
  maxEstimatedDeliveryDate?: string;
  guaranteedDelivery?: boolean;
}

export interface EbayItemLocation {
  postalCode?: string;
  country?: string;
  city?: string;
  stateOrProvince?: string;
}

export interface EbayMarketingPrice {
  originalPrice?: EbayConvertedAmount;
  discountPercentage?: string;
  discountAmount?: EbayConvertedAmount;
}

export interface EbayCategory {
  categoryId: string;
  categoryName: string;
}

export interface EbayItemSummary {
  itemId: string;
  title: string;
  image?: EbayImage;
  price?: EbayConvertedAmount;
  itemHref?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  seller?: EbaySeller;
  condition?: string;
  conditionId?: string;
  thumbnailImages?: EbayImage[];
  shippingOptions?: EbayShippingOption[];
  buyingOptions?: string[];
  itemLocation?: EbayItemLocation;
  categories?: EbayCategory[];
  shortDescription?: string;
  marketingPrice?: EbayMarketingPrice;
  currentBidPrice?: EbayConvertedAmount;
  additionalImages?: EbayImage[];
  availableCoupons?: boolean;
  legacyItemId?: string;
}

export interface EbaySearchResponse {
  href: string;
  total: number;
  next?: string;
  prev?: string;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
  warnings?: Array<{
    category: string;
    domain: string;
    errorId: number;
    message: string;
  }>;
}

export interface EbaySearchParams {
  q?: string;
  category_ids?: string;
  gtin?: string;
  limit?: number;
  offset?: number;
  sort?: 'price' | '-price' | 'distance' | 'newlyListed';
  filter?: string;
  fieldgroups?: string;
  aspect_filter?: string;
  epid?: string;
  auto_correct?: 'KEYWORD';
}

export interface EbayOAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}
