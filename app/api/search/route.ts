import { NextRequest, NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { WalmartSearchParams } from '@/types/walmart';

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

    const params: WalmartSearchParams = {
      query,
      sort: (searchParams.get('sort') as any) || 'relevance',
      order: (searchParams.get('order') as any) || undefined,
      start: searchParams.get('start') ? parseInt(searchParams.get('start')!) : undefined,
      numItems: searchParams.get('numItems') ? parseInt(searchParams.get('numItems')!) : 25,
      categoryId: searchParams.get('categoryId') || undefined,
    };

    const results = await walmartAPI.searchProducts(params);

    return NextResponse.json(results);
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Failed to search products', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
