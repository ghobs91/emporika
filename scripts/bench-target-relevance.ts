/**
 * Relevance benchmark for the local Target catalog index.
 *
 * Title-only matching over 2.6M products has no popularity signal and no
 * category taxonomy, so "does it return the right kind of thing" has to be
 * MEASURED against a fixed query set rather than asserted. Each case names the
 * token groups a shopper's intent requires; a result passes when its title
 * contains at least one token from every group.
 *
 * Usage: npx tsx scripts/bench-target-relevance.ts [--k 5] [--verbose]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadTargetIndex, resetTargetIndexCache } from '../lib/target-index';
import { buildCorpusIndex, decodeCorpus, CORPUS_URL } from '../lib/target-corpus';

interface Case {
  query: string;
  /** Every group must be represented in a title for it to count as relevant. */
  require: string[][];
}

const CASES: Case[] = [
  { query: 'samsung 65 inch tv', require: [['samsung'], ['tv', 'television'], ['65']] },
  { query: 'ninja air fryer', require: [['ninja'], ['fryer']] },
  { query: 'sony noise cancelling headphones', require: [['sony'], ['headphone', 'headphones']] },
  { query: 'stanley 40 oz tumbler', require: [['stanley'], ['tumbler']] },
  { query: 'lego star wars set', require: [['lego'], ['star', 'wars']] },
  { query: 'apple watch band', require: [['apple'], ['watch'], ['band']] },
  { query: 'dyson vacuum', require: [['dyson'], ['vacuum']] },
  { query: 'airpods pro', require: [['airpods']] },
  { query: 'office chair', require: [['chair']] },
  { query: 'keurig coffee maker', require: [['keurig'], ['coffee']] },
  { query: 'instant pot 6 quart', require: [['instant'], ['pot']] },
  { query: 'iphone 15 case', require: [['iphone'], ['case']] },
  { query: 'cast iron skillet 12 inch', require: [['iron'], ['skillet']] },
  { query: 'queen bed sheets', require: [['sheet', 'sheets']] },
  { query: 'usb c cable', require: [['usb'], ['cable']] },
  { query: 'cat litter', require: [['litter']] },
  { query: 'micro sd card 64gb', require: [['card']] },
  { query: 'winter coat women', require: [['coat']] },
  { query: 'bluetooth speaker', require: [['speaker']] },
  { query: 'robot vacuum', require: [['robot'], ['vacuum']] },
  { query: 'water bottle stainless steel', require: [['bottle']] },
  { query: 'wireless mouse', require: [['mouse']] },
  { query: 'mechanical keyboard', require: [['keyboard']] },
  { query: 'memory foam pillow', require: [['pillow']] },
  { query: 'yeti rambler', require: [['yeti', 'rambler']] },
  { query: 'nike hoodie', require: [['nike'], ['hoodie']] },
  { query: 'adidas sneakers', require: [['adidas'], ['sneaker', 'sneakers', 'shoe', 'shoes']] },
  { query: 'levis jeans', require: [['levi', 'levis'], ['jean', 'jeans']] },
  { query: 'ninja blender', require: [['ninja'], ['blender']] },
  { query: 'nintendo switch game', require: [['nintendo'], ['switch']] },
];

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** A title is relevant when every required group has at least one token present. */
function isRelevant(title: string, require: string[][]): boolean {
  const tokens = tokensOf(title);
  return require.every((group) =>
    group.some((want) => tokens.some((tok) => tok === want || tok.startsWith(want)))
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const k = Number(argv[argv.indexOf('--k') + 1]) || 5;
  const verbose = argv.includes('--verbose');
  const start = Date.now();

  // `--corpus` exercises the browser-shippable packed corpus instead of SQLite,
  // so the two backends are measured by the same yardstick.
  let index: { size: number; query(q: string, n: number): Array<{ title: string }> };
  let teardown: () => void;

  if (argv.includes('--corpus')) {
    const file = path.resolve(process.cwd(), 'public', CORPUS_URL.replace(/^\//, ''));
    const bytes = new Uint8Array(readFileSync(file));
    const decodedAt = Date.now();
    const corpus = decodeCorpus(bytes);
    const corpusIndex = buildCorpusIndex(corpus);
    console.log(
      `corpus: ${bytes.byteLength.toLocaleString()} bytes, ${corpusIndex.size.toLocaleString()} products ` +
        `(decoded+indexed in ${Date.now() - decodedAt}ms)`
    );
    index = {
      size: corpusIndex.size,
      query: (q, n) => corpusIndex.query(q, n).map((hit) => ({ title: hit.title })),
    };
    teardown = () => {};
  } else {
    const sqlite = await loadTargetIndex();
    console.log(`sqlite: ${sqlite.size.toLocaleString()} products (opened in ${Date.now() - start}ms)`);
    index = {
      size: sqlite.size,
      query: (q, n) => sqlite.query(q, n).map((hit) => ({ title: hit.record.title })),
    };
    teardown = () => {
      sqlite.close();
      resetTargetIndexCache();
    };
  }
  console.log(`k=${k}\n`);

  let queriesWithAnyHit = 0;
  let relevantAt1 = 0;
  let relevantTotal = 0;
  let returned = 0;

  for (const testCase of CASES) {
    const hits = index.query(testCase.query, k);
    const relevant = hits.filter((hit) => isRelevant(hit.title, testCase.require));
    if (hits.length > 0) queriesWithAnyHit += 1;
    returned += hits.length;
    relevantTotal += relevant.length;
    if (hits.length > 0 && isRelevant(hits[0].title, testCase.require)) relevantAt1 += 1;

    const mark = relevant.length > 0 ? 'PASS' : 'FAIL';
    console.log(
      `${mark} "${testCase.query}" -> ${relevant.length}/${hits.length} relevant` +
        (hits.length === 0 ? ' (no hits)' : '')
    );
    if (verbose) {
      for (const hit of hits.slice(0, k)) {
        const ok = isRelevant(hit.title, testCase.require) ? '  +' : '  -';
        console.log(`${ok} ${hit.title.slice(0, 78)}`);
      }
    }
  }

  const n = CASES.length;
  console.log('\n── summary ──');
  console.log(`queries answered:  ${queriesWithAnyHit}/${n} (${((queriesWithAnyHit / n) * 100).toFixed(0)}%)`);
  console.log(`relevant @1:       ${relevantAt1}/${n} (${((relevantAt1 / n) * 100).toFixed(0)}%)`);
  console.log(`precision @${k}:       ${relevantTotal}/${returned} (${returned ? ((relevantTotal / returned) * 100).toFixed(0) : 0}%)`);

  teardown();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
