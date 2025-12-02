import { NextRequest, NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { WalmartSearchParams } from '@/types/walmart';
import { 
  UnifiedSearchResponse, 
  normalizeWalmartProduct, 
  normalizeBestBuyProduct, 
  UnifiedProduct 
} from '@/types/unified';

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
    const itemsPerSource = Math.ceil(numItems / 2);

    const walmartParams: WalmartSearchParams = {
      query,
      sort: (searchParams.get('sort') as WalmartSearchParams['sort']) || 'relevance',
      order: (searchParams.get('order') as WalmartSearchParams['order']) || undefined,
      start: searchParams.get('start') ? parseInt(searchParams.get('start')!) : undefined,
      numItems: itemsPerSource,
      categoryId: searchParams.get('categoryId') || undefined,
    };

    // Fetch from both APIs concurrently
    const [walmartResult, bestBuyResult] = await Promise.allSettled([
      walmartAPI.searchProducts(walmartParams),
      bestBuyAPI.searchProducts({ query, pageSize: itemsPerSource }),
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
  
  const result: UnifiedProduct[] = [];
  const maxLength = Math.max(walmartProducts.length, bestBuyProducts.length);
  
  for (let i = 0; i < maxLength; i++) {
    if (i < walmartProducts.length) {
      result.push(walmartProducts[i]);
    }
    if (i < bestBuyProducts.length) {
      result.push(bestBuyProducts[i]);
    }
  }
  
  return result;
}
