/**
 * Probe the gift index against the real retailers.
 *
 * The index in `search/gift/index-data.ts` claims every `query` returns real
 * listings. This script is how that claim gets checked, and it is the reason
 * the index can be called researched rather than invented: it runs the actual
 * gift pipeline (plan → federated search) and records what came back.
 *
 * It deliberately bypasses intent *selection* (the per-interest cap and the
 * neutral-majority rule), because those decide what a shopper sees, not
 * whether an index entry works. Every offerable intent is probed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts --all
 *   npx tsx --env-file=.env.local scripts/probe-gift-index.ts --per-interest 3 --concurrency 1
 *
 * Exit code is non-zero when any probed intent returned nothing, so this can
 * gate a change to the index.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { INTEREST_PROFILES, AGE_BRACKET_PROFILES, GIFT_INDEX_VERSION } from '../search/gift/index-data';
import { buildGiftBrief, isIntentOfferable, scoreIntent } from '../search/gift/brief';
import { buildGiftSearchPlan } from '../search/gift/plan';
import { ageBracketForAge, AGE_BRACKET_LABELS } from '../search/gift/taxonomy';
import { executeSearch } from '../search/orchestrator';
import { getAvailableProviders } from '../search/providers/adapter';
import { mapWithConcurrency } from '../search/concurrency';
import type {
  AgeBracket,
  GiftIntent,
  GiftRecipient,
  InterestId,
  ScoredIntent,
} from '../search/gift/types';

interface Args {
  perInterest: number;
  concurrency: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    perInterest: 1,
    concurrency: 2,
    out: 'docs/gift-index-evidence.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.perInterest = Number.POSITIVE_INFINITY;
    else if (arg === '--per-interest') {
      args.perInterest = Number.parseInt(argv[++i] ?? '1', 10);
    } else if (arg === '--concurrency') {
      args.concurrency = Number.parseInt(argv[++i] ?? '2', 10);
    } else if (arg === '--out') args.out = argv[++i] ?? args.out;
  }
  return args;
}

/** Middle bracket of an interest's giftable window — the most representative. */
function representativeBracket(brackets: AgeBracket[]): AgeBracket {
  return brackets[Math.floor(brackets.length / 2)];
}

/** First age that maps into a bracket, using the real bracket mapping. */
function ageForBracket(bracket: AgeBracket): number {
  for (let age = 0; age <= 120; age += 1) {
    if (ageBracketForAge(age) === bracket) return age;
  }
  return 30;
}

interface ProbeTarget {
  /** `null` for bracket-universal fallback gifts. */
  interestId: InterestId | null;
  interestLabel: string;
  intent: GiftIntent;
  age: number;
  bracket: AgeBracket;
}

function buildTargets(perInterest: number): ProbeTarget[] {
  const targets: ProbeTarget[] = [];

  for (const profile of INTEREST_PROFILES) {
    const bracket = representativeBracket(profile.giftableAgeBrackets);
    const age = ageForBracket(bracket);
    const offerable = profile.intents
      .filter((intent) => isIntentOfferable(intent, bracket))
      // Strongest first, so a partial run covers the most important entries.
      .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));

    for (const intent of offerable.slice(0, perInterest)) {
      targets.push({
        interestId: profile.id,
        interestLabel: profile.label,
        intent,
        age,
        bracket,
      });
    }
  }

  // Bracket-universal fallbacks are shipped gift ideas too, so they get
  // probed at their own bracket rather than at an interest's representative
  // age (a toddler-intent really can only be judged at toddler age).
  if (perInterest > 1) {
    for (const bracket of AGE_BRACKET_PROFILES) {
      for (const intent of bracket.universalIntents) {
        targets.push({
          interestId: null,
          interestLabel: 'Everyone',
          intent,
          age: ageForBracket(bracket.id),
          bracket: bracket.id,
        });
      }
    }
  }

  return targets;
}

interface ProbeResult {
  intentId: string;
  interestId: InterestId | null;
  interestLabel: string;
  query: string;
  bracket: AgeBracket;
  status: string;
  resultCount: number;
  providersSearched: string[];
  providersUnavailable: string[];
  priceRange: { min: number; max: number } | null;
  sampleTitles: string[];
  error?: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providers = getAvailableProviders();

