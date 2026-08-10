// ── Search orchestrator ─────────────────────────────────────────────────
//
// Coordinates the full search pipeline:
//   plan → provider search → normalize → entity resolve → filter → rank

import type {
  SearchPlan,
  SearchRequest,
  SearchApiResponse,
  SearchMetadata,
  SearchStatus,
  ProviderId,
  RankedProduct,
  CanonicalProduct,
  NormalizedOffer,
  ProviderSearchResult,
} from './types';
import { validatePlan } from './schemas';
import { createFallbackPlan } from './planner';
import { getProvider, getAvailableProviders } from './providers/adapter';
import { getCapabilities } from './providers/capabilities';
import { normalizeProviderResults } from './normalize';
import { resolveEntities } from './entity-resolution';
import { computeOfferComparability } from './offer-normalize';
import { applyHardFilters } from './filter';
import { rankProducts } from './ranker';
import { createTelemetry } from './telemetry';
import { ClarificationRequiredError, AllProvidersFailedError } from './errors';

// ── Configuration ──────────────────────────────────────────────────────

const CONFIG = {
  maxProviderQueries: parseInt(process.env.SEARCH_MAX_PROVIDER_QUERIES || '5', 10),
  maxConcurrency: parseInt(process.env.SEARCH_MAX_CONCURRENCY || '4', 10),
  maxEnrichmentProducts: parseInt(process.env.SEARCH_MAX_ENRICHMENT_PRODUCTS || '15', 10),
  searchTimeoutMs: parseInt(process.env.SEARCH_TIMEOUT_MS || '20000', 10),
  providerTimeoutMs: parseInt(process.env.PROVIDER_TOOL_TIMEOUT_MS || '8000', 10),
  clarificationThreshold: parseFloat(process.env.PLANNER_CLARIFICATION_THRESHOLD || '0.55'),
};

// ── Main orchestrator ──────────────────────────────────────────────────

