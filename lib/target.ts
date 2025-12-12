import { TargetSearchParams, TargetSearchResponse, TargetNearbyStoresResponse } from '@/types/target';

const TARGET_API_BASE = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2';
const TARGET_STORES_API = 'https://redsky.target.com/redsky_aggregations/v1/web/nearby_stores_v1';
const TARGET_FEATURED_DEALS_API = 'https://redsky.target.com/redsky_aggregations/v1/web/general_recommendations_placement_v1';

export class TargetAPI {
  private defaultStoreId: string;
  private defaultZip: string;

  constructor() {
    // Use default values that work for the public API
    this.defaultStoreId = process.env.TARGET_STORE_ID || '1264';
    this.defaultZip = process.env.TARGET_ZIP || '10001';
  }

  async getNearestStore(zip: string): Promise<{ storeId: string; zip: string } | null> {
    try {
      const visitorId = this.generateVisitorId();
      
      const searchParams = new URLSearchParams({
        limit: '20',
        within: '100',
        place: zip,
        key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
        visitor_id: visitorId,
        channel: 'WEB',
        page: '/c/root',
      });

      const url = `${TARGET_STORES_API}?${searchParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        console.error('Target stores API error:', response.status);
        return null;
      }

      const data: TargetNearbyStoresResponse = await response.json();
      const stores = data.data?.nearby_stores?.stores;

      if (stores && stores.length > 0) {
        const nearestStore = stores[0];
        const storeId = nearestStore.store_id;
        const storeZip = nearestStore.mailing_address?.postal_code || zip;
        
        return { storeId, zip: storeZip };
      }

      return null;
    } catch (error) {
      console.error('Error fetching nearest Target store:', error);
      return null;
    }
  }

  async searchProducts(params: TargetSearchParams): Promise<TargetSearchResponse> {
    // Generate a visitor ID (can be any valid format)
    const visitorId = this.generateVisitorId();
    
    const searchParams = new URLSearchParams({
      keyword: params.query,
      count: (params.count || 24).toString(),
      offset: (params.offset || 0).toString(),
      default_purchasability_filter: 'true',
      include_sponsored: 'true',
      include_review_summarization: 'true',
      new_search: 'true',
      page: `/s/${params.query}`,
      platform: 'desktop',
      pricing_store_id: params.store_id || this.defaultStoreId,
      store_ids: params.store_id || this.defaultStoreId,
      scheduled_delivery_store_id: params.store_id || this.defaultStoreId,
      zip: params.zip || this.defaultZip,
      visitor_id: visitorId,
      channel: 'WEB',
      key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
      spellcheck: 'true',
      include_dmc_dmr: 'true',
      useragent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    });

    const url = `${TARGET_API_BASE}?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Target API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  async getTrendingProducts(categoryQuery?: string): Promise<TargetSearchResponse> {
    const visitorId = this.generateVisitorId();
    
    // If a category query is provided, use search-based approach
    if (categoryQuery) {
      return this.searchProducts({
        query: categoryQuery,
        count: 24,
      });
    }
    
    // Otherwise, use the featured deals/recommendations endpoint
    const searchParams = new URLSearchParams({
      category_id: 'root',
      channel: 'WEB',
      include_sponsored_recommendations: 'true',
      key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
      member_id: '7991793899',
      page: '%2Fc%2F4xw74',
      placement_id: 'web_primary_bia_with_deals',
      pricing_store_id: this.defaultStoreId,
      purchasable_store_ids: `${this.defaultStoreId},1885,1139,1866,3236`,
      visitor_id: visitorId,
      resolve_to_first_variation_child: 'false',
      slingshot_component_id: 'WEB-437351',
      platform: 'desktop',
      include_dmc_dmr: 'true',
    });

    const url = `${TARGET_FEATURED_DEALS_API}?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Target trending API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Transform the featured deals response to match the search response format
    return {
      data: {
        search: {
          products: data.data?.recommended_products?.products || [],
          total: data.data?.recommended_products?.products?.length || 0,
        },
      },
    };
  }

  private generateVisitorId(): string {
    // Generate a visitor ID similar to the format Target uses
    const timestamp = Date.now().toString(16).toUpperCase();
    const random = Array.from({ length: 8 }, () => 
      Math.floor(Math.random() * 16).toString(16).toUpperCase()
    ).join('');
    return `${timestamp}${random}`.padEnd(32, '0').substring(0, 32);
  }
}

export const targetAPI = new TargetAPI();
