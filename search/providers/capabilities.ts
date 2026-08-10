// ── Provider capabilities definitions ───────────────────────────────────

import type { ProviderCapabilities, ProviderId } from '../types';

/**
 * Known capabilities for each integrated retailer.
 * Describes what each provider's API can actually do — used by the orchestrator
 * to determine which filters can be applied where and to label unsupported filters.
 */
export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  walmart: {
    providerId: 'walmart',
    supportsKeywordSearch: true,
    supportsCategorySearch: true,
    supportsBrandFilters: false,
    supportsPriceFilters: false,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: false,
    supportsVariantLookup: false,
    supportsProductDetailLookup: false,
    supportsGTINLookup: false,
    supportsShippingData: true,
    supportsPickupData: false,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 25,
    maxConcurrentRequests: 2,
    supportedCountries: ['US'],
    notes: ['Price/sort are applied via sort order, not hard filters'],
  },

  bestbuy: {
    providerId: 'bestbuy',
    supportsKeywordSearch: true,
    supportsCategorySearch: true,
    supportsBrandFilters: true,
    supportsPriceFilters: true,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: false,
    supportsVariantLookup: false,
    supportsProductDetailLookup: false,
    supportsGTINLookup: false,
    supportsShippingData: true,
    supportsPickupData: false,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 30,
    maxConcurrentRequests: 2,
    supportedCountries: ['US'],
    notes: ['Rich category path and manufacturer data available'],
  },

  target: {
    providerId: 'target',
    supportsKeywordSearch: true,
    supportsCategorySearch: false,
    supportsBrandFilters: false,
    supportsPriceFilters: false,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: true,
    supportsVariantLookup: false,
    supportsProductDetailLookup: false,
    supportsGTINLookup: false,
    supportsShippingData: false,
    supportsPickupData: true,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 24,
    maxConcurrentRequests: 2,
    supportedCountries: ['US'],
    notes: ['Store-level pricing and pickup availability via store_id/zip'],
  },

  ebay: {
    providerId: 'ebay',
    supportsKeywordSearch: true,
    supportsCategorySearch: true,
    supportsBrandFilters: false,
    supportsPriceFilters: true,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: false,
    supportsVariantLookup: false,
    supportsProductDetailLookup: false,
    supportsGTINLookup: true,
    supportsShippingData: true,
    supportsPickupData: false,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 50,
    maxConcurrentRequests: 3,
    supportedCountries: ['US'],
    notes: [
      'GTIN/UPC/EAN lookup supported via gtin parameter',
      'Condition filtering supported via filter parameter',
      'Items are from marketplace sellers (not a single retailer)',
    ],
  },

  costco: {
    providerId: 'costco',
    supportsKeywordSearch: true,
    supportsCategorySearch: false,
    supportsBrandFilters: false,
    supportsPriceFilters: false,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: false,
    supportsVariantLookup: false,
    supportsProductDetailLookup: false,
    supportsGTINLookup: false,
    supportsShippingData: false,
    supportsPickupData: false,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 24,
    maxConcurrentRequests: 1,
    supportedCountries: ['US'],
    notes: ['Requires session cookies for API access', 'Filters are limited to ShipIt eligibility'],
  },

  shopify: {
    providerId: 'shopify',
    supportsKeywordSearch: true,
    supportsCategorySearch: true,
    supportsBrandFilters: true,
    supportsPriceFilters: true,
    supportsAvailabilityFilters: true,
    supportsDestinationFiltering: true,
    supportsVariantLookup: true,
    supportsProductDetailLookup: true,
    supportsGTINLookup: false,
    supportsShippingData: true,
    supportsPickupData: false,
    supportsReturnPolicyData: false,
    maxQueriesPerRequest: 5,
    maxResultsPerQuery: 50,
    maxConcurrentRequests: 2,
    supportedCountries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP'],
    notes: [
      'Global Catalog MCP — aggregates across all Shopify merchants',
      'UPID-based product identity',
      'Rich variant/option data available',
      'Condition, price, and shipping filters supported',
    ],
  },
};

/** Get capabilities for a provider, throwing if unknown. */
export function getCapabilities(providerId: ProviderId): ProviderCapabilities {
  const caps = PROVIDER_CAPABILITIES[providerId];
  if (!caps) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return caps;
}

/** Providers that support optional detail enrichment via getProductDetails. */
export function supportsDetailEnrichment(providerId: ProviderId): boolean {
  return PROVIDER_CAPABILITIES[providerId]?.supportsProductDetailLookup ?? false;
}
