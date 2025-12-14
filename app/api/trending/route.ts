import { NextRequest, NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { normalizeBestBuyTrendingProduct, normalizeTargetProduct, UnifiedProduct } from '@/types/unified';
import { getCategoryConfig, ProductCategory } from '@/types/categories';
import { BestBuyTrendingResponse } from '@/types/bestbuy';
import { TargetSearchResponse } from '@/types/target';
import { TargetProduct } from '@/types/target';

export async function GET(request: NextRequest) {
  try {
    // Get category parameter from query string
    const searchParams = request.nextUrl.searchParams;
    const categoryParam = searchParams.get('category') as ProductCategory | null;
    const category = categoryParam || 'all';
    
    console.log(`=== Trending API called with category: ${category} ===`);
    
    // Get category configuration
    const categoryConfig = getCategoryConfig(category);
    console.log('Category config:', {
      id: categoryConfig.id,
      bestBuyCategory: categoryConfig.bestBuyCategory,
      targetQuery: categoryConfig.targetQuery,
      ebayId: categoryConfig.ebayId,
    });
    
    // Build API calls array - only include APIs that support this category
    const apiCalls: Promise<BestBuyTrendingResponse | TargetSearchResponse>[] = [];
    const apiSources: string[] = [];
    
    // Add Best Buy only for electronics and toys (their main categories)
    if (category === 'electronics' || category === 'toys' || category === 'home' || category === 'all') {
      console.log(`Adding Best Buy for category: ${category}`);
      apiCalls.push(bestBuyAPI.getTrendingProducts());
      apiSources.push('bestbuy');
    }
    
    // Add Target if category is supported (has targetQuery defined and not empty)
    if (categoryConfig.targetQuery && categoryConfig.targetQuery.trim() !== '') {
      console.log(`Adding Target with query: ${categoryConfig.targetQuery}`);
      apiCalls.push(targetAPI.getTrendingProducts(categoryConfig.targetQuery));
      apiSources.push('target');
    } else if (category === 'all') {
      // Include Target for 'all' category with no filter
      console.log('Adding Target for "all" category');
      apiCalls.push(targetAPI.getTrendingProducts());
      apiSources.push('target');
    }
    
    console.log(`Total API calls to make: ${apiCalls.length}, sources: ${apiSources.join(', ')}`);
    
    // Fetch from all applicable APIs
    const results = await Promise.allSettled(apiCalls);
    const unifiedItems: UnifiedProduct[] = [];

    // Process results based on which APIs were called
    results.forEach((result, index) => {
      const source = apiSources[index];
      
      if (result.status === 'fulfilled') {
        try {
          if (source === 'bestbuy') {
            const bestBuyResponse = result.value as BestBuyTrendingResponse;
            const bestBuyItems = (bestBuyResponse.results || []).map(normalizeBestBuyTrendingProduct);
            console.log(`Best Buy returned ${bestBuyItems.length} items for category: ${category}`);
            unifiedItems.push(...bestBuyItems);
          } else if (source === 'target') {
            const targetResponse = result.value as TargetSearchResponse;
            const targetProducts = targetResponse.data?.search?.products || [];
            const targetItems = targetProducts.map((product: TargetProduct) => normalizeTargetProduct(product, 0));
            console.log(`Target returned ${targetItems.length} items for category: ${category}`);
            unifiedItems.push(...targetItems);

          }
        } catch (error) {
          console.error(`Error processing ${source} response for category ${category}:`, error);
        }
      } else {
        console.error(`${source} trending error for category ${category}:`, result.reason);
      }
    });

    console.log(`Total items before shuffle: ${unifiedItems.length} for category: ${category}`);

    // Randomly shuffle the items using Fisher-Yates algorithm
    for (let i = unifiedItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unifiedItems[i], unifiedItems[j]] = [unifiedItems[j], unifiedItems[i]];
    }

    return NextResponse.json({ 
      items: unifiedItems,
    });
  } catch (error) {
    console.error('Trending items error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending items' },
      { status: 500 }
    );
  }
}
