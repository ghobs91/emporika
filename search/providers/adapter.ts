// ── Provider adapters: wrap existing retailer API classes into the
//     RetailerSearchProvider interface ────────────────────────────────────

import type {
  ProviderId,
  ProviderProductCandidate,
  ProviderSearchRequest,
  ProviderSearchResult,
  RetailerSearchProvider,
  ProviderCapabilities,
  Money,
} from '../types';
import type { ProviderUnavailability } from '@/types/unified';
import { getCapabilities } from './capabilities';
import { withoutDisabledProviders } from './availability';
import type { BrowserProviderId, BrowserOnlyProviderId } from '../browser-providers';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { isTargetIndexAvailable, loadTargetIndex } from '@/lib/target-index';
import { targetProductUrl } from '@/lib/target-deep-links';
import {
  isPrecomputedTargetAvailable,
  lookupPrecomputedTarget,
  precomputedTargetStats,
} from '@/lib/target-precomputed';
import { ebayAPI } from '@/lib/ebay';
import { costcoAPI } from '@/lib/costco';
import { searchShopifyProducts } from '@/lib/shopify';

// ── Helpers ────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Build a money value, or nothing when the provider did not supply a usable
 * number. Some retailer payloads (notably Best Buy `salePrice`) omit the price
 * on unavailable items; emitting `{ amount: undefined }` used to reach the
 * ranker and throw, taking down the whole search response.
 */
function toMoney(amount: number, currency = 'USD'): Money | undefined {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return undefined;
  return { amount, currency };
}

/**
 * Classify a provider failure so the UI can say *why* a retailer is missing
 * instead of quietly returning a shorter list.
 *
 * 403 and 435 are what an edge bot manager (Varnish, PerimeterX, Akamai)
 * returns to non-browser clients. Retrying does not help, so these must not be
 * reported as a transient "try again".
 */
function classifyProviderError(error: unknown): ProviderUnavailability {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(/\b(4\d{2}|5\d{2})\b/.exec(message)?.[1] ?? NaN);

  if (
    status === 403 ||
    status === 435 ||
    status === 429 ||
    /perimeterx|px-cdn|captcha|bot challenge|access denied|kasada/i.test(message)
  ) {
    return {
      kind: 'blocked_by_edge',
      detail:
        'This retailer blocks automated requests from servers. It can only be searched from your own browser.',
    };
  }

  if (status === 401 || status === 407) {
    return {
      kind: 'missing_credentials',
      detail: 'This retailer rejected the configured credentials.',
    };
  }

  return {
    kind: 'network_error',
    detail: 'This retailer did not respond. Try again in a moment.',
  };
}

// ── Walmart adapter ────────────────────────────────────────────────────

