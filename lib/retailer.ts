import type { RetailerSource } from '@/types/unified';

export interface RetailerInfo {
  label: string;
  favicon: string;
}

/** Shared display metadata (name + favicon) for the six supported retailers. */
export function getRetailerInfo(source: RetailerSource): RetailerInfo {
  switch (source) {
    case 'walmart':
      return { label: 'Walmart', favicon: '/walmart-favicon.png' };
    case 'target':
      return { label: 'Target', favicon: '/target-favicon.png' };
    case 'bestbuy':
      return { label: 'Best Buy', favicon: '/bestbuy-favicon.png' };
    case 'ebay':
      return { label: 'eBay', favicon: '/favicon-ebay.png' };
    case 'costco':
      return { label: 'Costco', favicon: '/costco-favicon.png' };
    case 'shopify':
      return { label: 'Shopify', favicon: '/shopify-logo.svg' };
    default:
      return { label: source, favicon: '' };
  }
}

/** Explore-page href listing only products from a single retailer. */
export function retailerExploreHref(source: RetailerSource): string {
  return `/explore?source=${encodeURIComponent(source)}`;
}

/**
 * Explore-page href for a specific Shopify merchant storefront. Passing the
 * storefront domain lets the explore feed scope the Shopify catalog search to
 * that merchant; the name is used as a display label and fallback match.
 */
export function merchantExploreHref(sellerName: string, sellerDomain?: string): string {
  const params = new URLSearchParams({ source: 'shopify', merchant: sellerName });
  if (sellerDomain) params.set('merchantDomain', sellerDomain);
  return `/explore?${params.toString()}`;
}

/** Explore-page href for a browse category. */
export function categoryExploreHref(category: string): string {
  return `/explore?category=${encodeURIComponent(category)}`;
}

/** Decode HTML entities in retailer-provided titles (client-safe). */
export function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}
