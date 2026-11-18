/**
 * Probe the authored gift-index layers against the real retailers.
 *
 * The index claims every query returns real listings. This runs the actual
 * gift pipeline (plan → federated search) for every authored intent — age,
 * gender, age×gender, interest and universal — and records what came back.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts --layer age --concurrency 3
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts --limit 20
 *
 * Exit code is non-zero when any probed intent returned nothing.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  AGE_BRACKET_PROFILES,
  COMBO_INTENTS,
  GIFT_INDEX_META,
  GENDER_INTENTS,
  INTEREST_PROFILES,
} from '../search/gift/index-data';
import { buildGiftBrief, intentFamilies, isIntentOfferable, scoreIntent, totalScore } from '../search/gift/brief';
import { buildGiftSearchPlan } from '../search/gift/plan';
import { ageBracketForAge, AGE_BRACKET_LABELS } from '../search/gift/taxonomy';
import { executeSearch } from '../search/orchestrator';
import { getAvailableProviders } from '../search/providers/adapter';
import { mapWithConcurrency } from '../search/concurrency';
import type {
  AgeBracket,
  Gender,
  GiftIntent,
  GiftRecipient,
  InterestId,
  ScoredIntent,
} from '../search/gift/types';

type Layer = 'universal' | 'age' | 'gender' | 'combo' | 'interest';

interface Args {
  layers: Layer[];
  concurrency: number;
  limit: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    layers: ['universal', 'age', 'gender', 'combo', 'interest'],
    concurrency: 3,
    limit: 0,
    out: 'docs/gift-index-evidence.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--layer') args.layers = [argv[++i] as Layer];
    else if (arg === '--concurrency') args.concurrency = Number.parseInt(argv[++i] ?? '3', 10);
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '0', 10);
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
  }
  return args;
}

/** First age that maps into a bracket, using the real bracket mapping. */
function ageForBracket(bracket: AgeBracket): number {
  for (let age = 0; age <= 120; age += 1) {
    if (ageBracketForAge(age) === bracket) return age;
  }
  return 30;
}

function representativeBracket(brackets: AgeBracket[]): AgeBracket {
  return brackets[Math.floor(brackets.length / 2)];
}

interface ProbeTarget {
  layer: Layer;
  sourceId: string;
  intent: GiftIntent;
  age: number;
  gender: Gender;
  bracket: AgeBracket;
}

/**
 * Every authored intent, probed at an age where it is actually offerable.
 * Selection caps are bypassed on purpose: they decide what a shopper sees, not
 * whether an index row works.
 */
function buildTargets(layers: Layer[]): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  const add = (target: ProbeTarget) => {
    if (!isIntentOfferable(target.intent, target.bracket)) return;
    targets.push(target);
  };

  for (const bracket of AGE_BRACKET_PROFILES) {
    const age = ageForBracket(bracket.id);
    if (layers.includes('universal')) {
      for (const intent of bracket.universalIntents) {
        add({ layer: 'universal', sourceId: `universal:${bracket.id}`, intent, age, gender: 'unspecified', bracket: bracket.id });
      }
    }
    if (layers.includes('age')) {
      for (const intent of bracket.ageIntents) {
        add({ layer: 'age', sourceId: `age:${bracket.id}`, intent, age, gender: 'unspecified', bracket: bracket.id });
      }
    }
  }

  if (layers.includes('gender')) {
    for (const gender of ['woman', 'man'] as const) {
      const bracket: AgeBracket = 'adult';
      const age = ageForBracket(bracket);
      for (const intent of GENDER_INTENTS[gender]) {
        add({ layer: 'gender', sourceId: `gender:${gender}`, intent, age, gender, bracket });
      }
    }
  }

  if (layers.includes('combo')) {
    for (const intent of COMBO_INTENTS) {
      const facet = intent.facets.find((entry) => entry.startsWith('combo:'));
      if (!facet) continue;
      const [, bracket, gender] = facet.split(':') as [string, AgeBracket, 'woman' | 'man'];
      add({ layer: 'combo', sourceId: facet, intent, age: ageForBracket(bracket), gender, bracket });
    }
  }

  if (layers.includes('interest')) {
    for (const profile of INTEREST_PROFILES) {
      const bracket = representativeBracket(profile.giftableAgeBrackets);
      const age = ageForBracket(bracket);
      for (const intent of profile.intents) {
        add({
          layer: 'interest',
          sourceId: `interest:${profile.id}`,
          intent,
          age,
          gender: 'unspecified',
          bracket,
        });
      }
    }
  }

  return targets;
}

interface ProbeResult {
  layer: Layer;
  sourceId: string;
  intentId: string;
  interestId: InterestId | null;
  query: string;
  bracket: AgeBracket;
  status: string;
  resultCount: number;
  providersSearched: string[];
  priceRange: { min: number; max: number } | null;
  sampleTitles: string[];
  error?: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providers = getAvailableProviders();

