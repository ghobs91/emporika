import { NextRequest, NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { costcoAPI } from '@/lib/costco';
import { searchShopifyProducts, convertShopifyToUnified } from '@/lib/shopify';
import { WalmartSearchParams } from '@/types/walmart';
import { 
  UnifiedSearchResponse, 
  normalizeWalmartProduct, 
  normalizeBestBuyProduct, 
  normalizeTargetProduct,
  normalizeEbayProduct,
  normalizeCostcoProduct,
  UnifiedProduct,
  RetailerSource,
} from '@/types/unified';

const VALID_SORT_VALUES = ['relevance', 'price', 'title', 'bestseller', 'customerRating', 'new'] as const;
const VALID_ORDER_VALUES = ['ascending', 'descending'] as const;

type ValidSortValue = typeof VALID_SORT_VALUES[number];
type ValidOrderValue = typeof VALID_ORDER_VALUES[number];

function isValidSort(value: string | null): value is ValidSortValue {
  return value !== null && VALID_SORT_VALUES.includes(value as ValidSortValue);
}

function isValidOrder(value: string | null): value is ValidOrderValue {
  return value !== null && VALID_ORDER_VALUES.includes(value as ValidOrderValue);
}

function parseSources(param: string | null): RetailerSource[] {
  if (!param) return ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];
  const valid: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];
  return param
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RetailerSource => valid.includes(s as RetailerSource));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query');

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    const sources = parseSources(searchParams.get('sources'));
    const numItems = searchParams.get('numItems') ? parseInt(searchParams.get('numItems')!) : 120;
    // Each source should return at least 20 items so we get meaningful results
    // regardless of how many sources are selected.
    const itemsPerSource = Math.max(20, Math.ceil(numItems / Math.max(sources.length, 1)));
    
    // Get Target-specific parameters
    const targetStoreId = searchParams.get('targetStoreId');
    const targetZip = searchParams.get('targetZip');

    const sortParam = searchParams.get('sort');
    const orderParam = searchParams.get('order');

    const walmartParams: WalmartSearchParams = {
      query,
      sort: isValidSort(sortParam) ? sortParam : 'relevance',
      order: isValidOrder(orderParam) ? orderParam : undefined,
      start: searchParams.get('start') ? parseInt(searchParams.get('start')!) : undefined,
      numItems: itemsPerSource,
      categoryId: searchParams.get('categoryId') || undefined,
    };

    // Build fetch promises only for selected sources
    const fetchers: Promise<SettledResult>[] = [];

    const walmartPromise = sources.includes('walmart')
      ? walmartAPI.searchProducts(walmartParams)
      : Promise.resolve(null);
    fetchers.push(walmartPromise);

    const bestBuyPromise = sources.includes('bestbuy')
      ? bestBuyAPI.searchProducts({ query, pageSize: itemsPerSource })
      : Promise.resolve(null);
    fetchers.push(bestBuyPromise);

    const targetPromise = sources.includes('target')
      ? targetAPI.searchProducts({ 
          query, 
          count: itemsPerSource,
          store_id: targetStoreId || undefined,
          zip: targetZip || undefined,
        })
      : Promise.resolve(null);
    fetchers.push(targetPromise);

    const ebayPromise = sources.includes('ebay')
      ? ebayAPI.searchProducts({ 
          q: query, 
          limit: itemsPerSource,
          fieldgroups: 'EXTENDED',
        })
      : Promise.resolve(null);
    fetchers.push(ebayPromise);

    const costcoPromise = sources.includes('costco')
      ? costcoAPI.searchProducts({
          query,
          rows: itemsPerSource,
        })
      : Promise.resolve(null);
    fetchers.push(costcoPromise);

    const shopifyPromise = sources.includes('shopify')
      ? searchShopifyProducts({
          query,
          pagination: { limit: itemsPerSource },
          filters: {
            ships_to: { country: 'US' },
            available: true,
          },
        })
      : Promise.resolve(null);
    fetchers.push(shopifyPromise);

    const [walmartResult, bestBuyResult, targetResult, ebayResult, costcoResult, shopifyResult] =
      await Promise.allSettled(fetchers);

    const unifiedProducts: UnifiedProduct[] = [];
    const sources_: UnifiedSearchResponse['sources'] = {};

    // Process Walmart results
    if (sources.includes('walmart')) {
      const result = walmartResult as PromiseSettledResult<Awaited<ReturnType<typeof walmartAPI.searchProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = result.value.items?.map(normalizeWalmartProduct) || [];
        unifiedProducts.push(...products);
        sources_.walmart = { count: products.length };
      } else {
        console.error('Walmart API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.walmart = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from Walmart' };
      }
    }

    // Process Best Buy results
    if (sources.includes('bestbuy')) {
      const result = bestBuyResult as PromiseSettledResult<Awaited<ReturnType<typeof bestBuyAPI.searchProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = result.value.products?.map(normalizeBestBuyProduct) || [];
        unifiedProducts.push(...products);
        sources_.bestbuy = { count: products.length };
      } else {
        console.error('Best Buy API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.bestbuy = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from Best Buy' };
      }
    }

    // Process Target results
    if (sources.includes('target')) {
      const result = targetResult as PromiseSettledResult<Awaited<ReturnType<typeof targetAPI.searchProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = result.value.data?.search?.products?.map((product, index) => 
          normalizeTargetProduct(product, index)
        ) || [];
        unifiedProducts.push(...products);
        sources_.target = { count: products.length };
      } else {
        console.error('Target API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.target = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from Target' };
      }
    }

    // Process eBay results
    if (sources.includes('ebay')) {
      const result = ebayResult as PromiseSettledResult<Awaited<ReturnType<typeof ebayAPI.searchProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = result.value.itemSummaries?.map(normalizeEbayProduct) || [];
        unifiedProducts.push(...products);
        sources_.ebay = { count: products.length };
      } else {
        console.error('eBay API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.ebay = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from eBay' };
      }
    }

    // Process Costco results
    if (sources.includes('costco')) {
      const result = costcoResult as PromiseSettledResult<Awaited<ReturnType<typeof costcoAPI.searchProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = result.value.response?.docs?.map(normalizeCostcoProduct) || [];
        unifiedProducts.push(...products);
        sources_.costco = { count: products.length };
      } else {
        console.error('Costco API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.costco = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from Costco' };
      }
    }

    // Process Shopify results
    if (sources.includes('shopify')) {
      const result = shopifyResult as PromiseSettledResult<Awaited<ReturnType<typeof searchShopifyProducts>>>;
      if (result.status === 'fulfilled' && result.value) {
        const products = convertShopifyToUnified(result.value.products || []);
        unifiedProducts.push(...products);
        sources_.shopify = { count: products.length };
      } else {
        console.error('Shopify API error:', result.status === 'rejected' ? result.reason : 'null result');
        sources_.shopify = { count: 0, error: result.status === 'rejected' ? result.reason?.message : 'Failed to fetch from Shopify' };
      }
    }

    // Interleave products from different sources for better UX
    const interleavedProducts = interleaveProducts(unifiedProducts);

    const response: UnifiedSearchResponse = {
      query,
      totalResults: unifiedProducts.length,
      items: interleavedProducts,
      sources: sources_,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Failed to search products', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper type for the settled results
type SettledResult = unknown;

// Interleave products from different sources
function interleaveProducts(products: UnifiedProduct[]): UnifiedProduct[] {
  const sourceBuckets: Record<RetailerSource, UnifiedProduct[]> = {
    walmart: products.filter(p => p.source === 'walmart'),
    bestbuy: products.filter(p => p.source === 'bestbuy'),
    target: products.filter(p => p.source === 'target'),
    ebay: products.filter(p => p.source === 'ebay'),
    costco: products.filter(p => p.source === 'costco'),
    shopify: products.filter(p => p.source === 'shopify'),
  };
  
  const sources: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];
  const result: UnifiedProduct[] = [];
  const maxLength = Math.max(...sources.map(s => sourceBuckets[s].length));
  
  for (let i = 0; i < maxLength; i++) {
    for (const source of sources) {
      if (i < sourceBuckets[source].length) {
        result.push(sourceBuckets[source][i]);
      }
    }
  }
  
  return result;
}
