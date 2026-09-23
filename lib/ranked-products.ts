import type { RankedProduct } from '@/search/types';
import type { RetailerSource, UnifiedProduct } from '@/types/unified';

/**
 * Project a server-ranked product into the unified shape the UI renders and
 * filters. The sidebar filters operate on this shape, so every filterable
 * field the ranking data carries is mapped here (best-offer price/list price,
 * condition, shipping, availability, brand, category, rating).
 */
export function rankedProductToUnified(ranked: RankedProduct): UnifiedProduct {
  const best = ranked.bestOffer?.offer;
  const price = best?.price?.amount ?? 0;
  const listPrice = best?.listPrice?.amount;
  const shippingCost = best?.fulfillment?.shippingCost?.amount;
  const availability = best?.availability;
  const condition =
    best && best.condition !== 'unknown' ? best.condition : undefined;

  return {
    id: ranked.product.canonicalId,
    name: ranked.product.title,
    price,
    originalPrice:
      listPrice !== undefined && listPrice > price ? listPrice : undefined,
    image: ranked.product.imageUrls?.[0] ?? best?.imageUrls?.[0] ?? '',
    productUrl: best?.productUrl ?? '#',
    source: (best?.providerId ?? 'shopify') as RetailerSource,
    brand: ranked.product.brand,
    category: ranked.product.category,
    condition,
    sellerName: best?.seller?.name,
    sellerDomain: best?.seller?.domain,
    customerRating: ranked.product.rating,
    reviewCount: ranked.product.reviewCount,
    shortDescription: ranked.reasonsToChoose.slice(0, 2).join(' · '),
    freeShipping: shippingCost === 0 ? true : undefined,
    availableOnline:
      availability === 'out_of_stock'
        ? false
        : availability === 'in_stock' || availability === 'limited'
          ? true
          : undefined,
  };
}
