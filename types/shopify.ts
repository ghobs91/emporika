// Shopify Catalog API Types

export interface ShopifyProduct {
  id: string; // UPID format: gid://shopify/p/{UPID}
  title: string;
  description: string;
  images: ShopifyImage[];
  options: ShopifyOption[];
  priceRange: {
    min: {
      amount: string;
      currencyCode: string;
    };
    max: {
      amount: string;
      currencyCode: string;
    };
  };
  products: ShopifyProductVariant[];
  availableForSale: boolean;
  rating: {
    value: number;
    count: number;
  } | null;
  inferredFields?: string[];
  uniqueSellingPoint?: string;
  topFeatures?: string[];
  techSpecs?: string[];
  sharedAttributes?: ShopifyAttribute[];
  url: string;
}

export interface ShopifyImage {
  url: string;
  altText: string;
  product: {
    id: string;
    title: string;
    onlineStoreUrl: string;
    shop: {
      name: string;
      onlineStoreUrl: string;
    };
  };
}

export interface ShopifyOption {
  name: string;
  values: {
    value: string;
    availableForSale: boolean;
    exists: boolean;
  }[];
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  checkoutUrl: string;
  description: string;
  featuredImage: {
    url: string;
    altText: string;
  };
  onlineStoreUrl: string;
  price: {
    amount: string;
    currencyCode: string;
  };
  rating: {
    value: number;
    count: number;
  } | null;
  availableForSale: boolean;
  shop: ShopifyShop;
  selectedProductVariant: {
    id: string;
    availableForSale: boolean;
    options: {
      name: string;
      value: string;
    }[];
    price: {
      amount: string;
      currencyCode: string;
    };
    image: {
      url: string;
      altText: string;
    };
    selectionState?: {
      type: string;
      requestedFilters: string[];
    };
  };
  secondhand: boolean;
  requiresSellingPlan: boolean;
  eligibleForNativeCheckout: boolean;
}

export interface ShopifyShop {
  name: string;
  paymentSettings: {
    supportedDigitalWallets: string[];
    acceptedCardBrands: string[];
  };
  onlineStoreUrl: string;
  privacyPolicy: {
    url: string;
  };
  refundPolicy: {
    url: string;
  };
  termsOfService: {
    url: string;
  };
  shippingPolicy: {
    url: string;
  };
  id: string;
  permanentDomain: string;
}

export interface ShopifyAttribute {
  name: string;
  values: string[];
}

export interface ShopifySearchResponse {
  offers: ShopifyProduct[];
  instructions: string;
}

export interface ShopifySearchParams {
  query: string;
  context?: string;
  include_secondhand?: boolean;
  min_price?: number;
  max_price?: number;
  ships_to?: string;
  available_for_sale?: boolean;
  limit?: number;
}

export interface ShopifyProductDetailsParams {
  upid: string;
  product_options?: {
    key: string;
    values: string[];
  }[];
  ships_to?: string;
}
