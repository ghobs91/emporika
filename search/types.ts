// ── Core domain types for federated shopping search ─────────────────────

import { RetailerSource } from '@/types/unified';

// ── Provider identity ──────────────────────────────────────────────────

/** Providers that participate in federated search. Mirrors RetailerSource. */
export type ProviderId = RetailerSource; // 'walmart' | 'bestbuy' | 'target' | 'ebay' | 'costco' | 'shopify'

export type ProviderIdShopify = 'shopify_global_catalog';
export type AllProviderId = ProviderId | ProviderIdShopify;

// ── Money ──────────────────────────────────────────────────────────────

export interface Money {
  amount: number; // in major units (dollars, not cents)
  currency: string;
}

// ── Provider capabilities ──────────────────────────────────────────────

export interface ProviderCapabilities {
  providerId: ProviderId;
  supportsKeywordSearch: boolean;
  supportsCategorySearch: boolean;
  supportsBrandFilters: boolean;
  supportsPriceFilters: boolean;
  supportsAvailabilityFilters: boolean;
  supportsDestinationFiltering: boolean;
  supportsVariantLookup: boolean;
  supportsProductDetailLookup: boolean;
  supportsGTINLookup: boolean;
  supportsShippingData: boolean;
  supportsPickupData: boolean;
  supportsReturnPolicyData: boolean;
  maxQueriesPerRequest: number;
  maxResultsPerQuery: number;
  maxConcurrentRequests: number;
  supportedCountries?: string[];
  notes?: string[];
}

// ── Provider search request / response ─────────────────────────────────

export interface ProviderSearchRequest {
  requestId: string;
  query: string;
  categoryHints?: string[];
  preferredBrands?: string[];
  excludedBrands?: string[];
  minPrice?: Money;
  maxPrice?: Money;
  destination?: {
    country: string;
    postalCode?: string;
  };
  availabilityRequired?: boolean;
  resultLimit: number;
  signal?: AbortSignal;
}

export interface ProviderVariantCandidate {
  providerVariantId?: string;
  title?: string;
  selectedOptions?: Array<{ name: string; value: string }>;
  price?: Money;
  availability?: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
}

export interface ProviderProductCandidate {
  providerId: ProviderId;
  providerProductId: string;
  providerOfferId?: string;
  canonicalProductHints?: {
    shopifyUpid?: string;
    gtin?: string[];
    upc?: string[];
    ean?: string[];
    mpn?: string[];
    brand?: string;
    model?: string;
  };
  title: string;
  description?: string;
  brand?: string;
  categoryPath?: string[];
  imageUrls?: string[];
  productUrl?: string;
  price?: Money;
  listPrice?: Money;
  condition?: 'new' | 'used' | 'refurbished' | 'open_box' | 'unknown';
  availability?: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  variants?: ProviderVariantCandidate[];
  fulfillment?: {
    shippingSupported?: boolean;
    shippingEstimate?: string;
    pickupSupported?: boolean;
    pickupLocation?: string;
  };
  seller?: {
    id?: string;
    name?: string;
    type?: 'retailer' | 'marketplace_seller' | 'unknown';
    rating?: number;
    ratingCount?: number;
  };
  returnPolicy?: {
    summary?: string;
    returnWindowDays?: number;
  };
  rawFieldAvailability: Record<string, boolean>;
  sourceSearches: string[];
}

export interface ProviderSearchResult {
  providerId: ProviderId;
  query: string;
  products: ProviderProductCandidate[];
  warnings: string[];
  partial: boolean;
  metadata: {
    receivedAt: string;
    latencyMs: number;
    resultCount: number;
    appliedFilters: string[];
    unsupportedFilters: string[];
  };
}

// ── Retailer search provider interface ────────────────────────────────

export interface RetailerSearchProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  search(request: ProviderSearchRequest): Promise<ProviderSearchResult>;
  getProductDetails?(input: {
    requestId: string;
    providerProductId: string;
    providerOfferId?: string;
    destination?: { country: string; postalCode?: string };
    signal?: AbortSignal;
  }): Promise<ProviderProductCandidate | null>;
  lookupByIdentifiers?(input: {
    requestId: string;
    identifiers: { gtin?: string; upc?: string; ean?: string; mpn?: string; brand?: string; model?: string };
    signal?: AbortSignal;
  }): Promise<ProviderProductCandidate[]>;
}

// ── Search plan (model-generated or fallback) ──────────────────────────

export interface SearchPlan {
  version: '1';
  canonicalIntent: string;
  searches: Array<{
    query: string;
    purpose: 'broad' | 'feature' | 'alternative' | 'brand';
  }>;
  sourceStrategy: {
    preferredProviders?: ProviderId[];
    excludedProviders?: ProviderId[];
    searchMode: 'all_eligible' | 'preferred_only';
  };
  hardFilters: {
    maxPrice?: number;
    minPrice?: number;
    currency?: string;
    shipsTo?: { country: string; postalCode?: string };
    categoryHints?: string[];
    requiredFeatures?: string[];
    exclusions?: string[];
    excludedBrands?: string[];
    preferredBrands?: string[];
    availabilityRequired?: boolean;
    allowedConditions?: Array<'new' | 'used' | 'refurbished' | 'open_box'>;
  };
  ranking: Array<{
    criterion:
      | 'price'
      | 'featureMatch'
      | 'availability'
      | 'shipping'
      | 'pickup'
      | 'seller'
      | 'retailer'
      | 'brandPreference'
      | 'variantFit'
      | 'condition'
      | 'preferenceFit';
    weight: number;
  }>;
  clarification?: {
    required: boolean;
    field:
      | 'budget'
      | 'destination'
      | 'category'
      | 'useCase'
      | 'size'
      | 'compatibility'
      | 'condition'
      | 'other';
    question: string;
    reason: string;
  };
  confidence: number;
}

