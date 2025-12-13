import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { normalizeBestBuyTrendingProduct, normalizeTargetProduct, UnifiedProduct } from '@/types/unified';

export async function GET() {
  try {
    const [bestBuyData, targetData] = await Promise.allSettled([
      bestBuyAPI.getTrendingProducts(),
      targetAPI.getTrendingProducts(),
    ]);

    const unifiedItems: UnifiedProduct[] = [];

    // Add Best Buy trending items
    if (bestBuyData.status === 'fulfilled') {
      const bestBuyItems = (bestBuyData.value.results || []).map(normalizeBestBuyTrendingProduct);
      unifiedItems.push(...bestBuyItems);
    } else {
      console.error('Best Buy trending error:', bestBuyData.reason);
    }

    // Add Target trending items
    if (targetData.status === 'fulfilled') {
      const targetProducts = targetData.value.data?.search?.products || [];
      const targetItems = targetProducts.map((product, index) => normalizeTargetProduct(product, index));
      unifiedItems.push(...targetItems);
    } else {
      console.error('Target trending error:', targetData.reason);
    }

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
