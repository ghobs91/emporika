import { EbaySearchParams, EbaySearchResponse, EbayOAuthResponse } from '@/types/ebay';

export class EbayAPI {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private isSandbox: boolean;
  private apiBase: string;
  private oauthBase: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    
    // Detect sandbox credentials (contain 'SBX' or 'SANDBOX')
    this.isSandbox = clientId.includes('SBX') || clientId.includes('SANDBOX') || 
                     clientSecret.includes('SBX') || clientSecret.includes('SANDBOX');
    
    // Use appropriate endpoints
    if (this.isSandbox) {
      this.apiBase = 'https://api.sandbox.ebay.com/buy/browse/v1';
      this.oauthBase = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
    } else {
      this.apiBase = 'https://api.ebay.com/buy/browse/v1';
      this.oauthBase = 'https://api.ebay.com/identity/v1/oauth2/token';
    }
  }

  /**
   * Get OAuth access token using client credentials grant flow
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(this.oauthBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay OAuth error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data: EbayOAuthResponse = await response.json();
    this.accessToken = data.access_token;
    // Set expiry to 5 minutes before actual expiry for safety
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

    return this.accessToken;
  }

  /**
   * Search for products on eBay
   */
  async searchProducts(params: EbaySearchParams): Promise<EbaySearchResponse> {
    const token = await this.getAccessToken();

    const searchParams = new URLSearchParams();
    
    if (params.q) searchParams.append('q', params.q);
    if (params.category_ids) searchParams.append('category_ids', params.category_ids);
    if (params.gtin) searchParams.append('gtin', params.gtin);
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.offset) searchParams.append('offset', params.offset.toString());
    if (params.sort) searchParams.append('sort', params.sort);
    if (params.filter) searchParams.append('filter', params.filter);
    if (params.fieldgroups) searchParams.append('fieldgroups', params.fieldgroups);
    if (params.aspect_filter) searchParams.append('aspect_filter', params.aspect_filter);
    if (params.epid) searchParams.append('epid', params.epid);
    if (params.auto_correct) searchParams.append('auto_correct', params.auto_correct);

    const url = `${this.apiBase}/item_summary/search?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get trending/popular items from eBay
   * eBay doesn't have a dedicated trending endpoint, so we'll search for popular items
   */
  async getTrendingProducts(): Promise<EbaySearchResponse> {
    const token = await this.getAccessToken();

    // Search for items with high popularity and recent listings
    const searchParams = new URLSearchParams({
      limit: '25',
      sort: 'newlyListed',
      filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW}',
    });

    const url = `${this.apiBase}/item_summary/search?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay trending API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }
}

export const ebayAPI = new EbayAPI(
  process.env.EBAY_CLIENT_ID || '',
  process.env.EBAY_CLIENT_SECRET || ''
);