export async function executeSearch(request: SearchRequest): Promise<SearchApiResponse> {
  const telemetry = createTelemetry();
  const timing: SearchMetadata['timingMs'] = {
    planning: 0,
    search: 0,
    entityResolution: 0,
    ranking: 0,
    total: 0,
  };
  const overallStart = performance.now();

  // ── Step 1: Validate request ────────────────────────────────────────

  const availableProviders = getAvailableProviders();
  if (availableProviders.length === 0) {
    return {
      status: 'error',
      query: request.query,
      metadata: buildMetadata(telemetry, timing, [], [], 0, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      error: 'No retailer providers are configured. Set up API credentials in environment variables.',
    };
  }

  // ── Step 2: Plan ────────────────────────────────────────────────────

  const planStart = performance.now();
  let plan: SearchPlan;
  let plannerSource: 'webllm' | 'fallback' | 'none' = 'fallback';

  if (request.candidatePlan) {
    const validation = validatePlan(request.candidatePlan);
    if (validation.valid) {
      plan = validation.plan;
      plannerSource = 'webllm';
    } else {
      // Candidate plan failed validation — use fallback
      telemetry.log('plan_validation_failed', {
        errors: validation.errors,
        query: request.query.slice(0, 100),
      });
      plan = createFallbackPlan(request.query, availableProviders, request.preferences);
      plannerSource = 'fallback';
    }
  } else {
    // No candidate plan — use deterministic fallback
    plan = createFallbackPlan(request.query, availableProviders, request.preferences);
    plannerSource = 'none';
  }
  timing.planning = Math.round(performance.now() - planStart);

  // ── Step 3: Clarification check ─────────────────────────────────────

  if (
    plan.clarification?.required &&
    plan.confidence < CONFIG.clarificationThreshold
  ) {
    return {
      status: 'clarification_required',
      query: request.query,
      clarification: {
        field: plan.clarification.field,
        question: plan.clarification.question,
        reason: plan.clarification.reason,
      },
      metadata: buildMetadata(telemetry, timing, [], [], timing.planning, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
    };
  }

  // ── Step 4: Determine eligible providers ─────────────────────────────

  let eligibleProviders = plan.sourceStrategy.preferredProviders ||
    availableProviders;

  // Apply explicit exclusions
  const excluded = new Set<ProviderId>([
    ...(plan.sourceStrategy.excludedProviders || []),
    ...(request.preferences?.excludedProviders || []),
  ]);
  eligibleProviders = eligibleProviders.filter(p => !excluded.has(p));

  // Apply source strategy
  if (plan.sourceStrategy.searchMode === 'preferred_only') {
    eligibleProviders = eligibleProviders.slice(0, 3);
  }

  // Filter out providers without credentials
  eligibleProviders = eligibleProviders.filter(p => availableProviders.includes(p));

  if (eligibleProviders.length === 0) {
    return {
      status: 'error',
      query: request.query,
      metadata: buildMetadata(telemetry, timing, [], [], timing.planning, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      error: 'No eligible providers available after filtering.',
    };
  }

  // ── Step 5: Search providers concurrently ────────────────────────────

  const searchStart = performance.now();
  const queryVariants = plan.searches.slice(0, CONFIG.maxProviderQueries);

  const searchPromises: Promise<ProviderSearchResult[]>[] = eligibleProviders.map(
    async (providerId) => {
      const provider = getProvider(providerId);
      const results: ProviderSearchResult[] = [];

      for (const search of queryVariants) {
        try {
          const result = await withTimeout(
            provider.search({
              requestId: telemetry.requestId,
              query: search.query,
              categoryHints: plan.hardFilters.categoryHints,
              preferredBrands: plan.hardFilters.preferredBrands,
              excludedBrands: plan.hardFilters.excludedBrands,
              minPrice: plan.hardFilters.minPrice !== undefined
                ? { amount: plan.hardFilters.minPrice, currency: plan.hardFilters.currency || 'USD' }
                : undefined,
              maxPrice: plan.hardFilters.maxPrice !== undefined
                ? { amount: plan.hardFilters.maxPrice, currency: plan.hardFilters.currency || 'USD' }
                : undefined,
              destination: plan.hardFilters.shipsTo,
              availabilityRequired: plan.hardFilters.availabilityRequired,
              resultLimit: Math.min(50, provider.capabilities.maxResultsPerQuery),
            }),
            CONFIG.providerTimeoutMs
          );
          results.push(result);
        } catch (error) {
          telemetry.error(providerId, error);
          results.push({
            providerId,
            query: search.query,
            products: [],
            warnings: [error instanceof Error ? error.message : 'Unknown error'],
            partial: true,
            metadata: {
              receivedAt: new Date().toISOString(),
              latencyMs: 0,
              resultCount: 0,
              appliedFilters: [],
              unsupportedFilters: [],
            },
          });
        }
      }

      return results;
    }
  );

  const allProviderResults = await Promise.allSettled(searchPromises);
  timing.search = Math.round(performance.now() - searchStart);

  // ── Step 6: Aggregate results ────────────────────────────────────────

  const providerSearched: ProviderId[] = [];
  const providerFailed: Array<{ providerId: ProviderId; errorType: string }> = [];
  let allOffers: NormalizedOffer[] = [];
  let allWarnings: string[] = [];
  let hasPartial = false;

  for (let i = 0; i < eligibleProviders.length; i++) {
    const providerId = eligibleProviders[i];
    const result = allProviderResults[i];

    if (result.status === 'fulfilled') {
      providerSearched.push(providerId);
      for (const searchResult of result.value) {
        const normalized = normalizeProviderResults(
          searchResult.products,
          searchResult.query
        );
        allOffers.push(...normalized);

        if (searchResult.partial) {
          hasPartial = true;
          allWarnings.push(...searchResult.warnings);
        }
      }
    } else {
      hasPartial = true;
      providerFailed.push({
        providerId,
        errorType: result.reason?.name || 'UnknownError',
      });
      telemetry.error(providerId, result.reason);
    }
  }

  // If EVERY provider failed, return error
  if (allOffers.length === 0 && providerFailed.length === eligibleProviders.length) {
    return {
      status: 'error',
      query: request.query,
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      error: 'All retailer providers failed to return results. Please try again later.',
    };
  }

  // ── Step 7: Entity resolution ────────────────────────────────────────

  const erStart = performance.now();

  // Compute offer comparability first
  allOffers = computeOfferComparability(allOffers);

  // Resolve entities
  const canonicalProducts = resolveEntities(allOffers);
  timing.entityResolution = Math.round(performance.now() - erStart);

  // ── Step 8: Hard filtering ───────────────────────────────────────────

  const filteredProducts: CanonicalProduct[] = [];
  const filterReasons: string[] = [];

  for (const product of canonicalProducts) {
    const filterResult = applyHardFilters(product, plan, request.preferences);
    if (filterResult.passed) {
      filteredProducts.push(product);
    } else if (filterResult.reason) {
      filterReasons.push(filterResult.reason);
    }
  }

  // If every product was filtered out
  if (filteredProducts.length === 0 && canonicalProducts.length > 0) {
    return {
      status: 'no_results',
      query: request.query,
      suggestionForNoResults: generateRelaxationSuggestions(plan, filterReasons),
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, countEntityConfidence(canonicalProducts), ['price', 'condition', 'availability', 'brand']),
    };
  }

  // ── Step 9: Ranking ──────────────────────────────────────────────────

  const rankStart = performance.now();
  const ranked = rankProducts(filteredProducts, plan, request.preferences);
  timing.ranking = Math.round(performance.now() - rankStart);

  // Limit to requested max results
  const maxResults = request.preferences?.maxResults || 10;
  const topResults = ranked.slice(0, maxResults);

  timing.total = Math.round(performance.now() - overallStart);

  // ── Step 10: Build response ─────────────────────────────────────────

  let status: SearchStatus = 'results';
  if (hasPartial) status = 'partial_results';

  return {
    status,
    query: request.query,
    results: topResults,
    metadata: buildMetadata(
      telemetry,
      timing,
      providerSearched,
      providerFailed,
      allOffers.length,
      countEntityConfidence(canonicalProducts),
      ['price', 'condition', 'availability', 'brand']
    ),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function buildMetadata(
  telemetry: ReturnType<typeof createTelemetry>,
  timing: SearchMetadata['timingMs'],
  providersSearched: ProviderId[],
  providersFailed: Array<{ providerId: ProviderId; errorType: string }>,
  totalCandidates: number,
  erCounts: SearchMetadata['entityResolutionCounts'],
  filtersApplied: string[]
): SearchMetadata {
  // Track timing for remaining phases
  const summary = telemetry.finish();

  return {
    plannerSource: 'fallback',
    providersSearched,
    providersFailed,
    totalCandidates,
    entityResolutionCounts: erCounts,
    filtersApplied,
    timingMs: {
      ...timing,
      total: summary.totalMs,
    },
  };
}

function countEntityConfidence(
  products: CanonicalProduct[]
): SearchMetadata['entityResolutionCounts'] {
  const counts = {
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    unmatched: 0,
  };

  for (const p of products) {
    switch (p.identity.confidence) {
      case 'high': counts.highConfidence++; break;
      case 'medium': counts.mediumConfidence++; break;
      case 'low': counts.lowConfidence++; break;
      default: counts.unmatched++; break;
    }
  }

  return counts;
}

function generateRelaxationSuggestions(
  plan: SearchPlan,
  filterReasons: string[]
): string[] {
  const suggestions: string[] = [];

  if (filterReasons.some(r => r.includes('Price'))) {
    suggestions.push('Try increasing your maximum budget');
  }
  if (filterReasons.some(r => r.includes('condition'))) {
    suggestions.push('Try allowing additional conditions (used, refurbished)');
  }
  if (filterReasons.some(r => r.includes('brand'))) {
    suggestions.push('Try removing brand exclusions');
  }
  if (filterReasons.some(r => r.includes('availability'))) {
    suggestions.push('Some results may be temporarily out of stock — try again later');
  }
  if (suggestions.length === 0) {
    suggestions.push('Try broader search terms');
    suggestions.push('Try selecting fewer specific features');
  }

  return suggestions.slice(0, 4);
}