  console.log(`Gift index v${GIFT_INDEX_META.version} — authored layers`);
  console.log(`Providers: ${providers.join(', ') || '(none configured)'}`);
  if (providers.length === 0) {
    console.error('No providers configured — pass --env-file=.env.local.');
    process.exit(2);
  }

  let targets = buildTargets(args.layers);
  if (args.limit > 0) targets = targets.slice(0, args.limit);

  const byLayer = targets.reduce<Record<string, number>>((acc, target) => {
    acc[target.layer] = (acc[target.layer] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Probing ${targets.length} intent(s): ${JSON.stringify(byLayer)}`);

  const started = Date.now();
  let completed = 0;

  const results = await mapWithConcurrency(
    targets,
    args.concurrency,
    async (target): Promise<ProbeResult> => {
      const recipient: GiftRecipient = {
        id: `probe-${target.intent.id}`,
        name: 'Probe',
        gender: target.gender,
        age: target.age,
        interests: target.layer === 'interest' ? [target.sourceId.split(':')[1] as InterestId] : [],
        createdAt: 0,
        updatedAt: 0,
      };

      const brief = buildGiftBrief(recipient, { maxIntents: 1 });
      const breakdown = scoreIntent(target.intent, {
        budgetMax: brief.budget.max,
        gender: target.gender,
        universal: target.layer === 'universal',
      });
      const scored: ScoredIntent = {
        intent: target.intent,
        interest: target.layer === 'interest' ? (target.sourceId.split(':')[1] as InterestId) : null,
        interestLabel: target.layer,
        sourceKey: target.sourceId,
        families: intentFamilies(target.intent),
        score: totalScore(breakdown),
        breakdown,
      };

      const plan = buildGiftSearchPlan(scored, brief, providers);

      try {
        const response = await executeSearch({
          query: target.intent.query,
          preferences: {
            budget: { max: brief.budget.max, currency: 'USD' },
            maxResults: 20,
            allowedConditions: ['new'],
          },
          candidatePlan: plan,
          candidatePlanSource: 'gift',
        });

        const prices = (response.results ?? [])
          .map((entry) => entry.bestOffer?.offer.price?.amount)
          .filter((value): value is number => typeof value === 'number');

        completed += 1;
        process.stdout.write(
          `\r  ${completed}/${targets.length} probed — last: [${target.layer}] ${target.intent.query} → ${response.results?.length ?? 0}`
        );

        return {
          layer: target.layer,
          sourceId: target.sourceId,
          intentId: target.intent.id,
          interestId: target.layer === 'interest' ? (target.sourceId.split(':')[1] as InterestId) : null,
          query: target.intent.query,
          bracket: target.bracket,
          status: response.status,
          resultCount: response.results?.length ?? 0,
          providersSearched: response.metadata?.providersSearched ?? [],
          priceRange:
            prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
          sampleTitles: (response.results ?? [])
            .slice(0, 3)
            .map((entry) => entry.product.title.slice(0, 90)),
          error: response.error,
        };
      } catch (error) {
        return {
          layer: target.layer,
          sourceId: target.sourceId,
          intentId: target.intent.id,
          interestId: target.layer === 'interest' ? (target.sourceId.split(':')[1] as InterestId) : null,
          query: target.intent.query,
          bracket: target.bracket,
          status: 'error',
          resultCount: 0,
          providersSearched: [],
          priceRange: null,
          sampleTitles: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  process.stdout.write('\n');

  const empty = results.filter((entry) => entry.resultCount === 0);
  const byLayerDone = results.reduce<Record<string, { probed: number; withResults: number }>>(
    (acc, entry) => {
      const bucket = acc[entry.layer] ?? { probed: 0, withResults: 0 };
      bucket.probed += 1;
      if (entry.resultCount > 0) bucket.withResults += 1;
      acc[entry.layer] = bucket;
      return acc;
    },
    {}
  );

  const report = {
    generatedAt: new Date().toISOString(),
    indexVersion: GIFT_INDEX_META.version,
    matrix: GIFT_INDEX_META,
    layers: args.layers,
    providers,
    durationMs: Date.now() - started,
    summary: {
      probed: results.length,
      withResults: results.length - empty.length,
      empty: empty.length,
      byLayer: byLayerDone,
    },
    results,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nWrote ${args.out}`);
  console.log(`  ${report.summary.withResults}/${report.summary.probed} intents returned results`);
  console.log(`  ${(report.durationMs / 1000).toFixed(1)}s`);

  if (empty.length > 0) {
    console.log('\nIntents that returned nothing:');
    for (const entry of empty) {
      console.log(
        `  [${entry.layer}] ${entry.intentId} (${AGE_BRACKET_LABELS[entry.bracket]}): "${entry.query}" → ${entry.status}${entry.error ? ` — ${entry.error}` : ''}`
      );
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
