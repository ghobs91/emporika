interface CachedCookie {
  value: string;
  expiresAt: number;
}

// Extend global type for Next.js dev mode persistence
declare global {
  var __costcoCookieCache: CachedCookie | null | undefined;
}

class CostcoCookieCache {
  private cache: CachedCookie | null = null;

  set(cookieString: string, maxAgeSeconds: number = 7200): void {
    // Set expiration to 90% of max age to refresh before actual expiration
    const safeMaxAge = Math.floor(maxAgeSeconds * 0.9);
    this.cache = {
      value: cookieString,
      expiresAt: Date.now() + (safeMaxAge * 1000),
    };
    
    // Also store in global for Next.js dev mode
    global.__costcoCookieCache = this.cache;
    
    console.log(`Costco cookie cached, expires in ${safeMaxAge} seconds`);
  }

  get(): string | null {
    // Try instance cache first
    if (!this.cache) {
      // Restore from global in dev mode
      this.cache = global.__costcoCookieCache || null;
    }
    
    if (!this.cache) {
      return null;
    }

    if (Date.now() >= this.cache.expiresAt) {
      console.log('Costco cookie expired, clearing cache');
      this.cache = null;
      global.__costcoCookieCache = null;
      return null;
    }

    return this.cache.value;
  }

  isValid(): boolean {
    return this.get() !== null;
  }

  clear(): void {
    this.cache = null;
    global.__costcoCookieCache = null;
  }

  getTimeUntilExpiration(): number {
    if (!this.cache) {
      return 0;
    }
    return Math.max(0, this.cache.expiresAt - Date.now());
  }
}

// Singleton instance
export const costcoCookieCache = new CostcoCookieCache();