  console.log(`Gift index v${GIFT_INDEX_VERSION}`);
  console.log(`Providers: ${providers.join(', ') || '(none configured)'}`);
  if (providers.length === 0) {
    console.error('No providers configured — pass --env-file=.env.local.');
    process.exit(2);
  }

  const targets = buildTargets(args.perInterest);
  console.log(
    `Probing ${targets.length} intent(s) with concurrency ${args.concurrency}` +
      (args.perInterest === Number.POSITIVE_INFINITY
        ? ' (every offerable intent)'
        : ` (up to ${args.perInterest} per interest)`)
  );

  const started = Date.now();
  let completed = 0;

  const results = await mapWithConcurrency(
    targets,
    args.concurrency,
    async (target): Promise<ProbeResult> => {
      const recipient: GiftRecipient = {
        id: `probe-${target.intent.id}`,
        name: 'Probe',
        gender: 'unspecified',
        age: target.age,
        interests: target.interestId ? [target.interestId] : [],
        createdAt: 0,
        updatedAt: 0,
      };

      // The brief supplies the real budget ceiling and age exclusions.
      const brief = buildGiftBrief(recipient, { maxIntents: 1 });
      const breakdown = scoreIntent(target.intent, {
        budgetMax: brief.budget.max,
        gender: 'unspecified',
        universal: target.interestId === null,
      });
      const scored: ScoredIntent = {
        intent: target.intent,
        interest: target.interestId,
        interestLabel: target.interestLabel,
        score: target.intent.strength,
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
          `\r  ${completed}/${targets.length} probed — last: ${target.intent.query} → ${response.results?.length ?? 0}`
        );

        return {
          intentId: target.intent.id,
          interestId: target.interestId,
          interestLabel: target.interestLabel,
          query: target.intent.query,
          bracket: target.bracket,
          status: response.status,
          resultCount: response.results?.length ?? 0,
          providersSearched: response.metadata?.providersSearched ?? [],
          providersUnavailable: (response.metadata?.providersFailed ?? []).map(
            (entry) => entry.providerId
          ),
          priceRange:
            prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
          sampleTitles: (response.results ?? [])
            .slice(0, 3)
            .map((entry) => entry.product.title.slice(0, 90)),
          error: response.error,
        };
      } catch (error) {
        return {
          intentId: target.intent.id,
          interestId: target.interestId,
          interestLabel: target.interestLabel,
          query: target.intent.query,
          bracket: target.bracket,
          status: 'error',
          resultCount: 0,
          providersSearched: [],
          providersUnavailable: [],
          priceRange: null,
          sampleTitles: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  process.stdout.write('\n');

  const empty = results.filter((entry) => entry.resultCount === 0);
  const coveredInterests = new Set(
    results.filter((r) => r.resultCount > 0 && r.interestId).map((r) => r.interestId)
  );

  const report = {
    generatedAt: new Date().toISOString(),
    indexVersion: GIFT_INDEX_VERSION,
    mode: args.perInterest === Number.POSITIVE_INFINITY ? 'all-intents' : `per-interest-${args.perInterest}`,
    providers,
    durationMs: Date.now() - started,
    summary: {
      probed: results.length,
      withResults: results.length - empty.length,
      empty: empty.length,
      interestsCovered: coveredInterests.size,
      interestsTotal: INTEREST_PROFILES.length,
    },
    results,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nWrote ${args.out}`);
  console.log(
    `  ${report.summary.withResults}/${report.summary.probed} intents returned results ` +
      `(${report.summary.interestsCovered}/${report.summary.interestsTotal} interests covered)`
  );
  console.log(`  ${(report.durationMs / 1000).toFixed(1)}s`);

  if (empty.length > 0) {
    console.log('\nIntents that returned nothing:');
    for (const entry of empty) {
      console.log(
        `  ${entry.intentId} (${AGE_BRACKET_LABELS[entry.bracket]}): "${entry.query}" → ${entry.status}${entry.error ? ` — ${entry.error}` : ''}`
      );
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
