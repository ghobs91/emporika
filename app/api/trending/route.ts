import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { walmartAPI } from '@/lib/walmart';
import { normalizeBestBuyTrendingProduct, normalizeWalmartProduct, UnifiedProduct } from '@/types/unified';

export async function GET() {
  try {
    const [bestBuyData, walmartData] = await Promise.allSettled([
      bestBuyAPI.getTrendingProducts(),
      walmartAPI.getTrendingItems(),
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

    return NextResponse.json({ items: unifiedItems });
  } catch (error) {
    console.error('Trending items error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending items' },
      { status: 500 }
    );
  }
}
