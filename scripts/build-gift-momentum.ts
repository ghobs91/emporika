/**
 * Build the gift "momentum" signal from Walmart's bestseller ordering.
 *
 * This is the only sales-ranked feed available to the app: `sort=bestseller`
 * returns items in Walmart's own sales-rank order. For every gift query we
 * sample the top of that list and record three things:
 *
 *   relevance    share of the bestseller-ordered titles that actually match
 *                the query vocabulary (a query nobody sells scores 0)
 *   reviewDepth  median review count, log-scaled — how established the
 *                category's sellers are, not how many people bought last week
 *   established  share of the sample with ≥50 reviews
 *
 * `momentum` is a weighted blend of those three, in [0, 1]. It is used as a
 * small additive bonus in `search/gift/brief.ts`, never as a filter, so an
 * item Walmart does not carry is not punished — it simply earns no boost.
 *
 * The output is a checked-in generated module: `search/gift/momentum-data.ts`.
 * It goes stale. Re-run this script and commit the result; `sampledAt` in the
 * file is how you tell how old it is.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/build-gift-momentum.ts
 *   npx tsx --env-file=.env.local scripts/build-gift-momentum.ts --limit 20
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { walmartAPI } from '../lib/walmart';
import { AGE_BRACKET_PROFILES, COMBO_INTENTS, GENDER_INTENTS, INTEREST_PROFILES } from '../search/gift/index-data';
import { BRANDS, brandProductQuery } from '../search/gift/brands';
import { mapWithConcurrency } from '../search/concurrency';
import type { WalmartProduct } from '../types/walmart';

interface Args {
  concurrency: number;
  limit: number;
  out: string;
  evidence: string;
  sampleSize: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    concurrency: 3,
    limit: 0,
    out: 'search/gift/momentum-data.ts',
    evidence: 'docs/gift-momentum-evidence.json',
    sampleSize: 12,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency') args.concurrency = Number.parseInt(argv[++i] ?? '3', 10);
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '0', 10);
    else if (arg === '--sample') args.sampleSize = Number.parseInt(argv[++i] ?? '12', 10);
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
    else if (arg === '--evidence') args.evidence = argv[++i] ?? args.evidence;
  }
  return args;
}

/** Words that carry no product meaning on their own. */
const GENERIC = new Set([
  'set', 'kit', 'gift', 'for', 'with', 'and', 'the', 'a', 'an',
  'kids', 'mens', 'womens', 'new', 'best', 'pack', 'piece',
]);

function contentWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length >= 3 && !GENERIC.has(word));
}

