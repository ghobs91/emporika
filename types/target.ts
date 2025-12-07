export interface TargetProduct {
  tcin: string;
  item: {
    product_description?: {
      title: string;
      bullet_descriptions?: string[];
    };
    primary_brand?: {
      name: string;
    };
    enrichment?: {
      images?: {
        primary_image_url?: string;
        alternate_image_urls?: string[];
      };
    };
    product_classification?: {
      product_type_name?: string;
    };
  };
  price?: {
    current_retail?: number;
    current_retail_min?: number;
    reg_retail?: number;
    formatted_current_price?: string;
    formatted_comparison_price?: string;
  };
  ratings_and_reviews?: {
    statistics?: {
      rating?: {
        average?: number;
        count?: number;
      };
    };
  };
  product_vendors?: Array<{
    id?: string;
    vendor_name?: string;
  }>;
  fulfillment?: {
    shipping_options?: {
      availability_status?: string;
      services?: Array<{
        service_id?: string;
      }>;
    };
  };
}

export interface TargetSearchData {
  search: {
    products?: TargetProduct[];
    total?: number;
  };
}

export interface TargetSearchResponse {
  data?: TargetSearchData;
}

export interface TargetSearchParams {
  query: string;
  count?: number;
  offset?: number;
  store_id?: string;
  zip?: string;
}

export interface TargetStore {
  store_id: string;
  location_name: string;
  mailing_address?: {
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
  distance?: number;
}

export interface TargetNearbyStoresResponse {
  data?: {
    nearby_stores?: {
      stores?: TargetStore[];
    };
  };
}

export interface TargetRecommendationProduct {
  product: TargetProduct;
}

export interface TargetRecommendationsResponse {
  data?: {
    recommendations?: TargetRecommendationProduct[];
  };
}

export interface TargetFeaturedDealsProduct {
  __typename?: string;
  tcin: string;
  is_sponsored_sku?: boolean;
  promotions?: Array<{
    plp_message?: string;
    pdp_message?: string;
    promotion_id?: string;
    circle_offer?: boolean;
    promotion_class?: string;
  }>;
  price?: {
    current_retail?: number;
    formatted_current_price?: string;
    formatted_current_price_type?: string;
    formatted_comparison_price?: string;
    reg_retail?: number;
    save_dollar?: number;
    save_percent?: number;
  };
  ratings_and_reviews?: {
    statistics?: {
      rating?: {
        average?: number;
        count?: number;
      };
    };
  };
  item?: {
    product_description?: {
      title?: string;
    };
    enrichment?: {
      buy_url?: string;
      images?: {
        primary_image_url?: string;
        alternate_image_urls?: string[];
      };
    };
    product_classification?: {
      item_type?: {
        name?: string;
        type?: string;
      };
    };
  };
}

export interface TargetFeaturedDealsResponse {
  data?: {
    recommended_products?: {
      strategy_id?: string;
      strategy_name?: string;
      strategy_description?: string;
      products?: TargetFeaturedDealsProduct[];
    };
  };
}
