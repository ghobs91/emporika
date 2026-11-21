import { NextRequest, NextResponse } from 'next/server';
import { targetAPI } from '@/lib/target';
import { getDisablement } from '@/search/providers/availability';

export async function GET(request: NextRequest) {
  try {
    // Target's store lookup goes through the same edge-blocked Redsky host, so
    // while Target is disabled there is nothing to gain from the request and a
    // 15s timeout to lose. `useTargetStore` degrades to the ZIP alone, which is
    // what every other retailer actually needs.
    const disablement = getDisablement('target');
    if (disablement) {
      return NextResponse.json(
        { error: disablement.reason, blockedBy: disablement.blockedBy },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const zip = searchParams.get('zip');

    if (!zip) {
      return NextResponse.json(
        { error: 'ZIP code parameter is required' },
        { status: 400 }
      );
    }

    // Validate ZIP code format (US ZIP codes)
    const zipRegex = /^\d{5}(-\d{4})?$/;
    if (!zipRegex.test(zip)) {
      return NextResponse.json(
        { error: 'Invalid ZIP code format' },
        { status: 400 }
      );
    }

    const storeInfo = await targetAPI.getNearestStore(zip);

    if (!storeInfo) {
      return NextResponse.json(
        { error: 'No nearby Target stores found' },
        { status: 404 }
      );
    }

    return NextResponse.json(storeInfo);
  } catch (error) {
    console.error('Nearest store API error:', error);
    return NextResponse.json(
      { error: 'Failed to find nearest store', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