/** Share of sampled titles containing at least one content word of the query. */
function relevanceShare(titles: string[], words: string[]): number {
  if (titles.length === 0) return 0;
  if (words.length === 0) return 1;
  const hits = titles.filter((title) => {
    const lower = title.toLowerCase();
    return words.some((word) => lower.includes(word));
  }).length;
  return hits / titles.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** log10(1+n) / 5 → 0 at zero reviews, 1.0 at 100k reviews. */
function normalizeReviews(count: number): number {
  return Math.min(1, Math.log10(1 + Math.max(0, count)) / 5);
}

export interface MomentumSample {
  query: string;
  totalResults: number;
  sampled: number;
  relevance: number;
  reviewDepth: number;
  established: number;
  momentum: number;
  medianReviews: number;
  sampleTitles: string[];
}

const WEIGHTS = { relevance: 0.45, reviewDepth: 0.35, established: 0.2 } as const;

export function scoreMomentum(query: string, items: WalmartProduct[]): MomentumSample {
  const sample = items.slice(0, 12);
  const titles = sample.map((item) => item.name ?? '');
  const words = contentWords(query);
  const reviews = sample.map((item) => item.numReviews ?? 0);

  const relevance = relevanceShare(titles, words);
  const reviewDepth = normalizeReviews(median(reviews));
  const established =
    sample.length > 0 ? sample.filter((item) => (item.numReviews ?? 0) >= 50).length / sample.length : 0;

  const momentum =
    Math.round(
      (WEIGHTS.relevance * relevance +
        WEIGHTS.reviewDepth * reviewDepth +
        WEIGHTS.established * established) *
        1000
    ) / 1000;

  return {
    query,
    totalResults: sample.length,
    sampled: sample.length,
    relevance: Math.round(relevance * 1000) / 1000,
    reviewDepth: Math.round(reviewDepth * 1000) / 1000,
    established: Math.round(established * 1000) / 1000,
    momentum,
    medianReviews: Math.round(median(reviews)),
    sampleTitles: titles.slice(0, 3).map((title) => title.slice(0, 90)),
  };
}

function allQueries(): string[] {
  const queries = new Set<string>();
  const add = (query: string) => queries.add(query.trim().toLowerCase().replace(/\s+/g, ' '));

  for (const bracket of AGE_BRACKET_PROFILES) {
    for (const intent of bracket.universalIntents) add(intent.query);
    for (const intent of bracket.ageIntents) add(intent.query);
  }
  for (const gender of ['woman', 'man'] as const) {
    for (const intent of GENDER_INTENTS[gender]) add(intent.query);
  }
  for (const intent of COMBO_INTENTS) add(intent.query);
  for (const profile of INTEREST_PROFILES) {
    for (const intent of profile.intents) add(intent.query);
  }
  for (const brand of BRANDS) add(brandProductQuery(brand));

  return [...queries].sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The signing key may come from WALMART_PRIVATE_KEY_BASE64 or from the
  // co-located WM_IO_private_key.pem (see lib/walmart.ts), so only the consumer
  // id is a hard prerequisite here.
  if (!process.env.WALMART_CONSUMER_ID) {
    console.error('WALMART_CONSUMER_ID missing — pass --env-file=.env.local.');
    process.exit(2);
  }

  let queries = allQueries();
  if (args.limit > 0) queries = queries.slice(0, args.limit);

  console.log(`Sampling ${queries.length} queries against Walmart sort=bestseller`);
  const sampledAt = new Date().toISOString();
  const started = Date.now();

  let completed = 0;
  const samples = await mapWithConcurrency(queries, args.concurrency, async (query) => {
    try {
      const response = await walmartAPI.searchProducts({
        query,
        sort: 'bestseller',
        numItems: args.sampleSize,
      });
      completed += 1;
      process.stdout.write(`\r  ${completed}/${queries.length} — ${query}`.slice(0, 110));
      return scoreMomentum(query, response.items ?? []);
    } catch (error) {
      return {
        query,
        totalResults: 0,
        sampled: 0,
        relevance: 0,
        reviewDepth: 0,
        established: 0,
        momentum: 0,
        medianReviews: 0,
        sampleTitles: [],
        error: error instanceof Error ? error.message : String(error),
      } satisfies MomentumSample & { error: string };
    }
  });

  process.stdout.write('\n');

  const withData = samples.filter((sample) => sample.sampled > 0);
  const empty = samples.filter((sample) => sample.sampled === 0);

  // ── Generated module ────────────────────────────────────────────────
  const rows = samples
    .map((sample) => `  ${JSON.stringify(sample.query)}: ${sample.momentum},`)
    .join('\n');

  const generatedModule = `// ── Gift momentum (GENERATED — do not edit by hand) ────────────────────
//
// Produced by \`scripts/build-gift-momentum.ts\` from Walmart's sales-ranked
// search (\`sort=bestseller\`). Each value is a 0–1 blend of:
//
//   relevance    share of the bestseller sample that matches the query
//   reviewDepth  median review count of the sample, log-scaled
//   established  share of the sample with at least 50 reviews
//
// It is a *purchase-popularity* signal for the query, not a demographic one,
// and it is Walmart-only — the one sales-ranked feed this app can access.
// Values go stale; re-run the script and commit the result. \`sampledAt\` says
// how old this snapshot is.
//
// Refresh: npx tsx --env-file=.env.local scripts/build-gift-momentum.ts

/** ISO timestamp of the sampling run that produced this table. */
export const MOMENTUM_SAMPLED_AT = ${JSON.stringify(sampledAt)};

/** Number of queries in the table (including ones Walmart did not stock). */
export const MOMENTUM_SAMPLE_SIZE = ${samples.length};

/** Normalized query → momentum in [0, 1]. */
export const MOMENTUM_BY_QUERY: Record<string, number> = {
${rows}
};
`;

  writeFileSync(args.out, generatedModule);

  mkdirSync(dirname(args.evidence), { recursive: true });
  writeFileSync(
    args.evidence,
    `${JSON.stringify(
      {
        generatedAt: sampledAt,
        source: 'walmart sort=bestseller',
        sampleSize: args.sampleSize,
        weights: WEIGHTS,
        durationMs: Date.now() - started,
        summary: {
          queries: samples.length,
          withData: withData.length,
          empty: empty.length,
          meanMomentum:
            Math.round(
              (withData.reduce((sum, sample) => sum + sample.momentum, 0) / Math.max(1, withData.length)) * 1000
            ) / 1000,
        },
        samples,
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${args.out} (${withData.length} queries) and ${args.evidence}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (empty.length > 0) {
    console.log(`\n${empty.length} queries returned nothing from Walmart:`);
    for (const sample of empty.slice(0, 20)) console.log(`  ${sample.query}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
