import { NextResponse } from 'next/server';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { normalizeBestBuyTrendingProduct, normalizeTargetProduct, normalizeEbayProduct, UnifiedProduct } from '@/types/unified';

export async function GET() {
  try {
    const [bestBuyData, targetData, ebayData] = await Promise.allSettled([
      bestBuyAPI.getTrendingProducts(),
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

    // Randomly shuffle the items using Fisher-Yates algorithm
    for (let i = unifiedItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unifiedItems[i], unifiedItems[j]] = [unifiedItems[j], unifiedItems[i]];
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
