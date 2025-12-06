import { NextRequest, NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { WalmartSearchParams } from '@/types/walmart';
import { 
  UnifiedSearchResponse, 
  normalizeWalmartProduct, 
  normalizeBestBuyProduct, 
  normalizeTargetProduct,
  UnifiedProduct 
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

    const numItems = searchParams.get('numItems') ? parseInt(searchParams.get('numItems')!) : 25;
    const itemsPerSource = Math.ceil(numItems / 3);
    
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

    // Fetch from all APIs concurrently
    const [walmartResult, bestBuyResult, targetResult] = await Promise.allSettled([
      walmartAPI.searchProducts(walmartParams),
      bestBuyAPI.searchProducts({ query, pageSize: itemsPerSource }),
      targetAPI.searchProducts({ 
        query, 
        count: itemsPerSource,
        store_id: targetStoreId || undefined,
        zip: targetZip || undefined,
      }),
    ]);

    const unifiedProducts: UnifiedProduct[] = [];
    const sources: UnifiedSearchResponse['sources'] = {};

    // Process Walmart results
    if (walmartResult.status === 'fulfilled') {
      const walmartProducts = walmartResult.value.items?.map(normalizeWalmartProduct) || [];
      unifiedProducts.push(...walmartProducts);
      sources.walmart = { count: walmartProducts.length };
    } else {
      console.error('Walmart API error:', walmartResult.reason);
      sources.walmart = { count: 0, error: walmartResult.reason?.message || 'Failed to fetch from Walmart' };
    }

    // Process Best Buy results
    if (bestBuyResult.status === 'fulfilled') {
      const bestBuyProducts = bestBuyResult.value.products?.map(normalizeBestBuyProduct) || [];
      unifiedProducts.push(...bestBuyProducts);
      sources.bestbuy = { count: bestBuyProducts.length };
    } else {
      console.error('Best Buy API error:', bestBuyResult.reason);
      sources.bestbuy = { count: 0, error: bestBuyResult.reason?.message || 'Failed to fetch from Best Buy' };
    }

    // Process Target results
    if (targetResult.status === 'fulfilled') {
      const targetProducts = targetResult.value.data?.search?.products?.map((product, index) => 
        normalizeTargetProduct(product, index)
      ) || [];
      unifiedProducts.push(...targetProducts);
      sources.target = { count: targetProducts.length };
    } else {
      console.error('Target API error:', targetResult.reason);
      sources.target = { count: 0, error: targetResult.reason?.message || 'Failed to fetch from Target' };
    }

    // Interleave products from different sources for better UX
    const interleavedProducts = interleaveProducts(unifiedProducts);

    const response: UnifiedSearchResponse = {
      query,
      totalResults: unifiedProducts.length,
      items: interleavedProducts,
      sources,
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

// Interleave products from different sources
function interleaveProducts(products: UnifiedProduct[]): UnifiedProduct[] {
  const walmartProducts = products.filter(p => p.source === 'walmart');
  const bestBuyProducts = products.filter(p => p.source === 'bestbuy');
  const targetProducts = products.filter(p => p.source === 'target');
  
  const result: UnifiedProduct[] = [];
  const maxLength = Math.max(walmartProducts.length, bestBuyProducts.length, targetProducts.length);
  
  for (let i = 0; i < maxLength; i++) {
    if (i < walmartProducts.length) {
      result.push(walmartProducts[i]);
    }
    if (i < bestBuyProducts.length) {
      result.push(bestBuyProducts[i]);
    }
    if (i < targetProducts.length) {
      result.push(targetProducts[i]);
    }
  }
  
  return result;
}
