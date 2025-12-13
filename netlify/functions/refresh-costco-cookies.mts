import type { Config } from '@netlify/functions';

// This function runs every hour to keep cookies fresh
export default async (req: Request) => {
  try {
    // Get the site URL from environment
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:3000';
    
    // Call the refresh endpoint
    const response = await fetch(`${siteUrl}/api/costco/refresh-cookie`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to refresh cookies');
    }

    console.log('Costco cookies refreshed successfully:', result);

    return new Response(JSON.stringify({
      success: true,
      message: 'Cookies refreshed',
      details: result,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error refreshing Costco cookies:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = {
  schedule: '0 * * * *', // Run every hour
};
