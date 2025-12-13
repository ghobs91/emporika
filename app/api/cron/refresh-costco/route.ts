import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// This endpoint is called by Vercel Cron or other cron services
// Configuration for Vercel Cron should be in vercel.json
export async function GET(request: NextRequest) {
  try {
    // Verify authorization from cron service
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the base URL for the API call
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Call the refresh-cookie endpoint
    const refreshUrl = `${baseUrl}/api/costco/refresh-cookie`;
    
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cronSecret && { 'Authorization': `Bearer ${cronSecret}` }),
      },
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to refresh cookies');
    }

    return NextResponse.json({
      success: true,
      message: 'Costco cookies refreshed via cron',
      details: result,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      {
        error: 'Cron job failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
