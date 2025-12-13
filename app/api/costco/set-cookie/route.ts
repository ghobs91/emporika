import { NextRequest, NextResponse } from 'next/server';
import { costcoCookieCache } from '@/lib/costco-cookie-cache';

export const dynamic = 'force-dynamic';

// Manual cookie setting endpoint for when Playwright doesn't work
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cookies, maxAge } = body;

    if (!cookies || typeof cookies !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid cookies parameter' },
        { status: 400 }
      );
    }

    // Default to 2 hours (7200 seconds) if not specified
    const maxAgeSeconds = maxAge || 7200;

    // Cache the cookies
    costcoCookieCache.set(cookies, maxAgeSeconds);

    return NextResponse.json({
      success: true,
      message: 'Cookies set successfully',
      validFor: maxAgeSeconds,
      expiresAt: new Date(Date.now() + maxAgeSeconds * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Error setting cookies:', error);
    return NextResponse.json(
      {
        error: 'Failed to set cookies',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
