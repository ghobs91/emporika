import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { walmartAPI } from '@/lib/walmart';
import { searchShopifyProducts, convertShopifyToUnified, extractUPID } from '@/lib/shopify';
import { normalizeBestBuyTrendingProduct, normalizeTargetProduct, normalizeWalmartProduct, UnifiedProduct } from '@/types/unified';
import { ProductCategory } from '@/types/categories';
import { groupProductsByCategory } from '@/lib/categorize-product';
import { BestBuyTrendingResponse } from '@/types/bestbuy';
import { TargetSearchResponse } from '@/types/target';
import { WalmartSearchResponse } from '@/types/walmart';
import { TargetProduct } from '@/types/target';
import type { ShopifySearchResponse } from '@/types/shopify';

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
    
    // Shopify Global Catalog — searches for each trending product category
    const shopifyCategoryQueries: { category: ProductCategory; query: string }[] = [
      { category: 'electronics', query: 'headphones' },
      { category: 'home', query: 'home decor' },
      { category: 'fashion', query: 'shoes' },
      { category: 'sports', query: 'fitness' },
      { category: 'toys', query: 'toys' },
    ];
    const shopifyCalls = shopifyCategoryQueries.map(({ query }) =>
      timeoutPromise(
        searchShopifyProducts({
          query,
          filters: {
            ships_to: { country: 'US' },
            available: true,
            rating: { variant: { min: 4.5, min_count: 50 } },
          },
          pagination: { limit: 50 },
          context: { address_country: 'US' },
        }),
        20000
      )
    );
    console.log(`Adding Shopify Global Catalog searches: ${shopifyCategoryQueries.map(c => c.query).join(', ')}`);
    
    // Fetch from all retailers in parallel (Shopify runs in parallel alongside)
    const [results, ...shopifyResultsArr] = await Promise.all([
      Promise.allSettled(apiCalls),
      ...shopifyCalls.map((p) => p.then((v) => ({ status: 'fulfilled' as const, value: v })).catch((reason) => ({ status: 'rejected' as const, reason }))),
    ]);
    
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

    // Process Shopify Global Catalog results — dedupe by UPID across category searches
    const shopifySeen = new Set<string>();
    let shopifyTotal = 0;
    for (let i = 0; i < shopifyResultsArr.length; i++) {
      const sr = shopifyResultsArr[i];
      const expectedCategory = shopifyCategoryQueries[i].category;
      if (sr.status === 'fulfilled' && sr.value) {
        const resp = sr.value as ShopifySearchResponse | null;
        const products = resp?.products || [];
        const filtered = products.filter((p) => {
          const upid = extractUPID(p.id);
          if (!upid || shopifySeen.has(upid)) return false;
          shopifySeen.add(upid);
          return true;
        });
        const unifiedShopify = convertShopifyToUnified(filtered);
        allProducts.push(...unifiedShopify);
        shopifyTotal += unifiedShopify.length;
        console.log(`✓ Shopify (${expectedCategory}) returned ${unifiedShopify.length} highly-rated products`);
      } else {
        const reason = sr.status === 'rejected' ? sr.reason : 'No results';
        console.error(`✗ Shopify (${expectedCategory}) search failed:`,
          reason instanceof Error ? reason.message : reason);
      }
    }
    console.log(`Shopify total: ${shopifyTotal} highly-rated products across ${shopifyCategoryQueries.length} categories`);

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

    // Interleave products by source within each category.
    // Shuffle within each source bucket for variety across reloads,
    // then round-robin interleave WITHOUT a post-shuffle so the first
    // N visible slots are guaranteed to contain one from each retailer
    // that has items in that category.
    Object.keys(categorizedProducts).forEach((category) => {
      const items = categorizedProducts[category as ProductCategory];

      // Group by source
      const sourceBuckets: Record<string, UnifiedProduct[]> = {};
      for (const item of items) {
        const src = item.source;
        if (!sourceBuckets[src]) {
          sourceBuckets[src] = [];
        }
        sourceBuckets[src].push(item);
      }

      // Shuffle within each source bucket so reloads show different items
      for (const src of Object.keys(sourceBuckets)) {
        const bucket = sourceBuckets[src];
        for (let i = bucket.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = bucket[i];
          bucket[i] = bucket[j];
          bucket[j] = tmp;
        }
      }

      // Round-robin interleave across sources — no post-shuffle
      const sourceKeys = Object.keys(sourceBuckets);
      const maxLen = Math.max(...sourceKeys.map((s) => sourceBuckets[s].length));
      const interleaved: UnifiedProduct[] = [];
      for (let i = 0; i < maxLen; i++) {
        for (const src of sourceKeys) {
          if (i < sourceBuckets[src].length) {
            interleaved.push(sourceBuckets[src][i]);
          }
        }
      }

      categorizedProducts[category as ProductCategory] = interleaved;
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
