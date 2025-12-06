import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { walmartAPI } from '@/lib/walmart';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { normalizeBestBuyTrendingProduct, normalizeWalmartProduct, normalizeTargetProduct, normalizeEbayProduct, UnifiedProduct } from '@/types/unified';

export async function GET() {
  try {
    const [bestBuyData, walmartData, targetData, ebayData] = await Promise.allSettled([
      bestBuyAPI.getTrendingProducts(),
      walmartAPI.getTrendingItems(),
      targetAPI.getTrendingProducts(),
      ebayAPI.getTrendingProducts(),
    ]);

    const unifiedItems: UnifiedProduct[] = [];

    // Add Best Buy trending items
    if (bestBuyData.status === 'fulfilled') {
      const bestBuyItems = (bestBuyData.value.results || []).map(normalizeBestBuyTrendingProduct);
      unifiedItems.push(...bestBuyItems);
    } else {
      console.error('Best Buy trending error:', bestBuyData.reason);
    }

    // Add Walmart trending items
    if (walmartData.status === 'fulfilled') {
      const walmartItems = (walmartData.value.items || []).map(normalizeWalmartProduct);
      unifiedItems.push(...walmartItems);
    } else {
      console.error('Walmart trending error:', walmartData.reason);
    }

    // Add Target trending items
    if (targetData.status === 'fulfilled') {
      const targetProducts = targetData.value.data?.search?.products || [];
      const targetItems = targetProducts.map((product, index) => normalizeTargetProduct(product, index));
      unifiedItems.push(...targetItems);
    } else {
      console.error('Target trending error:', targetData.reason);
    }

    // Add eBay trending items
    if (ebayData.status === 'fulfilled') {
      const ebayItems = (ebayData.value.itemSummaries || []).map(normalizeEbayProduct);
      unifiedItems.push(...ebayItems);
    } else {
      console.error('eBay trending error:', ebayData.reason);
    }

    return NextResponse.json({ items: unifiedItems });
  } catch (error) {
    console.error('Trending items error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending items' },
      { status: 500 }
    );
  }
}
