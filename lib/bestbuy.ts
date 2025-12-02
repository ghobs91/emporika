import { BestBuySearchParams, BestBuySearchResponse } from '@/types/bestbuy';

const BESTBUY_API_BASE = 'https://api.bestbuy.com/v1/products';

export class BestBuyAPI {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchProducts(params: BestBuySearchParams): Promise<BestBuySearchResponse> {
    if (!this.apiKey) {
      throw new Error('Best Buy API key is not configured');
    }

    const searchParams = new URLSearchParams({
      apiKey: this.apiKey,
      format: 'json',
      ...(params.pageSize && { pageSize: params.pageSize.toString() }),
      ...(params.page && { page: params.page.toString() }),
      ...(params.sort && { sort: params.sort }),
      show: params.show || 'sku,name,type,regularPrice,salePrice,onSale,url,addToCartUrl,image,thumbnailImage,mediumImage,largeFrontImage,customerReviewAverage,customerReviewCount,shortDescription,longDescription,manufacturer,modelNumber,upc,categoryPath,freeShipping,inStoreAvailability,onlineAvailability',
    });

    // Best Buy API uses a special search syntax: (search=query)
    const encodedQuery = encodeURIComponent(params.query);
    const url = `${BESTBUY_API_BASE}((search=${encodedQuery}))?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Best Buy API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }
}

export const bestBuyAPI = new BestBuyAPI(
  process.env.BESTBUY_API_KEY || ''
);