// ── Shopper preferences (passed from frontend) ─────────────────────────

export interface ShopperPreferences {
  budget?: { max?: number; min?: number; currency?: string };
  priorities?: string[];
  excludedBrands?: string[];
  preferredBrands?: string[];
  includedProviders?: ProviderId[];
  excludedProviders?: ProviderId[];
  allowedConditions?: Array<'new' | 'used' | 'refurbished' | 'open_box'>;
  maxResults?: number;
  strictness?: 'strict' | 'balanced';
}

// ── Canonical product (cross-retailer entity-resolved) ─────────────────

export interface NormalizedOffer {
  offerId: string;
  providerId: ProviderId;
  providerProductId: string;
  providerOfferId?: string;
  productUrl?: string;
  title: string;
  condition: 'new' | 'used' | 'refurbished' | 'open_box' | 'unknown';
  comparableVariant?: {
    id?: string;
    selectedOptions: Array<{ name: string; value: string }>;
    comparability: 'equivalent' | 'different_variant' | 'unknown';
  };

  imageUrls?: string[];

  price?: Money;
  listPrice?: Money;
  availability?: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  fulfillment?: {
    shippingSupported?: boolean;
    shippingEstimate?: string;
    pickupSupported?: boolean;
    pickupLocation?: string;
  };
  seller?: {
    id?: string;
    name?: string;
    type?: 'retailer' | 'marketplace_seller' | 'unknown';
    rating?: number;
    ratingCount?: number;
  };
  returnPolicy?: {
    summary?: string;
    returnWindowDays?: number;
  };
  evidence: {
    fieldsProvided: string[];
    sourceSearches: string[];
  };
  uncertaintyFlags: string[];
}

export interface CanonicalProduct {
  canonicalId: string;
  identity: {
    gtin?: string;
    upc?: string;
    ean?: string;
    mpn?: string;
    brand?: string;
    model?: string;
    title: string;
    confidence: 'high' | 'medium' | 'low';
    matchMethod:
      | 'shopify_upid'
      | 'gtin'
      | 'upc'
      | 'ean'
      | 'mpn_brand_model'
      | 'normalized_title'
      | 'unmatched';
  };
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  imageUrls?: string[];
  offers: NormalizedOffer[];
  sourceProviders: ProviderId[];
  sourceSearches: string[];
  matchedFeatures: string[];
  missingData: string[];
  warnings: string[];
}

// ── Ranking types ──────────────────────────────────────────────────────

export interface RankedOffer {
  offer: NormalizedOffer;
  offerScore: number;
  scoreBreakdown: Array<{
    criterion: string;
    rawValue?: number | string | boolean;
    weightedContribution: number;
    reason: string;
  }>;
  reasonsToChoose: string[];
  tradeoffs: string[];
  uncertaintyFlags: string[];
}

export interface RankedProduct {
  product: CanonicalProduct;
  rank: number;
  productScore: number;
  bestOffer?: RankedOffer;
  alternateOffers: RankedOffer[];
  scoreBreakdown: Array<{
    criterion: string;
    rawValue?: number | string | boolean;
    weightedContribution: number;
    reason: string;
  }>;
  reasonsToChoose: string[];
  tradeoffs: string[];
  uncertaintyFlags: string[];
}

// ── API request / response ─────────────────────────────────────────────

export interface SearchRequest {
  query: string;
  destination?: { country: string; postalCode?: string };
  preferences?: ShopperPreferences;
  candidatePlan?: SearchPlan;
}

export interface SearchMetadata {
  plannerSource: 'webllm' | 'fallback' | 'none';
  plannerModelId?: string;
  planConfidence?: number;
  providersSearched: ProviderId[];
  providersFailed: Array<{ providerId: ProviderId; errorType: string }>;
  totalCandidates: number;
  entityResolutionCounts: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    unmatched: number;
  };
  filtersApplied: string[];
  timingMs: {
    planning: number;
    search: number;
    entityResolution: number;
    ranking: number;
    total: number;
  };
}

export type SearchStatus =
  | 'clarification_required'
  | 'results'
  | 'partial_results'
  | 'no_results'
  | 'error';

export interface SearchApiResponse {
  status: SearchStatus;
  query: string;
  results?: RankedProduct[];
  clarification?: {
    field: string;
    question: string;
    reason: string;
  };
  suggestionForNoResults?: string[];
  metadata: SearchMetadata;
  error?: string;
}

// ── WebLLM types (for browser-side integration) ────────────────────────

export interface LocalPlannerInput {
  query: string;
  preferences?: ShopperPreferences;
  availableProviders: ProviderId[];
}

export interface ResultExplanationInput {
  canonicalIntent: string;
  products: RankedProduct[];
  metadata: SearchMetadata;
}

export interface SearchExplanation {
  summary: string;
  perProduct: string[];
  caveats: string[];
}
