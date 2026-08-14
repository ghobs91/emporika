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

/** Decode HTML entities in retailer-provided titles (client-safe). */
export function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}
