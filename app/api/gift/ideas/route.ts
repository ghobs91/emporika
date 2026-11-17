import { NextRequest, NextResponse } from 'next/server';
import { giftIdeasRequestSchema } from '@/search/gift/schema';
import { executeGiftSearch } from '@/search/gift/orchestrator';

/**
 * POST /api/gift/ideas
 *
 * Deterministic gift search for one saved recipient. The recipient's
 * gender/age/interests are compiled against the checked-in gift index into
 * concrete searches, which run through the normal pipeline and are
 * interleaved into one "gift ideas" list.
 *
 * No model is called here — that is the point of the feature.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = giftIdeasRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: 'error',
          error: 'Invalid gift request',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }

    const result = await executeGiftSearch(parsed.data);

    if (result.status === 'error') {
      return NextResponse.json(result, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Gift ideas API error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: 'Gift search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
