/**
 * Probe the brand catalog against the real retailers.
 *
 * The catalog's membership is editorial. This measures the part that can
 * actually be measured: for each brand's default `"<brand> <noun>"` query, how
 * many listings exist, which retailers carry them, what they cost, and whether
 * the brand name shows up in the results at all. A brand with zero results is a
 * dead row and should be removed from `search/gift/brands.ts`.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/probe-brand-catalog.ts
 *   npx tsx --env-file=.env.local scripts/probe-brand-catalog.ts --limit 20 --concurrency 3
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { BRANDS, brandProductQuery } from '../search/gift/brands';
import { buildGiftBrief, intentFamilies, scoreIntent, totalScore } from '../search/gift/brief';
import { buildGiftSearchPlan } from '../search/gift/plan';
import { executeSearch } from '../search/orchestrator';
import { getAvailableProviders } from '../search/providers/adapter';
import { mapWithConcurrency } from '../search/concurrency';
import { GIFT_INDEX_META } from '../search/gift/index-data';
import type { AgeBracket, BrandProfile, GiftIntent, GiftRecipient, ScoredIntent } from '../search/gift/types';

interface Args {
  concurrency: number;
  limit: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { concurrency: 3, limit: 0, out: 'docs/gift-brand-evidence.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency') args.concurrency = Number.parseInt(argv[++i] ?? '3', 10);
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '0', 10);
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
  }
  return args;
}

/** Age at the middle of the brand's gift window. */
function probeAge(brand: BrandProfile): number {
  const bracket: AgeBracket = brand.ages[Math.floor(brand.ages.length / 2)];
  const ranges: Record<AgeBracket, number> = {
    infant: 0,
    toddler: 2,
    child: 6,
    tween: 10,
    teen: 15,
    young_adult: 21,
    adult: 32,
    mature_adult: 50,
    senior: 70,
  };
  return ranges[bracket];
}

function brandIntent(brand: BrandProfile): GiftIntent {
  return {
    id: `brand/${brand.slug}-${brand.categories[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`,
    query: brandProductQuery(brand),
    kind: 'brand',
    tier: brand.tier,
    strength: brand.strength,
    lean: brand.lean,
    facets: [`brand:${brand.slug}`],
    brands: [brand.name],
    why: 'Brand catalog probe.',
  };
}

interface BrandResult {
  slug: string;
  name: string;
  query: string;
  resultCount: number;
  providersSearched: string[];
  priceRange: { min: number; max: number } | null;
  /** Share of the top results whose title actually contains the brand. */
  brandMatchShare: number;
  sampleTitles: string[];
  error?: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    console.error('No providers configured — pass --env-file=.env.local.');
    process.exit(2);
  }

  let brands = [...BRANDS].sort((a, b) => a.slug.localeCompare(b.slug));
  if (args.limit > 0) brands = brands.slice(0, args.limit);

  console.log(`Brand catalog v${GIFT_INDEX_META.version} — ${brands.length} brand(s)`);
  console.log(`Providers: ${providers.join(', ')}`);

  const started = Date.now();
  let completed = 0;

  const results = await mapWithConcurrency(
    brands,
    args.concurrency,
    async (brand): Promise<BrandResult> => {
      const intent = brandIntent(brand);
      const recipient: GiftRecipient = {
        id: `probe-${brand.slug}`,
        name: 'Probe',
        gender: 'unspecified',
        age: probeAge(brand),
        interests: brand.interests.slice(0, 1),
        createdAt: 0,
        updatedAt: 0,
      };

      try {
        const brief = buildGiftBrief(recipient, { maxIntents: 1 });
        const breakdown = scoreIntent(intent, {
          budgetMax: brief.budget.max,
          gender: 'unspecified',
        });
        const scored: ScoredIntent = {
          intent,
          interest: brand.interests[0] ?? null,
          interestLabel: brand.name,
          sourceKey: `brand:${brand.slug}`,
          families: intentFamilies(intent),
          score: totalScore(breakdown),
          breakdown,
        };

        const response = await executeSearch({
          query: intent.query,
          preferences: {
            budget: { max: brief.budget.max, currency: 'USD' },
            maxResults: 20,
            allowedConditions: ['new'],
          },
          candidatePlan: buildGiftSearchPlan(scored, brief, providers),
          candidatePlanSource: 'gift',
        });

        const rows = response.results ?? [];
        const prices = rows
          .map((entry) => entry.bestOffer?.offer.price?.amount)
          .filter((value): value is number => typeof value === 'number');
        const needle = brand.name.toLowerCase();
        const matches = rows.filter((entry) =>
          entry.product.title.toLowerCase().includes(needle.split(' ')[0])
        ).length;

        completed += 1;
        process.stdout.write(
          `\r  ${completed}/${brands.length} — ${brand.name} → ${rows.length}\n`.slice(0, 120)
        );

        return {
          slug: brand.slug,
          name: brand.name,
          query: intent.query,
          resultCount: rows.length,
          providersSearched: response.metadata?.providersSearched ?? [],
          priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
          brandMatchShare: rows.length > 0 ? Math.round((matches / rows.length) * 100) / 100 : 0,
          sampleTitles: rows.slice(0, 3).map((entry) => entry.product.title.slice(0, 90)),
          error: response.error,
        };
      } catch (error) {
        return {
          slug: brand.slug,
          name: brand.name,
          query: intent.query,
          resultCount: 0,
          providersSearched: [],
          priceRange: null,
          brandMatchShare: 0,
          sampleTitles: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  process.stdout.write('\n');

  const empty = results.filter((entry) => entry.resultCount === 0);
  const weak = results.filter((entry) => entry.resultCount > 0 && entry.brandMatchShare < 0.2);

  const report = {
    generatedAt: new Date().toISOString(),
    indexVersion: GIFT_INDEX_META.version,
    providers,
    durationMs: Date.now() - started,
    summary: {
      brands: results.length,
      withResults: results.length - empty.length,
      empty: empty.length,
      weakBrandMatch: weak.length,
    },
    results,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${args.out}`);
  console.log(
    `  ${report.summary.withResults}/${report.summary.brands} brands returned listings; ` +
      `${report.summary.weakBrandMatch} returned listings that barely mention the brand`
  );

  if (empty.length > 0) {
    console.log('\nBrands with no listings:');
    for (const entry of empty) console.log(`  ${entry.slug}: "${entry.query}" → ${entry.error ?? 'no results'}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
