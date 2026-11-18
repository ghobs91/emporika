import { NextRequest, NextResponse } from 'next/server';
import { giftSearchRequestSchema } from '@/search/gift/request';
import { executeGiftIntents } from '@/search/gift/orchestrator';

/**
 * POST /api/gift/ideas
 *
 * Runs a set of gift searches the *browser* compiled from a recipient profile.
 * The profile itself never reaches this endpoint — only query strings, labels
 * and per-search constraints (see `search/gift/request.ts`). No model is
 * called here either; ranking happens client-side.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = giftSearchRequestSchema.safeParse(body);

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

    const result = await executeGiftIntents(parsed.data);

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
