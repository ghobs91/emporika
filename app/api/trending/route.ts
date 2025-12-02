import { NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { normalizeWalmartProduct, UnifiedProduct } from '@/types/unified';

export async function GET() {
  try {
    const data = await walmartAPI.getTrendingItems();
    const unifiedItems: UnifiedProduct[] = (data.items || []).map(normalizeWalmartProduct);
    return NextResponse.json({ items: unifiedItems });
  } catch (error) {
    console.error('Trending items error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending items' },
      { status: 500 }
    );
  }
}
