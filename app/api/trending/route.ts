import { NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';

export async function GET() {
  try {
    const data = await walmartAPI.getTrendingItems();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Trending items error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trending items' },
      { status: 500 }
    );
  }
}
