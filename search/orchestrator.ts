// ── Search orchestrator ─────────────────────────────────────────────────
//
// Coordinates the full search pipeline:
//   plan → provider search → normalize → entity resolve → filter → rank
//
// Two entry points share the pipeline stages:
// - executeSearch: single final response (checks the result cache first).
// - executeSearchStream: emits per-provider progress + partial ranked
//   snapshots, then the same final response a batched call would return.

import type {
  SearchPlan,
  SearchRequest,
  SearchApiResponse,
  SearchMetadata,
  SearchStatus,
  ShopperPreferences,
  ProviderId,
  RankedProduct,
  CanonicalProduct,
  NormalizedOffer,
  ProviderSearchResult,
} from './types';
import { validatePlan } from './schemas';
import { createFallbackPlan, resolveEligibleProviders } from './planner';
import { getProvider, getAvailableProviders } from './providers/adapter';
import { getCapabilities } from './providers/capabilities';
import { normalizeProviderResults } from './normalize';
import { resolveEntities } from './entity-resolution';
import { computeOfferComparability } from './offer-normalize';
import { applyHardFilters } from './filter';
import { rankProducts, toWireResults } from './ranker';
import { createTelemetry } from './telemetry';
import { buildSearchCacheKey, defaultSearchCache } from './cache';
import { mapWithConcurrency } from './concurrency';
import { ClarificationRequiredError, AllProvidersFailedError } from './errors';

// ── Configuration ──────────────────────────────────────────────────────

const CONFIG = {
  maxProviderQueries: parseInt(process.env.SEARCH_MAX_PROVIDER_QUERIES || '5', 10),
  maxConcurrency: parseInt(process.env.SEARCH_MAX_CONCURRENCY || '4', 10),
  maxEnrichmentProducts: parseInt(process.env.SEARCH_MAX_ENRICHMENT_PRODUCTS || '15', 10),
  searchTimeoutMs: parseInt(process.env.SEARCH_TIMEOUT_MS || '20000', 10),
  providerTimeoutMs: parseInt(process.env.PROVIDER_TOOL_TIMEOUT_MS || '8000', 10),
  clarificationThreshold: parseFloat(process.env.PLANNER_CLARIFICATION_THRESHOLD || '0.55'),
  partialSnapshotSize: parseInt(process.env.SEARCH_PARTIAL_SNAPSHOT_SIZE || '12', 10),
};

// ── Shared pipeline stages ─────────────────────────────────────────────

type Telemetry = ReturnType<typeof createTelemetry>;

interface PreparedSearch {
  plan: SearchPlan;
  plannerSource: 'webllm' | 'fallback' | 'none';
  eligibleProviders: ProviderId[];
  queryVariants: SearchPlan['searches'];
}

type PrepareOutcome = { early: SearchApiResponse } | ({ early?: undefined } & PreparedSearch);

/**
 * Steps 1–4: provider availability → planning → clarification gate →
 * eligible providers. Returns either an early response or the prepared plan.
 */
