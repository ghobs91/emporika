import { NextRequest, NextResponse } from 'next/server';
import { costcoCookieCache } from '@/lib/costco-cookie-cache';
import { fetchCostcoCookies } from '@/lib/costco-cookie-fetcher';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Verify authorization (optional but recommended)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.COSTCO_REFRESH_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Starting Costco cookie refresh...');
    
    const cookieString = await fetchCostcoCookies();
    
    if (!cookieString) {
      throw new Error('Failed to fetch cookies from Costco');
    }
    
    const timeUntilExpiration = costcoCookieCache.getTimeUntilExpiration();
    
    return NextResponse.json({
      success: true,
      message: 'Cookies refreshed successfully',
      validFor: Math.floor(timeUntilExpiration / 1000),
      expiresAt: new Date(Date.now() + timeUntilExpiration).toISOString(),
    });
    
  } catch (error) {
    console.error('Error refreshing Costco cookies:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh cookies',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check cookie status
export async function GET() {
  const isValid = costcoCookieCache.isValid();
  const timeUntilExpiration = costcoCookieCache.getTimeUntilExpiration();
  
  return NextResponse.json({
    isValid,
    timeUntilExpiration: Math.floor(timeUntilExpiration / 1000), // in seconds
    expiresAt: isValid ? new Date(Date.now() + timeUntilExpiration).toISOString() : null,
  });
}
