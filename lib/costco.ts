import { CostcoSearchParams, CostcoSearchResponse } from '@/types/costco';
import { costcoCookieCache } from './costco-cookie-cache';
import { fetchCostcoCookies } from './costco-cookie-fetcher';

const COSTCO_API_BASE = 'https://search.costco.com/api/apps/www_costco_com/query/www_costco_com_search';

export class CostcoAPI {
  private async getCookies(): Promise<string | null> {
    // Try cache first
    const cachedCookies = costcoCookieCache.get();
    if (cachedCookies) {
      console.log('Using cached Costco cookies');
      return cachedCookies;
    }
    
    // Try environment variable
    const envCookies = process.env.COSTCO_COOKIES || null;
    if (envCookies) {
      console.log('Using Costco cookies from environment');
      return envCookies;
    }
    
    // In production, try to fetch fresh cookies automatically
    console.log('No cached cookies, attempting to fetch fresh ones...');
    try {
      const freshCookies = await fetchCostcoCookies();
      if (freshCookies) {
        console.log('Successfully fetched fresh Costco cookies');
        return freshCookies;
      }
    } catch (error) {
      console.error('Failed to fetch fresh cookies:', error);
    }
    
    console.log('No Costco cookies found in cache or environment');
    return null;
  }

  private async isAvailable(): Promise<boolean> {
    const cookies = await this.getCookies();
    return !!cookies;
  }

  async searchProducts(params: CostcoSearchParams): Promise<CostcoSearchResponse> {
    // Check if cookies are available (and fetch if needed)
    if (!(await this.isAvailable())) {
      console.warn('Costco API: No cookies configured, skipping search');
      return { response: { numFound: 0, start: 0, docs: [] } };
    }
    // Build search params
    const searchParams = new URLSearchParams({
      expoption: 'lucidworks',
      q: params.query,
      locale: params.locale || 'en-US',
      start: (params.start || 0).toString(),
      expand: 'false',
      userLocation: params.userLocation || 'CA',
      rows: (params.rows || 24).toString(),
      chdcategory: 'true',
      chdheader: 'true',
    });

    // Add default location string (this appears to be warehouse/location codes)
    // Using a simplified version based on the example URL
    const locParam = '729-bd,237-wh,1260-3pl,1321-wm,1474-3pl,283-wm,561-wm,725-wm,731-wm,758-wm,759-wm,847_0-cor,847_0-cwt,847_0-edi,847_0-ehs,847_0-membership,847_0-mpt,847_0-spc,847_0-wm,847_1-cwt,847_1-edi,847_d-fis,847_lg_n1a-edi,847_lux_us81-edi,847_NA-cor,847_NA-pharmacy,847_NA-wm,847_ss_u360-edi,847_wp_r428-edi,951-wm,952-wm,9847-wcs';
    searchParams.append('loc', locParam);
    searchParams.append('whloc', '237-wh');
    
    // Add filter for ShipIt eligible items
    searchParams.append('fq', '{!tag=item_program_eligibility}item_program_eligibility:("ShipIt")');

    const url = `${COSTCO_API_BASE}?${searchParams.toString()}`;

    try {
      const cookies = await this.getCookies();
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.7',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'Referer': 'https://www.costco.com/',
          'Origin': 'https://www.costco.com',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site',
          'x-api-key': process.env.COSTCO_API_KEY || '273db6be-f015-4de7-b0d6-dd4746ccd5c3',
          ...(cookies && { 'Cookie': cookies }),
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Costco API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      console.error('Costco API error:', error);
      throw error;
    }
  }
}

export const costcoAPI = new CostcoAPI();