function prepareSearch(
  request: SearchRequest,
  telemetry: Telemetry,
  timing: SearchMetadata['timingMs']
): PrepareOutcome {
  const availableProviders = getAvailableProviders();
  if (availableProviders.length === 0) {
    return {
      early: {
        status: 'error',
        query: request.query,
        metadata: buildMetadata(telemetry, timing, [], [], 0, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
        error: 'No retailer providers are configured. Set up API credentials in environment variables.',
      },
    };
  }

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

  if (
    plan.clarification?.required &&
    plan.confidence < CONFIG.clarificationThreshold
  ) {
    return {
      early: {
        status: 'clarification_required',
        query: request.query,
        clarification: {
          field: plan.clarification.field,
          question: plan.clarification.question,
          reason: plan.clarification.reason,
        },
        metadata: buildMetadata(telemetry, timing, [], [], timing.planning, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      },
    };
  }

  const eligibleProviders = resolveEligibleProviders(
    plan,
    request.preferences,
    availableProviders
  );

  if (eligibleProviders.length === 0) {
    return {
      early: {
        status: 'error',
        query: request.query,
        metadata: buildMetadata(telemetry, timing, [], [], timing.planning, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
        error: 'No eligible providers available after filtering.',
      },
    };
  }

  return {
    plan,
    plannerSource,
    eligibleProviders,
    queryVariants: plan.searches.slice(0, CONFIG.maxProviderQueries),
  };
}

export type ProviderOutcome =
  | { ok: true; providerId: ProviderId; results: ProviderSearchResult[] }
  | { ok: false; providerId: ProviderId; error: unknown };

function partialResult(
  providerId: ProviderId,
  query: string,
  error: unknown
): ProviderSearchResult {
  return {
    providerId,
    query,
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
  };
}

/**
 * Step 5: fan out to providers with bounded concurrency — outer limit over
 * providers (SEARCH_MAX_CONCURRENCY), inner limit per provider from its
 * declared maxConcurrentRequests capability. Variant-level failures become
 * partial results; a provider-level throw becomes a failed outcome.
 */
async function searchProviders(
  eligibleProviders: ProviderId[],
  queryVariants: SearchPlan['searches'],
  plan: SearchPlan,
  telemetry: Telemetry,
  onProviderDone?: (outcome: ProviderOutcome) => void
): Promise<ProviderOutcome[]> {
  return mapWithConcurrency(
    eligibleProviders,
    CONFIG.maxConcurrency,
    async (providerId) => {
      let outcome: ProviderOutcome;
      try {
        const provider = getProvider(providerId);
        const results = await mapWithConcurrency(
          queryVariants,
          provider.capabilities.maxConcurrentRequests,
          async (search) => {
            try {
              return await withTimeout(
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
            } catch (error) {
              telemetry.error(providerId, error);
              return partialResult(providerId, search.query, error);
            }
          }
        );
        outcome = { ok: true, providerId, results };
      } catch (error) {
        outcome = { ok: false, providerId, error };
      }
      onProviderDone?.(outcome);
      return outcome;
    }
  );
}

interface AggregatedOutcomes {
  providerSearched: ProviderId[];
  providerFailed: Array<{ providerId: ProviderId; errorType: string }>;
  allOffers: NormalizedOffer[];
  allWarnings: string[];
  hasPartial: boolean;
}

/** Step 6: normalize provider results into a flat offer list. */
function aggregateOutcomes(
  outcomes: ProviderOutcome[],
  eligibleProviders: ProviderId[],
  telemetry: Telemetry
): AggregatedOutcomes {
  const providerSearched: ProviderId[] = [];
  const providerFailed: Array<{ providerId: ProviderId; errorType: string }> = [];
  const allOffers: NormalizedOffer[] = [];
  const allWarnings: string[] = [];
  let hasPartial = false;

  for (let i = 0; i < eligibleProviders.length; i++) {
    const providerId = eligibleProviders[i];
    const outcome = outcomes[i];

    if (outcome.ok) {
      providerSearched.push(providerId);
      for (const searchResult of outcome.results) {
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
        errorType: (outcome.error as Error | undefined)?.name || 'UnknownError',
      });
      telemetry.error(providerId, outcome.error);
    }
  }

  return { providerSearched, providerFailed, allOffers, allWarnings, hasPartial };
}

export interface AssembledRanking {
  ranked: RankedProduct[];
  canonicalProducts: CanonicalProduct[];
  filteredCount: number;
  filterReasons: string[];
  entityCounts: SearchMetadata['entityResolutionCounts'];
  timingER: number;
  timingRank: number;
}

/**
 * Steps 7–9: comparability → entity resolution → hard filtering → ranking.
 * Pure over its inputs (does not mutate allOffers), so it serves both the
 * final assembly and streaming partial snapshots.
 */
export function assembleRanked(
  allOffers: NormalizedOffer[],
  plan: SearchPlan,
  preferences: ShopperPreferences | undefined,
  maxResults: number
): AssembledRanking {
  const erStart = performance.now();

  // Compute offer comparability first
  const comparable = computeOfferComparability(allOffers);

  // Resolve entities
  const canonicalProducts = resolveEntities(comparable);
  const entityCounts = countEntityConfidence(canonicalProducts);
  const timingER = Math.round(performance.now() - erStart);

  // Hard filtering
  const filteredProducts: CanonicalProduct[] = [];
  const filterReasons: string[] = [];

  for (const product of canonicalProducts) {
    const filterResult = applyHardFilters(product, plan, preferences);
    if (filterResult.passed) {
      filteredProducts.push(product);
    } else if (filterResult.reason) {
      filterReasons.push(filterResult.reason);
    }
  }

  // Ranking
  const rankStart = performance.now();
  const ranked = rankProducts(filteredProducts, plan, preferences);
  const timingRank = Math.round(performance.now() - rankStart);

  // Limit to requested max results (client paginates locally from here)
  const topResults = toWireResults(ranked.slice(0, maxResults));

  return {
    ranked: topResults,
    canonicalProducts,
    filteredCount: filteredProducts.length,
    filterReasons,
    entityCounts,
    timingER,
    timingRank,
  };
}

// ── Main orchestrator (batched) ──────────────────────────────────────────

function emptyTiming(): SearchMetadata['timingMs'] {
  return {
    planning: 0,
    search: 0,
    entityResolution: 0,
    ranking: 0,
    total: 0,
  };
}

export async function executeSearch(request: SearchRequest): Promise<SearchApiResponse> {
  const telemetry = createTelemetry();
  const timing = emptyTiming();
  const overallStart = performance.now();

  // Result cache fast-path (only cacheable statuses are ever stored).
  const cacheKey = buildSearchCacheKey(request);
  const cached = defaultSearchCache.get(cacheKey);
  if (cached) {
    return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
  }

  const prepared = prepareSearch(request, telemetry, timing);
  if ('early' in prepared && prepared.early) return prepared.early;
  const { plan, eligibleProviders, queryVariants } = prepared as PreparedSearch;

  const searchStart = performance.now();
  const outcomes = await searchProviders(eligibleProviders, queryVariants, plan, telemetry);
  timing.search = Math.round(performance.now() - searchStart);

  const { providerSearched, providerFailed, allOffers } = aggregateOutcomes(
    outcomes,
    eligibleProviders,
    telemetry
  );

  // If EVERY provider failed, return error
  if (allOffers.length === 0 && providerFailed.length === eligibleProviders.length) {
    return {
      status: 'error',
      query: request.query,
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      error: 'All retailer providers failed to return results. Please try again later.',
    };
  }

  const assembled = assembleRanked(
    allOffers,
    plan,
    request.preferences,
    request.preferences?.maxResults || 50
  );
  timing.entityResolution = assembled.timingER;
  timing.ranking = assembled.timingRank;

  // If every product was filtered out
  if (assembled.filteredCount === 0 && assembled.canonicalProducts.length > 0) {
    const response: SearchApiResponse = {
      status: 'no_results',
      query: request.query,
      suggestionForNoResults: generateRelaxationSuggestions(plan, assembled.filterReasons),
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, assembled.entityCounts, ['price', 'condition', 'availability', 'brand']),
    };
    defaultSearchCache.set(cacheKey, response);
    return response;
  }

  timing.total = Math.round(performance.now() - overallStart);

  let status: SearchStatus = 'results';
  if (aggregateHasPartial(outcomes)) status = 'partial_results';

  const response: SearchApiResponse = {
    status,
    query: request.query,
    results: assembled.ranked,
    metadata: buildMetadata(
      telemetry,
      timing,
      providerSearched,
      providerFailed,
      allOffers.length,
      assembled.entityCounts,
      ['price', 'condition', 'availability', 'brand']
    ),
  };
  defaultSearchCache.set(cacheKey, response);
  return response;
}

function aggregateHasPartial(outcomes: ProviderOutcome[]): boolean {
  return outcomes.some((o) => !o.ok || o.results.some((r) => r.partial));
}

// ── Streaming orchestrator ───────────────────────────────────────────────

export type StreamEvent =
  | {
      type: 'provider';
      providerId: ProviderId;
      resultCount: number;
      partial: boolean;
    }
  | {
      type: 'partial';
      results: RankedProduct[];
      providersDone: ProviderId[];
      providersPending: ProviderId[];
      totalCandidates: number;
    }
  | { type: 'final'; response: SearchApiResponse };

/**
 * Same pipeline as executeSearch, but emits progress as providers finish:
 * a `provider` event per completion, a ranked `partial` snapshot (top
 * SEARCH_PARTIAL_SNAPSHOT_SIZE, display-only — replaced by `final`), and
 * finally the identical `final` response a batched call would return
 * (which is also stored in the result cache).
 */
export async function executeSearchStream(
  request: SearchRequest,
  onEvent: (event: StreamEvent) => void
): Promise<SearchApiResponse> {
  const telemetry = createTelemetry();
  const timing = emptyTiming();
  const overallStart = performance.now();

  // Result cache fast-path: emit final immediately, skip providers.
  const cacheKey = buildSearchCacheKey(request);
  const cached = defaultSearchCache.get(cacheKey);
  if (cached) {
    const hit = { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
    onEvent({ type: 'final', response: hit });
    return hit;
  }

  const prepared = prepareSearch(request, telemetry, timing);
  if ('early' in prepared && prepared.early) {
    onEvent({ type: 'final', response: prepared.early });
    return prepared.early;
  }
  const { plan, eligibleProviders, queryVariants } = prepared as PreparedSearch;

  const searchStart = performance.now();
  const pending = new Set<ProviderId>(eligibleProviders);
  const done: ProviderId[] = [];
  const outcomes: (ProviderOutcome | null)[] = new Array(eligibleProviders.length).fill(null);

  const emitPartial = () => {
    const settled = outcomes.filter((o): o is ProviderOutcome => o !== null);
    if (settled.length === 0) return;
    // Aggregate in eligible order for determinism.
    const ordered = eligibleProviders
      .map((id) => settled.find((o) => o.providerId === id))
      .filter((o): o is ProviderOutcome => o !== undefined);
    const { allOffers } = aggregateOutcomes(ordered, ordered.map((o) => o.providerId), telemetry);
    if (allOffers.length === 0) return;
    const snapshot = assembleRanked(
      allOffers,
      plan,
      request.preferences,
      CONFIG.partialSnapshotSize
    );
    onEvent({
      type: 'partial',
      results: snapshot.ranked,
      providersDone: [...done],
      providersPending: eligibleProviders.filter((id) => pending.has(id)),
      totalCandidates: allOffers.length,
    });
  };

  await searchProviders(eligibleProviders, queryVariants, plan, telemetry, (outcome) => {
    const index = eligibleProviders.indexOf(outcome.providerId);
    outcomes[index] = outcome;
    pending.delete(outcome.providerId);
    done.push(outcome.providerId);
    onEvent({
      type: 'provider',
      providerId: outcome.providerId,
      resultCount: outcome.ok
        ? outcome.results.reduce((sum, r) => sum + r.products.length, 0)
        : 0,
      partial: !outcome.ok || outcome.results.some((r) => r.partial),
    });
    emitPartial();
  });
  timing.search = Math.round(performance.now() - searchStart);

  const settled = outcomes.filter((o): o is ProviderOutcome => o !== null);
  const { providerSearched, providerFailed, allOffers } = aggregateOutcomes(
    settled,
    eligibleProviders,
    telemetry
  );

  if (allOffers.length === 0 && providerFailed.length === eligibleProviders.length) {
    const response: SearchApiResponse = {
      status: 'error',
      query: request.query,
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 }, []),
      error: 'All retailer providers failed to return results. Please try again later.',
    };
    onEvent({ type: 'final', response });
    return response;
  }

  const assembled = assembleRanked(
    allOffers,
    plan,
    request.preferences,
    request.preferences?.maxResults || 50
  );
  timing.entityResolution = assembled.timingER;
  timing.ranking = assembled.timingRank;

  if (assembled.filteredCount === 0 && assembled.canonicalProducts.length > 0) {
    const response: SearchApiResponse = {
      status: 'no_results',
      query: request.query,
      suggestionForNoResults: generateRelaxationSuggestions(plan, assembled.filterReasons),
      metadata: buildMetadata(telemetry, timing, providerSearched, providerFailed, allOffers.length, assembled.entityCounts, ['price', 'condition', 'availability', 'brand']),
    };
    defaultSearchCache.set(cacheKey, response);
    onEvent({ type: 'final', response });
    return response;
  }

  timing.total = Math.round(performance.now() - overallStart);

  let status: SearchStatus = 'results';
  if (aggregateHasPartial(settled)) status = 'partial_results';

  const response: SearchApiResponse = {
    status,
    query: request.query,
    results: assembled.ranked,
    metadata: buildMetadata(
      telemetry,
      timing,
      providerSearched,
      providerFailed,
      allOffers.length,
      assembled.entityCounts,
      ['price', 'condition', 'availability', 'brand']
    ),
  };
  defaultSearchCache.set(cacheKey, response);
  onEvent({ type: 'final', response });
  return response;
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
