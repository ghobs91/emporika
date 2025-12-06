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
  location_id: number;
  location_names: Array<{
    name: string;
  }>;
  mailing_address?: {
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
  geographic_specifications?: {
    latitude?: number;
    longitude?: number;
  };
}

export interface TargetNearbyStoresResponse {
  data?: {
    nearby_stores?: {
      locations?: TargetStore[];
    };
  };
}
