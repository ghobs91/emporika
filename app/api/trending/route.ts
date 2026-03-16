import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { walmartAPI } from '@/lib/walmart';
import { normalizeBestBuyTrendingProduct, normalizeTargetProduct, normalizeWalmartProduct, UnifiedProduct } from '@/types/unified';
import { ProductCategory } from '@/types/categories';
import { groupProductsByCategory } from '@/lib/categorize-product';
import { BestBuyTrendingResponse } from '@/types/bestbuy';
import { TargetSearchResponse } from '@/types/target';
import { WalmartSearchResponse } from '@/types/walmart';
import { TargetProduct } from '@/types/target';

// Set runtime config for serverless function
export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max

export async function GET() {
  try {
    console.log('=== Trending API called - fetching all retailer trending products ===');
    
    // Build API calls array - one call per retailer to get all trending products
    // Add timeout wrapper to prevent hanging
    const timeoutPromise = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        )
      ]);
    };

    const apiCalls: Promise<BestBuyTrendingResponse | TargetSearchResponse | WalmartSearchResponse>[] = [];
    const apiSources: string[] = [];
    
    // Walmart - use bestseller search with popular queries for variety (with timeout)
    const walmartQueries = ['headphones', 'kitchen', 'toys', 'fitness', 'tablet', 'shoes'];
    const randomWalmartQuery = walmartQueries[Math.floor(Math.random() * walmartQueries.length)];
    console.log(`Adding Walmart bestsellers with query: ${randomWalmartQuery}`);
    apiCalls.push(timeoutPromise(walmartAPI.searchProducts({ 
      query: randomWalmartQuery, 
      numItems: 25,
      sort: 'bestseller'
    }), 15000));
    apiSources.push('walmart');
    
    // Best Buy - get all trending products (with timeout)
    console.log('Adding Best Buy trending products');
    apiCalls.push(timeoutPromise(bestBuyAPI.getTrendingProducts(), 15000));
    apiSources.push('bestbuy');
    
    // Target - use search for popular items instead of broken trending endpoint
    const targetQueries = ['home decor', 'electronics', 'clothing', 'sports', 'toys'];
    const randomTargetQuery = targetQueries[Math.floor(Math.random() * targetQueries.length)];
    console.log(`Adding Target search with query: ${randomTargetQuery}`);
    apiCalls.push(timeoutPromise(targetAPI.searchProducts({ 
      query: randomTargetQuery,
      count: 24
    }), 15000));
    apiSources.push('target');
    
    console.log(`Total API calls to make: ${apiCalls.length}, sources: ${apiSources.join(', ')}`);
    
    // Fetch from all retailers in parallel
    const results = await Promise.allSettled(apiCalls);
    const allProducts: UnifiedProduct[] = [];

    // Process results from each retailer
    results.forEach((result, index) => {
      const source = apiSources[index];
      
      if (result.status === 'fulfilled') {
        try {
          if (source === 'bestbuy') {
            const bestBuyResponse = result.value as BestBuyTrendingResponse;
            const bestBuyItems = (bestBuyResponse.results || []).map(normalizeBestBuyTrendingProduct);
            console.log(`✓ Best Buy returned ${bestBuyItems.length} items`);
            allProducts.push(...bestBuyItems);
          } else if (source === 'target') {
            const targetResponse = result.value as TargetSearchResponse;
            const targetProducts = targetResponse.data?.search?.products || [];
            const targetItems = targetProducts.map((product: TargetProduct, index: number) => normalizeTargetProduct(product, index));
            console.log(`✓ Target returned ${targetItems.length} items`);
            allProducts.push(...targetItems);
          } else if (source === 'walmart') {
            const walmartResponse = result.value as WalmartSearchResponse;
            const walmartItems = (walmartResponse.items || []).map(normalizeWalmartProduct);
            console.log(`✓ Walmart returned ${walmartItems.length} items`);
            allProducts.push(...walmartItems);
          }
        } catch (error) {
          console.error(`✗ Error processing ${source} response:`, error);
          if (error instanceof Error) {
            console.error(`  Error message: ${error.message}`);
            console.error(`  Error stack: ${error.stack}`);
          }
        }
      } else {
        console.error(`✗ ${source} API call failed:`, result.reason);
        if (result.reason instanceof Error) {
          console.error(`  Reason: ${result.reason.message}`);
        }
      }
    });

    console.log(`Total items fetched: ${allProducts.length}`);

    // If no products were fetched, return empty categories to avoid frontend hanging
    if (allProducts.length === 0) {
      console.warn('No products fetched from any retailer');
      const emptyCategories: Record<ProductCategory, UnifiedProduct[]> = {
        electronics: [],
        home: [],
        fashion: [],
        sports: [],
        toys: [],
        all: [],
      };
      return NextResponse.json({ 
        categorizedProducts: emptyCategories,
      });
    }

    // Group products by category using the categorize-product utility
    const categorizedProducts = groupProductsByCategory(allProducts);
    
    console.log('Products grouped by category:', {
      electronics: categorizedProducts.electronics.length,
      home: categorizedProducts.home.length,
      fashion: categorizedProducts.fashion.length,
      sports: categorizedProducts.sports.length,
      toys: categorizedProducts.toys.length,
      all: categorizedProducts.all.length,
    });

    // Shuffle products within each category using Fisher-Yates algorithm
    Object.keys(categorizedProducts).forEach((category) => {
      const items = categorizedProducts[category as ProductCategory];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    });

    return NextResponse.json({ 
      categorizedProducts,
    });
  } catch (error) {
    console.error('Trending items error:', error);
    
    // Return empty categories instead of error to prevent frontend from hanging
    const emptyCategories: Record<ProductCategory, UnifiedProduct[]> = {
      electronics: [],
      home: [],
      fashion: [],
      sports: [],
      toys: [],
      all: [],
    };
    
    return NextResponse.json(
      { 
        categorizedProducts: emptyCategories,
        error: 'Failed to fetch trending items' 
      },
      { status: 200 } // Return 200 to allow frontend to handle gracefully
    );
  }
}
