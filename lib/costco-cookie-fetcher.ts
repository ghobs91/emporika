import { costcoCookieCache } from './costco-cookie-cache';

/**
 * Fetch fresh Costco cookies by making a request to Costco's homepage
 * This generates the bot detection cookies (ak_bmsc and bm_sz) needed for the API
 */
export async function fetchCostcoCookies(): Promise<string | null> {
  try {
    // Make a simple request to Costco to trigger cookie generation
    const response = await fetch('https://www.costco.com', {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Extract cookies from Set-Cookie headers
    const setCookieHeaders = response.headers.getSetCookie();
    
    if (!setCookieHeaders || setCookieHeaders.length === 0) {
      console.warn('No cookies received from Costco');
      return null;
    }

    // Parse cookies and filter for the ones we need
    const cookies: { name: string; value: string; maxAge: number }[] = [];
    
    for (const cookieHeader of setCookieHeaders) {
      const parts = cookieHeader.split(';');
      const [nameValue] = parts;
      const [name, value] = nameValue.split('=');
      
      if (name === 'ak_bmsc' || name === 'bm_sz') {
        // Extract Max-Age
        const maxAgePart = parts.find(p => p.trim().startsWith('Max-Age='));
        const maxAge = maxAgePart 
          ? parseInt(maxAgePart.split('=')[1]) 
          : 7200; // default 2 hours
        
        cookies.push({ name: name.trim(), value: value.trim(), maxAge });
      }
    }

    if (cookies.length === 0) {
      console.warn('Required cookies (ak_bmsc, bm_sz) not found');
      return null;
    }

    // Format cookies as header string
    const cookieString = cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    // Get the shortest max age for cache expiration
    const minMaxAge = Math.min(...cookies.map(c => c.maxAge));

    // Cache the cookies
    costcoCookieCache.set(cookieString, minMaxAge);

    console.log(`Fetched Costco cookies: ${cookies.map(c => c.name).join(', ')}`);
    console.log(`Valid for ${minMaxAge} seconds`);

    return cookieString;

  } catch (error) {
    console.error('Error fetching Costco cookies:', error);
    return null;
  }
}
