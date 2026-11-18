// ── Gift search orchestrator (server) ───────────────────────────────────
//
// The server is a search service here, not a profile store: it receives a
// small set of already-compiled query intents and fans them out. It never
// sees a recipient's name, age, gender or interests — see `./request.ts`.
//
// Everything below the fan-out is the existing pipeline: same providers, same
// hard filters, same entity resolution, same ranker. Gift mode changes *what
// is searched*, never how results are scored. Re-ranking (semantic relevance,
// budget proximity, learned affinity) happens in the browser.

import { executeSearch } from '@/search/orchestrator';
import { getAvailableProviders } from '@/search/providers/adapter';
import { mapWithConcurrency } from '@/search/concurrency';
import type { ProviderId, SearchApiResponse } from '@/search/types';
import { momentumSampledAt } from './momentum';
import { buildPlanFromRequest } from './plan';
import type { GiftIntentRequest, GiftSearchRequest, GiftSearchResponse } from './request';

// ── Configuration ──────────────────────────────────────────────────────

export const GIFT_DEFAULTS = {
  /** Total products returned across all intents (client re-ranks and trims). */
  maxResults: 60,
  /** Results requested per intent before client-side ranking. */
  perIntentResults: 24,
  /** Intents searched in parallel. Retailer APIs are the shared resource. */
  concurrency: 2,
} as const;

// ── Merge ──────────────────────────────────────────────────────────────

export interface IntentRun {
  request: GiftIntentRequest;
  /** Absent when the intent's search threw before returning a response. */
  response?: SearchApiResponse;
  /** Set instead of `response` when the search for this intent threw. */
  error?: string;
}

/**
 * Interleave one intent's ranked list after another, de-duplicating by
 * canonical product id.
 *
 * Two fairness rules, both deterministic:
 *  - round-robin over intents, so one intent cannot fill the page;
 *  - within an intent, take the listing whose *retailer* is least represented
 *    so far, so a marketplace with hundreds of near-identical listings cannot
 *    crowd out the other retailers.
 *
 * Exact duplicates are also removed here for cache efficiency; near-duplicates
 * (same product, different title) are removed in the browser, where the
 * semantic vectors live.
 */
export function mergeGiftIdeas(
  runs: IntentRun[],
  maxResults: number
): GiftSearchResponse['ideas'] {
  const buckets = runs.map((run) => run.response?.results ?? []);
  const cursors = buckets.map(() => 0);
  const providerUse = new Map<string, number>();
  const seen = new Set<string>();
  const ideas: GiftSearchResponse['ideas'] = [];

  const longest = buckets.reduce((max, bucket) => Math.max(max, bucket.length), 0);

  for (let round = 0; round < longest; round += 1) {
    let progressed = false;

    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      if (ideas.length >= maxResults) return ideas;

      const bucket = buckets[runIndex];
      let bestIndex = -1;
      let bestUse = Number.POSITIVE_INFINITY;

      for (let index = cursors[runIndex]; index < bucket.length; index += 1) {
        const candidate = bucket[index];
        if (!candidate) continue;
        if (seen.has(candidate.product.canonicalId)) continue;

        const provider = candidate.bestOffer?.offer.providerId ?? 'unknown';
        const use = providerUse.get(provider) ?? 0;
        if (use < bestUse) {
          bestUse = use;
          bestIndex = index;
        }
        if (use === 0) break;
      }

      if (bestIndex < 0) continue;

      const product = bucket[bestIndex];
      cursors[runIndex] = bestIndex + 1;
      seen.add(product.product.canonicalId);
      progressed = true;

      const provider = product.bestOffer?.offer.providerId ?? 'unknown';
      providerUse.set(provider, (providerUse.get(provider) ?? 0) + 1);

      const request = runs[runIndex].request;
      ideas.push({
        product,
        intentId: request.intentId,
        intentQuery: request.query,
        intentLabel: request.label,
        families: request.families,
        why: request.why,
        position: ideas.length + 1,
      });
    }

    if (!progressed) break;
  }

  return ideas;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function executeGiftIntents(
  request: GiftSearchRequest
): Promise<GiftSearchResponse> {
  const started = performance.now();
  const maxResults = request.maxResults ?? GIFT_DEFAULTS.maxResults;
  const perIntent = request.resultsPerIntent ?? GIFT_DEFAULTS.perIntentResults;

  const availableProviders = getAvailableProviders();
  if (availableProviders.length === 0) {
    return {
      status: 'error',
      ideas: [],
      intents: [],
      providersSearched: [],
      providersUnavailable: [],
      momentumSampledAt,
      timingMs: Math.round(performance.now() - started),
      error:
        'No retailer providers are configured. Set up API credentials in environment variables.',
    };
  }

  const preferences = {
    maxResults: perIntent,
    excludedProviders: request.excludedProviders,
    // Gift searches are new-in-box; see `./plan.ts`.
    allowedConditions: ['new' as const],
  };

  const runs = await mapWithConcurrency(
    request.intents,
    GIFT_DEFAULTS.concurrency,
    async (intent): Promise<IntentRun> => {
      try {
        const response = await executeSearch({
          query: intent.query,
          destination: request.destination,
          preferences,
          candidatePlan: buildPlanFromRequest(intent, availableProviders, preferences),
          candidatePlanSource: 'gift',
          sort: intent.sort,
        });
        return { request: intent, response };
      } catch (error) {
        return {
          request: intent,
          error: error instanceof Error ? error.message : 'Gift search failed',
        };
      }
    }
  );

  const ideas = mergeGiftIdeas(runs, maxResults);

  const intents: GiftSearchResponse['intents'] = runs.map(({ request: intent, response, error }) => ({
    intentId: intent.intentId,
    query: intent.query,
    label: intent.label,
    families: intent.families,
    status: response?.status ?? 'error',
    resultCount: response?.results?.length ?? 0,
    providersSearched: response?.metadata?.providersSearched ?? [],
    error: error ?? response?.error,
  }));

  const providersSearched = Array.from(
    new Set(runs.flatMap(({ response }) => response?.metadata?.providersSearched ?? []))
  );

  const seenUnavailable = new Set<string>();
  const providersUnavailable: GiftSearchResponse['providersUnavailable'] = [];
  for (const { response } of runs) {
    for (const entry of response?.metadata?.providersFailed ?? []) {
      if (seenUnavailable.has(entry.providerId)) continue;
      seenUnavailable.add(entry.providerId);
      providersUnavailable.push({
        providerId: entry.providerId,
        kind: entry.errorType,
        detail: 'This retailer could not be searched for this gift idea.',
      });
    }
  }

  const failed = runs.filter(({ response }) => !response || response.status === 'error');
  const partial = runs.some(
    ({ response }) =>
      response?.status === 'partial_results' ||
      (response?.metadata?.providersFailed?.length ?? 0) > 0
  );

  let status: GiftSearchResponse['status'];
  if (failed.length === runs.length) status = 'error';
  else if (ideas.length === 0) status = 'no_results';
  else if (failed.length > 0 || partial) status = 'partial_results';
  else status = 'results';

  return {
    status,
    ideas,
    intents,
    providersSearched,
    providersUnavailable,
    momentumSampledAt,
    timingMs: Math.round(performance.now() - started),
    error:
      status === 'error'
        ? failed[0]?.error ?? failed[0]?.response?.error ?? 'Every gift search failed. Please try again.'
        : undefined,
  };
}

/** Provider ids the orchestrator can search, for client-side pickers. */
export function giftProviderIds(): ProviderId[] {
  return getAvailableProviders();
}