const walmartAdapter: RetailerSearchProvider = {
  id: 'walmart',
  capabilities: getCapabilities('walmart'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];

    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.minPrice) unsupported.push('minPrice');
    if (request.maxPrice) unsupported.push('maxPrice');
    if (request.destination) unsupported.push('destination');

    try {
      const response = await walmartAPI.searchProducts({
        query: request.query,
        numItems: Math.min(request.resultLimit, 25),
      });

      const products: ProviderProductCandidate[] = (response.items || []).map(item => ({
        providerId: 'walmart' as ProviderId,
        providerProductId: String(item.itemId),
        canonicalProductHints: {
          upc: item.upc ? [item.upc] : undefined,
          model: item.modelNumber,
        },
        title: item.name,
        description: item.shortDescription,
        brand: undefined, // Walmart API exposes no brand field — never fake it
        categoryPath: item.categoryPath ? [item.categoryPath] : undefined,
        imageUrls: [item.largeImage, item.mediumImage, item.thumbnailImage].filter(Boolean) as string[],
        productUrl: item.productUrl,
        price: toMoney(item.salePrice),
        listPrice: item.msrp > item.salePrice ? toMoney(item.msrp) : undefined,
        condition: item.bundle ? 'new' : 'new',
        availability: item.availableOnline !== false ? 'in_stock' : 'out_of_stock',
        rating: item.customerRating ? parseFloat(item.customerRating) : undefined,
        reviewCount: item.numReviews,
        fulfillment: {
          shippingSupported: true,
          shippingCost: item.standardShipRate !== undefined ? toMoney(item.standardShipRate) : undefined,
        },
        rawFieldAvailability: {
          name: true, price: true, image: true, url: true,
          brand: false, rating: !!item.customerRating,
          reviews: !!item.numReviews, description: !!item.shortDescription,
          upc: !!item.upc, shipping: true, availability: true,
        },
        sourceSearches: [request.query],
      }));

      return {
        providerId: 'walmart',
        query: request.query,
        products,
        warnings: [],
        partial: false,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: products.length,
          appliedFilters: ['keyword'],
          unsupportedFilters: unsupported,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'walmart',
        query: request.query,
        products: [],
        warnings: [message],
        partial: true,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};

// ── Best Buy adapter ───────────────────────────────────────────────────

const bestbuyAdapter: RetailerSearchProvider = {
  id: 'bestbuy',
  capabilities: getCapabilities('bestbuy'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];

    if (request.destination) unsupported.push('destination');
    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.minPrice) unsupported.push('minPrice');
    if (request.maxPrice) unsupported.push('maxPrice');

    try {
      const response = await bestBuyAPI.searchProducts({
        query: request.query,
        pageSize: Math.min(request.resultLimit, 30),
      });

      const products: ProviderProductCandidate[] = (response.products || []).map(item => ({
        providerId: 'bestbuy' as ProviderId,
        providerProductId: String(item.sku),
        canonicalProductHints: {
          upc: item.upc ? [item.upc] : undefined,
          brand: item.manufacturer,
          model: item.modelNumber,
        },
        title: item.name,
        description: item.shortDescription,
        brand: item.manufacturer,
        categoryPath: item.categoryPath?.map((c: { name: string }) => c.name),
        imageUrls: [item.largeFrontImage, item.image, item.mediumImage, item.thumbnailImage].filter(Boolean) as string[],
        productUrl: item.url,
        price: toMoney(item.salePrice),
        listPrice: item.regularPrice > item.salePrice ? toMoney(item.regularPrice) : undefined,
        condition: 'new',
        availability: item.onlineAvailability ? 'in_stock' : 'out_of_stock',
        rating: item.customerReviewAverage,
        reviewCount: item.customerReviewCount,
        fulfillment: {
          shippingSupported: true,
          shippingCost: item.shippingLevelsOfService?.length
            ? toMoney(Math.min(...item.shippingLevelsOfService.map(l => l.unitShippingPrice)))
            : undefined,
        },
        rawFieldAvailability: {
          name: true, price: true, image: true, url: true,
          brand: !!item.manufacturer, rating: !!item.customerReviewAverage,
          reviews: !!item.customerReviewCount, description: !!item.shortDescription,
          upc: !!item.upc, sku: !!item.sku, modelNumber: !!item.modelNumber,
          shipping: !!item.freeShipping,
        },
        sourceSearches: [request.query],
      }));

      return {
        providerId: 'bestbuy',
        query: request.query,
        products,
        warnings: [],
        partial: false,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: products.length,
          appliedFilters: ['keyword'],
          unsupportedFilters: unsupported,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'bestbuy',
        query: request.query,
        products: [],
        warnings: [message],
        partial: true,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};

// ── Target adapter ─────────────────────────────────────────────────────

/** Map a catalog row to a provider candidate. Shared by both Target backends. */
function targetCandidate(
  tcin: string,
  title: string,
  url: string,
  sourceQuery: string
): ProviderProductCandidate {
  return {
    providerId: 'target' as ProviderId,
    providerProductId: `target-${tcin}`,
    title: title || `Target item ${tcin}`,
    productUrl: url,
    condition: 'unknown',
    availability: 'unknown',
    rawFieldAvailability: {
      name: title.length > 0,
      price: false,
      image: false,
      url: true,
      brand: false,
      rating: false,
      reviews: false,
      description: false,
      availability: false,
      shipping: false,
    },
    sourceSearches: [sourceQuery],
  };
}

const targetAdapter: RetailerSearchProvider = {
  id: 'target',
  capabilities: getCapabilities('target'),

  /**
   * Two backends, in preference order:
   *
   *  1. The local SQLite catalog (`lib/target-index.ts`) when it exists on disk
   *     — arbitrary queries, full 2.6M-product recall. Local/dev, or any host
   *     with a persistent volume.
   *  2. The precomputed artifact (`lib/target-precomputed.ts`) — an object
   *     lookup over a curated vocabulary, which is all a host without
   *     persistent disk can support.
   *
   * Neither can supply price, availability, rating, image or brand: Target's
   * storefront HTML carries none of it and Redsky is PerimeterX-guarded. That is
   * recorded in `rawFieldAvailability` rather than filled with plausible
   * defaults — the ranker penalises a missing price and the UI labels it.
   */
  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];
    const warnings: string[] = [];

    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.minPrice) unsupported.push('minPrice');
    if (request.maxPrice) unsupported.push('maxPrice');
    if (request.destination) unsupported.push('destination');
    if (request.availabilityRequired) unsupported.push('availabilityRequired');
    if (request.minPrice || request.maxPrice) {
      warnings.push('Target prices are not indexed, so price filters do not apply.');
    }

    const finish = (
      products: ProviderProductCandidate[]
    ): ProviderSearchResult => ({
      providerId: 'target',
      query: request.query,
      products,
      warnings,
      partial: false,
      metadata: {
        receivedAt: nowISO(),
        latencyMs: Math.round(performance.now() - start),
        resultCount: products.length,
        appliedFilters: ['keyword'],
        unsupportedFilters: unsupported,
      },
    });

    try {
      let products: ProviderProductCandidate[];

      if (isTargetIndexAvailable()) {
        const index = await loadTargetIndex();
        const hits = index.query(request.query, Math.min(request.resultLimit, 24));
        const partialMatches = hits.filter((hit) => hit.matchMode === 'partial').length;
        if (partialMatches > 0) {
          warnings.push(`${partialMatches} Target result(s) matched only some of your terms.`);
        }
        products = hits.map((hit) =>
          targetCandidate(hit.record.tcin, hit.record.title, hit.record.url, request.query)
        );
      } else if (isPrecomputedTargetAvailable()) {
        const hits = lookupPrecomputedTarget(request.query);

        if (hits === undefined) {
          // Not a miss on Target's side — this deployment simply does not
          // precompute this query. Saying "no matches" here would be a lie.
          const stats = precomputedTargetStats();
          warnings.push(
            `Target results are precomputed for ${stats.queryCount.toLocaleString()} curated ` +
              `searches on this deployment, and this query is not one of them.`
          );
          return finish([]);
        }

        products = hits
          .slice(0, Math.min(request.resultLimit, 24))
          .map((hit) =>
            targetCandidate(
              hit.tcin,
              hit.title,
              // Bare product URLs resolve and Target canonicalises them, so the
              // artifact does not need to carry a slug.
              targetProductUrl(hit.tcin) ?? `https://www.target.com/p/-/A-${hit.tcin}`,
              request.query
            )
          );
      } else {
        throw new Error(
          'Target has neither a catalog index nor a precomputed artifact on this deployment.'
        );
      }

      return finish(products);
    } catch (error) {
      // A missing data source is a build condition, not "no matches":
      // reporting it as an empty result set would tell a shopper Target does not
      // carry the thing, which is not what we know.
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'target',
        query: request.query,
        products: [],
        warnings: [...warnings, message],
        partial: true,
        unavailable: {
          kind: 'index_unavailable',
          detail:
            'Target is served from a locally built catalog index, which is not ' +
            'available on this server. Other retailers are unaffected.',
        },
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};
// ── eBay adapter ───────────────────────────────────────────────────────

const ebayAdapter: RetailerSearchProvider = {
  id: 'ebay',
  capabilities: getCapabilities('ebay'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];

    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.destination) unsupported.push('destination');

    try {
      const response = await ebayAPI.searchProducts({
        q: request.query,
        limit: Math.min(request.resultLimit, 50),
        fieldgroups: 'EXTENDED',
        filter: [
          request.availabilityRequired ? 'availability:IN_STOCK' : '',
          request.minPrice ? `price:[${request.minPrice.amount}..` : '',
          request.maxPrice ? `price:..${request.maxPrice.amount}]` : '',
        ].filter(Boolean).join(','),
      });

      const products: ProviderProductCandidate[] = (response.itemSummaries || []).map(item => {
        const priceValue = parseFloat(item.price?.value ?? '0');
        const originalPrice = item.marketingPrice?.originalPrice
          ? parseFloat(item.marketingPrice.originalPrice.value)
          : undefined;
        const hasFreeShipping = item.shippingOptions?.some(
          opt => opt.shippingCost?.value === '0' || opt.shippingCost?.value === '0.0'
        );
        const shippingCosts = (item.shippingOptions || [])
          .map(opt => (opt.shippingCost?.value !== undefined ? parseFloat(opt.shippingCost.value) : NaN))
          .filter(n => !Number.isNaN(n));

        return {
          providerId: 'ebay' as ProviderId,
          providerProductId: item.itemId,
          title: item.title,
          description: item.shortDescription,
          categoryPath: item.categories?.map(c => c.categoryName),
          imageUrls: [
            item.image?.imageUrl,
            ...(item.thumbnailImages || []).map(i => i.imageUrl),
            ...(item.additionalImages || []).map(i => i.imageUrl),
          ].filter(Boolean) as string[],
          productUrl: item.itemAffiliateWebUrl || item.itemWebUrl || `https://www.ebay.com/itm/${item.legacyItemId || item.itemId}`,
          price: toMoney(priceValue),
          listPrice: originalPrice && originalPrice > priceValue ? toMoney(originalPrice) : undefined,
          condition: mapEbayCondition(item.condition),
          availability: 'in_stock', // eBay search results are generally available
          fulfillment: {
            shippingSupported: true,
            shippingCost: shippingCosts.length ? toMoney(Math.min(...shippingCosts)) : undefined,
          },
          seller: item.seller ? {
            name: item.seller.username,
            type: 'marketplace_seller',
            rating: item.seller.feedbackPercentage ? parseFloat(item.seller.feedbackPercentage) : undefined,
            ratingCount: item.seller.feedbackScore,
          } : undefined,
          rawFieldAvailability: {
            name: true, price: true, image: true, url: true,
            condition: !!item.condition, seller: !!item.seller,
            shipping: hasFreeShipping || false,
          },
          sourceSearches: [request.query],
        };
      });

      return {
        providerId: 'ebay',
        query: request.query,
        products,
        warnings: [],
        partial: false,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: products.length,
          appliedFilters: ['keyword', ...(request.availabilityRequired ? ['availability'] : [])],
          unsupportedFilters: unsupported,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'ebay',
        query: request.query,
        products: [],
        warnings: [message],
        partial: true,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};

// ── Costco adapter ─────────────────────────────────────────────────────

const costcoAdapter: RetailerSearchProvider = {
  id: 'costco',
  capabilities: getCapabilities('costco'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];

    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.minPrice) unsupported.push('minPrice');
    if (request.maxPrice) unsupported.push('maxPrice');
    if (request.destination) unsupported.push('destination');

    try {
      const response = await costcoAPI.searchProducts({
        query: request.query,
        rows: Math.min(request.resultLimit, 24),
      });

      const products: ProviderProductCandidate[] = (response.response?.docs || []).map(item => {
        const price = item.item_location_pricing_salePrice ??
          item.minSalePrice ?? item.maxSalePrice ?? 0;
        const listPrice = item.item_location_pricing_listPrice;
        const itemNumber = item.item_number || (item.id ? item.id.split('!')[0] : undefined);

        return {
          providerId: 'costco' as ProviderId,
          providerProductId: itemNumber || `costco-${Math.random().toString(36).slice(2, 9)}`,
          title: item.item_name || item.item_product_name || item.name || 'Untitled',
          description: item.item_short_description || item.description,
          imageUrls: [
            item.item_collateral_primaryimage,
            item.item_product_primary_image,
            item.image,
          ].filter(Boolean) as string[],
          productUrl: itemNumber ? `https://www.costco.com/.product.${itemNumber}.html` : '#',
          price: toMoney(price),
          listPrice: listPrice && listPrice > price ? toMoney(listPrice) : undefined,
          condition: 'new',
          availability: (item.isItemInStock ?? item.item_buyable ?? item.item_product_buyable)
            ? 'in_stock' : 'unknown',
          rating: item.item_ratings ?? (item.item_review_ratings ? parseFloat(item.item_review_ratings) : undefined),
          reviewCount: item.item_product_review_count ?? item.item_review_count,
          rawFieldAvailability: {
            name: true, price: true, image: true, url: true,
            rating: !!(item.item_ratings || item.item_review_ratings),
            reviews: !!(item.item_product_review_count || item.item_review_count),
            availability: true,
          },
          sourceSearches: [request.query],
        };
      });

      return {
        providerId: 'costco',
        query: request.query,
        products,
        warnings: [],
        partial: false,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: products.length,
          appliedFilters: ['keyword'],
          unsupportedFilters: unsupported,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'costco',
        query: request.query,
        products: [],
        warnings: [message],
        partial: true,
        unavailable: classifyProviderError(error),
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};

// ── Shopify adapter ────────────────────────────────────────────────────

const shopifyAdapter: RetailerSearchProvider = {
  id: 'shopify',
  capabilities: getCapabilities('shopify'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];
    const applied: string[] = ['keyword'];

    // Shopify's Global Catalog is keyword-based; it has no structured
    // category filter we can populate from a free-text hint. Apply the
    // intended sub-category as a keyword so "king bed" favours bed frames
    // over the adjacent category (bedding).
    const categoryHint = request.categoryHints?.find(
      (hint) => !request.query.toLowerCase().includes(hint.toLowerCase())
    );
    const effectiveQuery = categoryHint
      ? `${request.query} ${categoryHint}`
      : request.query;
    if (categoryHint) applied.push('categoryHints');

    try {
      const response = await searchShopifyProducts({
        query: effectiveQuery,
        pagination: { limit: Math.min(request.resultLimit, 50) },
        filters: {
          available: request.availabilityRequired || undefined,
          ships_to: request.destination ? {
            country: request.destination.country,
            postal_code: request.destination.postalCode,
          } : { country: 'US' },
          price: (request.minPrice || request.maxPrice) ? {
            min: request.minPrice ? request.minPrice.amount * 100 : undefined,
            max: request.maxPrice ? request.maxPrice.amount * 100 : undefined,
          } : undefined,
        },
      });

      if (request.preferredBrands) unsupported.push('preferredBrands');
      if (request.excludedBrands) unsupported.push('excludedBrands');
      if (request.availabilityRequired) applied.push('availability');
      if (request.destination) applied.push('destination');
      if (request.minPrice || request.maxPrice) applied.push('price');

      const products: ProviderProductCandidate[] = (response?.products || []).map(product => {
        const firstVariant = product.variants?.[0];
        const priceRaw = firstVariant?.price?.amount ?? product.price_range?.min?.amount ?? 0;

        return {
          providerId: 'shopify' as ProviderId,
          providerProductId: product.id,
          providerOfferId: firstVariant?.id,
          canonicalProductHints: {
            shopifyUpid: extractUPID(product.id),
            // Shopify exposes a merchant SKU, not a product-level brand. Passing
            // the seller name as `brand` caused false brand-vetoes between two
            // merchants listing the same product, blocking cross-merchant
            // dedup. Use the SKU as an MPN hint instead and leave brand unset.
            ...(firstVariant?.sku ? { mpn: [firstVariant.sku] } : {}),
          },
          title: product.title,
          description: product.description?.plain || product.description?.html,
          brand: undefined,
          categoryPath: product.categories?.map((c: { value: string }) => c.value),
          imageUrls: product.media?.filter((m: { type: string }) => m.type === 'image').map((m: { url: string }) => m.url),
          productUrl: firstVariant?.url ?? product.url,
          price: toMoney(priceRaw / 100, firstVariant?.price?.currency ?? 'USD'),
          listPrice: product.price_range?.max?.amount && product.price_range.max.amount > product.price_range.min.amount
            ? toMoney(product.price_range.max.amount / 100)
            : undefined,
          condition: 'new',
          availability: product.variants?.some((v: { availability?: { available: boolean } }) => v.availability?.available !== false)
            ? 'in_stock' : 'unknown',
          rating: product.rating?.value,
          reviewCount: product.rating?.count,
          variants: product.variants?.map((v) => ({
            providerVariantId: v.id,
            title: v.title,
            selectedOptions: v.options?.map((o: { name: string; label: string }) => ({ name: o.name, value: o.label })),
            price: v.price ? toMoney(v.price.amount / 100, v.price.currency) : undefined,
            availability: (v.availability?.available ? 'in_stock' : 'out_of_stock') as 'in_stock' | 'out_of_stock' | 'limited' | 'unknown',
          })),
          fulfillment: {
            shippingSupported: true,
          },
          seller: firstVariant?.seller ? {
            id: firstVariant.seller.id,
            name: firstVariant.seller.name,
            type: 'retailer',
            domain: firstVariant.seller.domain,
          } : undefined,
          rawFieldAvailability: {
            name: true, price: true, image: true, url: true,
            brand: false,
            rating: !!product.rating, reviews: !!product.rating?.count,
            description: !!product.description,
            variants: !!product.variants?.length,
            shipping: true,
          },
          sourceSearches: [request.query],
        };
      });

      return {
        providerId: 'shopify',
        query: request.query,
        products,
        warnings: [],
        partial: false,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: products.length,
          appliedFilters: applied,
          unsupportedFilters: unsupported,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        providerId: 'shopify',
        query: request.query,
        products: [],
        warnings: [message],
        partial: true,
        metadata: {
          receivedAt: nowISO(),
          latencyMs: Math.round(performance.now() - start),
          resultCount: 0,
          appliedFilters: [],
          unsupportedFilters: unsupported,
        },
      };
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function mapEbayCondition(condition?: string): 'new' | 'used' | 'refurbished' | 'open_box' | 'unknown' {
  if (!condition) return 'unknown';
  const c = condition.toLowerCase();
  if (c.includes('new')) return 'new';
  if (c.includes('used') || c.includes('pre-owned')) return 'used';
  if (c.includes('refurbished')) return 'refurbished';
  if (c.includes('open box')) return 'open_box';
  return 'unknown';
}

function extractUPID(shopifyId: string): string {
  const match = shopifyId.match(/\/p\/([^?]+)/);
  return match ? match[1] : shopifyId;
}

// ── Provider registry ──────────────────────────────────────────────────

/**
 * Providers callable from the server. Back Market has no server adapter: it is
 * collected in the user's browser and arrives as pre-supplied results (see
 * `search/browser-providers.ts`). Target and Costco keep their server adapters
 * (used as a fallback and by /api/deals and /api/explore) even though the
 * browser is now their primary path.
 */
export type ServerProviderId = Exclude<ProviderId, BrowserOnlyProviderId>;

/** All provider adapters in a lookup map. */
export const providerAdapters: Record<ServerProviderId, RetailerSearchProvider> = {
  walmart: walmartAdapter,
  bestbuy: bestbuyAdapter,
  target: targetAdapter,
  ebay: ebayAdapter,
  costco: costcoAdapter,
  shopify: shopifyAdapter,
};

/** Get a provider adapter by ID. */
export function getProvider(id: ServerProviderId): RetailerSearchProvider {
  const adapter = providerAdapters[id];
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}

/**
 * Provider IDs that can serve this request: API-backed providers configured
 * with credentials, plus browser-collected providers the caller actually
 * supplied listings for.
 *
 * Target and Costco are edge-blocked server-side, so configuring their env vars
 * only enables the *fallback* path. When the extension supplies their listings
 * they are available regardless of env — see `search/browser-providers.ts`.
 * Target additionally has a server-side path that never touches the retailer's
 * edge: the locally built catalog index (`lib/target-index.ts`).
 */
export function getAvailableProviders(
  browserProviders: readonly BrowserProviderId[] = []
): ProviderId[] {
  const available: ProviderId[] = [];

  if (process.env.WALMART_CONSUMER_ID || process.env.WALMART_PRIVATE_KEY_BASE64) {
    available.push('walmart');
  }
  if (process.env.BESTBUY_API_KEY) {
    available.push('bestbuy');
  }
  // Target is served from data we build ourselves, so the artifact — not
  // credentials — decides availability. Two shapes exist: the local SQLite
  // catalog (arbitrary queries, needs a filesystem) and the precomputed map
  // (curated vocabulary, bundled into the deployment). When neither is present
  // the adapter still answers, but with `index_unavailable`, so the retailer is
  // only offered when it can actually produce something.
  if (isTargetIndexAvailable() || isPrecomputedTargetAvailable()) {
    available.push('target');
  }
  if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
    available.push('ebay');
  }
  if (process.env.COSTCO_COOKIES) {
    available.push('costco');
  }
  // Shopify always available (uses agent profile without auth)
  if (process.env.SHOPIFY_AGENT_PROFILE || process.env.SHOPIFY_CLIENT_ID) {
    available.push('shopify');
  }

  // A browser-collected provider is only "available" when this request
  // actually carries its listings.
  for (const id of browserProviders) {
    if (!available.includes(id)) available.push(id);
  }

  // Deliberately disabled retailers are never eligible, regardless of
  // credentials or browser results. See `./availability.ts`.
  return withoutDisabledProviders(available);
}
