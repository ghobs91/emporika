// ── Gift ideas orchestrator ─────────────────────────────────────────────
//
// One "gift ideas" request fans out into N ordinary searches — one per
// selected gift intent — and interleaves the results. Everything below the
// fan-out is the existing pipeline: same providers, same hard filters, same
// entity resolution, same ranker. Gift mode changes *what we search for*,
// never how results are scored.
//
// Why interleave instead of concatenating: concatenation would let the
// highest-scoring intent fill the whole page. Round-robin guarantees every
// intent that found something is represented in the first screenful, which
// is what "gift ideas" needs to be useful.

import { executeSearch } from '@/search/orchestrator';
import { getAvailableProviders } from '@/search/providers/adapter';
import { mapWithConcurrency } from '@/search/concurrency';
import type { ProviderId, SearchApiResponse } from '@/search/types';
import { PROVIDER_IDS } from './recipient-schema';
import { buildGiftBrief } from './brief';
import { buildGiftSearchPlan } from './plan';
import { assertGiftIndexValid, type ValidatedGiftIdeasRequest } from './schema';
import type {
  GiftIdeasResponse,
  GiftIdea,
  GiftIntentRun,
  ScoredIntent,
} from './types';

// The index is checked in and unit-tested; this catches a bad edit at
// import time in dev and test instead of at the first shopper request.
if (process.env.NODE_ENV !== 'production') {
  assertGiftIndexValid();
}

// ── Configuration ──────────────────────────────────────────────────────

export const GIFT_DEFAULTS = {
  /** Total ideas returned across all intents. */
  maxResults: 48,
  /** Results requested per intent before interleaving. */
  perIntentResults: 30,
  /** Intents searched in parallel. Retailer APIs are the shared resource. */
  concurrency: 2,
} as const;

// ── Merge ──────────────────────────────────────────────────────────────

interface IntentRun {
  scored: ScoredIntent;
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
 * A product that appears under several intents keeps the position from the
 * highest-scoring intent, because `runs` is passed in brief order.
 */
export function mergeGiftIdeas(runs: IntentRun[], maxResults: number): GiftIdea[] {
  const buckets = runs.map((run) => run.response?.results ?? []);
  const cursors = buckets.map(() => 0);
  const providerUse = new Map<string, number>();
  const seen = new Set<string>();
  const ideas: GiftIdea[] = [];

  // Bounded so a bucket of unknown length cannot spin: each run can place at
  // most its bucket size, and every round places at most one per run.
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
        // Nothing beats an unused retailer; stop scanning.
        if (use === 0) break;
      }

      if (bestIndex < 0) continue;

      const product = bucket[bestIndex];
      cursors[runIndex] = bestIndex + 1;
      seen.add(product.product.canonicalId);
      progressed = true;

      const provider = product.bestOffer?.offer.providerId ?? 'unknown';
      providerUse.set(provider, (providerUse.get(provider) ?? 0) + 1);

      const entry = runs[runIndex].scored;
      ideas.push({
        product,
        intentId: entry.intent.id,
        intentQuery: entry.intent.query,
        interestId: entry.interest,
        interestLabel: entry.interestLabel,
        why: entry.intent.why,
        families: entry.families,
        position: ideas.length + 1,
      });
    }

    if (!progressed) break;
  }

  return ideas;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function executeGiftSearch(
  request: ValidatedGiftIdeasRequest
): Promise<GiftIdeasResponse> {
  const started = performance.now();
  const maxResults = request.maxResults ?? GIFT_DEFAULTS.maxResults;

  const brief = buildGiftBrief(request.recipient, {
    maxIntents: request.maxIntents,
  });

  const recipient = { id: request.recipient.id, name: request.recipient.name };

  const providerList = getAvailableProviders();
  if (providerList.length === 0) {
    return {
      status: 'error',
      recipient,
      brief,
      ideas: [],
      intents: [],
      providersSearched: [],
      providersUnavailable: [],
      timingMs: Math.round(performance.now() - started),
      error:
        'No retailer providers are configured. Set up API credentials in environment variables.',
    };
  }

  // A shopper-supplied ceiling overrides the recipient/age-bracket one.
  const effectiveBudget =
    request.maxPrice !== undefined
      ? { ...brief.budget, max: request.maxPrice, source: 'recipient' as const }
      : brief.budget;

  // Retailers the shopper never wants for this person (persisted on the
  // recipient) plus anything excluded for this one request.
  const excludedProviders = uniqueStrings([
    ...(request.excludedProviders ?? []),
    ...(request.recipient.excludedProviders ?? []),
  ]).filter(isProviderId);

  const preferences = {
    budget: { max: effectiveBudget.max, currency: 'USD' },
    maxResults: GIFT_DEFAULTS.perIntentResults,
    includedProviders: request.includedProviders,
    excludedProviders: excludedProviders.length > 0 ? excludedProviders : undefined,
    // Gift searches are new-in-box; see `./plan.ts`.
    allowedConditions: ['new' as const],
  };

  const runs = await mapWithConcurrency(
    brief.intents,
    GIFT_DEFAULTS.concurrency,
    async (scored) => {
      const plan = buildGiftSearchPlan(scored, brief, providerList, preferences);
      try {
        const response = await executeSearch({
          query: scored.intent.query,
          destination: request.destination,
          preferences,
          candidatePlan: plan,
          candidatePlanSource: 'gift',
        });
        return { scored, response };
      } catch (error) {
        // No fabricated SearchMetadata: a thrown intent is recorded as an
        // error and every read below falls back to empty. This also keeps the
        // module independent of metadata fields the orchestrator may not
        // populate, instead of hand-building a structurally valid response.
        return {
          scored,
          error: error instanceof Error ? error.message : 'Gift search failed',
        };
      }
    }
  );

  const ideas = mergeGiftIdeas(runs, maxResults);

  const intentRuns: GiftIntentRun[] = runs.map(({ scored, response, error }) => ({
    intentId: scored.intent.id,
    intentQuery: scored.intent.query,
    interestId: scored.interest,
    interestLabel: scored.interestLabel,
    families: scored.families,
    status: response?.status ?? 'error',
    resultCount: response?.results?.length ?? 0,
    providersSearched: response?.metadata?.providersSearched ?? [],
    error: error ?? response?.error,
  }));

  const providersSearched = unique(
    runs.flatMap(({ response }) => response?.metadata?.providersSearched ?? [])
  );

  const seenUnavailable = new Set<string>();
  const providersUnavailable: GiftIdeasResponse['providersUnavailable'] = [];
  // Derived from `providersFailed`, which every search response carries, so
  // gift reporting does not depend on richer per-provider availability detail.
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

  let status: GiftIdeasResponse['status'];
  if (failed.length === runs.length) status = 'error';
  else if (ideas.length === 0) status = 'no_results';
  else if (failed.length > 0 || partial) status = 'partial_results';
  else status = 'results';

  return {
    status,
    recipient,
    brief: { ...brief, budget: effectiveBudget },
    ideas,
    intents: intentRuns,
    providersSearched,
    providersUnavailable,
    timingMs: Math.round(performance.now() - started),
    error:
      status === 'error'
        ? failed[0]?.error ??
          failed[0]?.response?.error ??
          'Every gift search failed. Please try again.'
        : undefined,
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]): string[] {
  return unique(values);
}

/** Narrow a plain string to a provider id the pipeline understands. */
function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
