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
import { getCapabilities } from './capabilities';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { costcoAPI } from '@/lib/costco';
import { searchShopifyProducts } from '@/lib/shopify';

// ── Helpers ────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function toMoney(amount: number, currency = 'USD'): Money {
  return { amount, currency };
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
        imageUrls: [item.largeImage, item.mediumImage, item.thumbnailImage].filter(Boolean) as string[],
        productUrl: item.productUrl,
        price: toMoney(item.salePrice),
        listPrice: item.msrp > item.salePrice ? toMoney(item.msrp) : undefined,
        condition: item.bundle ? 'new' : 'new',
        availability: item.availableOnline !== false ? 'in_stock' : 'out_of_stock',
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

const targetAdapter: RetailerSearchProvider = {
  id: 'target',
  capabilities: getCapabilities('target'),

  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const start = performance.now();
    const unsupported: string[] = [];

    if (request.categoryHints) unsupported.push('categoryHints');
    if (request.preferredBrands) unsupported.push('preferredBrands');
    if (request.excludedBrands) unsupported.push('excludedBrands');
    if (request.minPrice) unsupported.push('minPrice');
    if (request.maxPrice) unsupported.push('maxPrice');

    try {
      const response = await targetAPI.searchProducts({
        query: request.query,
        count: Math.min(request.resultLimit, 24),
        // Use destination if provided for store-level pricing
        zip: request.destination?.postalCode,
      });

      const products: ProviderProductCandidate[] = (response.data?.search?.products || []).map(
        (product, index) => ({
          providerId: 'target' as ProviderId,
          providerProductId: `target-${product.tcin}-${index}`,
          canonicalProductHints: {
            brand: product.item?.primary_brand?.name,
          },
          title: product.item?.product_description?.title || 'Untitled',
          description: (product.item?.product_description as { bullet_descriptions?: string[] })?.bullet_descriptions?.join(' ') || undefined,
          imageUrls: [product.item?.enrichment?.images?.primary_image_url].filter(Boolean) as string[],
          productUrl: `https://www.target.com/p/-/A-${product.tcin}`,
          price: toMoney(product.price?.current_retail ?? 0),
          listPrice: product.price?.reg_retail ? toMoney(product.price.reg_retail) : undefined,
          condition: 'new',
          availability: product.fulfillment?.shipping_options?.availability_status === 'IN_STOCK'
            ? 'in_stock' : 'unknown',
          rawFieldAvailability: {
            name: true, price: true, image: true, url: true,
            rating: !!product.ratings_and_reviews?.statistics?.rating?.average,
            reviews: !!product.ratings_and_reviews?.statistics?.rating?.count,
            availability: true, fulfillment: true,
          },
          sourceSearches: [request.query],
        })
      );

      return {
        providerId: 'target',
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
        providerId: 'target',
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

    try {
      const response = await searchShopifyProducts({
        query: request.query,
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
            brand: firstVariant?.seller?.name,
          },
          title: product.title,
          description: product.description?.plain || product.description?.html,
          brand: firstVariant?.seller?.name,
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
          } : undefined,
          rawFieldAvailability: {
            name: true, price: true, image: true, url: true,
            brand: !!firstVariant?.seller?.name,
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

/** All provider adapters in a lookup map. */
export const providerAdapters: Record<ProviderId, RetailerSearchProvider> = {
  walmart: walmartAdapter,
  bestbuy: bestbuyAdapter,
  target: targetAdapter,
  ebay: ebayAdapter,
  costco: costcoAdapter,
  shopify: shopifyAdapter,
};

/** Get a provider adapter by ID. */
export function getProvider(id: ProviderId): RetailerSearchProvider {
  const adapter = providerAdapters[id];
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}

/** All provider IDs that are available (configured with credentials). */
export function getAvailableProviders(): ProviderId[] {
  const available: ProviderId[] = [];

  if (process.env.WALMART_CONSUMER_ID || process.env.WALMART_PRIVATE_KEY_BASE64) {
    available.push('walmart');
  }
  if (process.env.BESTBUY_API_KEY) {
    available.push('bestbuy');
  }
  if (process.env.TARGET_STORE_ID || process.env.TARGET_ZIP) {
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

  return available;
}
