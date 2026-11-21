/**
 * Precompute Target search results into a static artifact.
 *
 * This is the production serving path. The full catalog index
 * (`data/target-index/target.sqlite`, ~433MB) cannot be opened on a host with
 * no persistent disk, so the search runs here — at build time, in CI, where
 * there is a real filesystem — and the runtime does an object lookup instead.
 *
 * Prerequisites:
 *   npx tsx scripts/target-sitemap.ts --all      # shard artifacts
 *   npx tsx scripts/target-index-build.ts        # SQLite FTS5 index
 *
 * Then:
 *   npx tsx scripts/target-precompute.ts
 *
 * Schedule it alongside the sitemap refresh (GitHub Actions, like
 * `scripts/fetch-trends.ts`). Commit the resulting artifact.
 *
 * Coverage is a product decision, not a runtime constraint: only queries in the
 * generated vocabulary are answered in production. The vocabulary is drawn from
 * observed trends, the curated brand catalogue, and a seed list of common
 * shopping queries — in that order, so the cap truncates the least valuable
 * entries first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import path from 'node:path';
import { BRANDS, brandProductQuery } from '../search/gift/brands';
import { loadTargetIndex, readManifest, resetTargetIndexCache } from '../lib/target-index';
import { buildQueryVocabulary, MAX_VOCABULARY_QUERIES } from '../lib/target-vocabulary';
import { TARGET_PRECOMPUTED_PATH, type PrecomputedTargetHitTuple } from '../lib/target-precomputed';

interface Options {
  out: string;
  hitLimit: number;
  maxQueries: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    out: TARGET_PRECOMPUTED_PATH,
    hitLimit: 8,
    maxQueries: MAX_VOCABULARY_QUERIES,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--out':
        options.out = argv[++i] ?? options.out;
        break;
      case '--hit-limit':
        options.hitLimit = Number(argv[++i] ?? options.hitLimit);
        break;
      case '--max-queries':
        options.maxQueries = Number(argv[++i] ?? options.maxQueries);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.hitLimit) || options.hitLimit < 1 || options.hitLimit > 24) {
    throw new Error('--hit-limit must be an integer between 1 and 24');
  }
  if (!Number.isInteger(options.maxQueries) || options.maxQueries < 1) {
    throw new Error('--max-queries must be a positive integer');
  }
  return options;
}

/** Every string in the committed trend manifest, in cohort order. */
function readTrendTerms(): string[] {
  const file = path.resolve(process.cwd(), 'public/data/trends.json');
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      cohorts?: Record<string, Record<string, string[]>>;
    };
    const terms: string[] = [];
    for (const buckets of Object.values(manifest.cohorts ?? {})) {
      for (const bucket of Object.values(buckets)) {
        for (const term of bucket) terms.push(term);
      }
    }
    return terms;
  } catch {
    console.warn(`  (no readable trend manifest at ${file}; skipping that source)`);
    return [];
  }
}

/**
 * Seed queries for categories the brand catalogue does not cover.
 *
 * Deliberately generic and high-frequency: these are the searches a shopper
 * actually types, not a taxonomy dump.
 */
/**
 * High-volume nouns crossed with the brand catalogue.
 *
 * The catalogue supplies `brandProductQuery` pairs ("Nike airpods"), but
 * shoppers overwhelmingly type a brand plus a generic noun — "nike hoodie",
 * "sony headphones". Without this cross product the vocabulary covers the
 * catalogue's own framing and misses the commonest real phrasing.
 */
const BRAND_MODIFIER_NOUNS = [
  'hoodie', 't shirt', 'jacket', 'jeans', 'sneakers', 'shoes', 'dress',
  'backpack', 'water bottle', 'headphones', 'earbuds', 'charger', 'cable',
  'phone case', 'air fryer', 'blender', 'coffee maker', 'bed sheets',
  'pillow', 'towel',
];

const SEED_QUERIES = [
  'usb c cable', 'usb c charger', 'phone charger', 'lightning cable', 'hdmi cable',
  'wireless earbuds', 'bluetooth headphones', 'phone case', 'screen protector',
  'power bank', 'smart watch', 'fitness tracker', 'tablet', 'laptop', 'monitor',
  'mechanical keyboard', 'wireless mouse', 'webcam', 'router', 'ssd',
  'air fryer', 'instant pot', 'coffee maker', 'kettle', 'toaster', 'blender',
  'stand mixer', 'cast iron skillet', 'baking sheet', 'cutting board', 'food storage',
  'vacuum cleaner', 'robot vacuum', 'mop', 'laundry detergent', 'dish soap',
  'trash bags', 'paper towels', 'cat litter', 'dog food', 'cat food', 'pet bed',
  'bed sheets', 'comforter', 'pillow', 'mattress protector', 'curtains', 'rug',
  'table lamp', 'storage bins', 'picture frame', 'wall shelf',
  't shirt', 'hoodie', 'jeans', 'leggings', 'sneakers', 'boots', 'socks',
  'winter coat', 'rain jacket', 'swimsuit', 'pajamas', 'underwear',
  'shampoo', 'conditioner', 'body wash', 'face moisturizer', 'sunscreen',
  'toothbrush', 'deodorant', 'makeup remover', 'hair dryer', 'perfume',
  'vitamins', 'protein powder', 'first aid kit', 'thermometer',
  'lego set', 'board game', 'puzzle', 'action figure', 'doll', 'stuffed animal',
  'baby wipes', 'diapers', 'baby monitor', 'car seat', 'stroller',
  'water bottle', 'lunch box', 'backpack', 'umbrella', 'sunglasses',
  'christmas tree', 'christmas lights', 'gift wrap', 'halloween costume',
  'throw blanket', 'candle', 'wall art', 'mirror', 'bookshelf', 'desk',
  'office chair', 'standing desk', 'printer paper', 'notebook', 'pens',
  'garden hose', 'plant pot', 'lawn mower', 'patio furniture', 'grill',
  'bike helmet', 'yoga mat', 'dumbbells', 'resistance bands', 'tent',
  'sleeping bag', 'cooler', 'fishing rod', 'camping chair',
  // High-velocity single products that shoppers search by name and that the
  // brand catalogue does not carry as a brand+category pair.
  'stanley cup', 'owala water bottle', 'airpods', 'airtag', 'kindle',
  'nintendo switch', 'playstation 5', 'xbox controller', 'instant pot',
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log('Loading catalog index…');
  const index = await loadTargetIndex();
  const productCount = index.size;
  console.log(`  ${productCount.toLocaleString()} products`);

  // Highest-value sources first: the cap truncates the tail.
  const trendTerms = readTrendTerms();
  const brandNames = BRANDS.map((brand) => brand.name);
  const brandCategories = BRANDS.flatMap((brand) => brand.categories ?? []);
  const brandQueries = BRANDS.map((brand) => brandProductQuery(brand));

  const brandNounQueries = brandNames.flatMap((name) =>
    BRAND_MODIFIER_NOUNS.map((noun) => `${name} ${noun}`)
  );

  const vocabulary = buildQueryVocabulary(
    [
      trendTerms,
      brandQueries,
      brandCategories,
      brandNounQueries,
      brandNames,
      SEED_QUERIES,
    ],
    options.maxQueries
  );

  console.log(
    `Vocabulary: ${vocabulary.length.toLocaleString()} queries from ` +
      `trends ${trendTerms.length}, brand queries ${brandQueries.length}, ` +
      `brand categories ${new Set(brandCategories).size}, ` +
      `brand x noun ${brandNounQueries.length}, seeds ${SEED_QUERIES.length}`
  );

  const queries: Record<string, PrecomputedTargetHitTuple[]> = {};
  let totalHits = 0;
  let emptyQueries = 0;

  const started = Date.now();
  vocabulary.forEach((query, i) => {
    const hits = index.query(query, options.hitLimit);
    queries[query] = hits.map((hit) => [hit.record.tcin, hit.record.title]);
    totalHits += hits.length;
    if (hits.length === 0) emptyQueries += 1;
    if ((i + 1) % 500 === 0) {
      console.log(`  ${(i + 1).toLocaleString()}/${vocabulary.length.toLocaleString()} queries`);
    }
  });
  index.close();
  resetTargetIndexCache();

  const manifest = await readManifest();
  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      products: productCount,
      shards: manifest ? Object.values(manifest.shards).filter((s) => s.fetched).length : 0,
      hitLimit: options.hitLimit,
    },
    queries,
  };

  const outPath = path.resolve(process.cwd(), options.out);
  // Minified: this is machine-read, and pretty-printing ~2MB of tuples would
  // roughly double it. Git still diffs it acceptably at line granularity.
  writeFileSync(outPath, JSON.stringify(artifact));

  const bytes = statSync(outPath).size;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log('');
  console.log(
    `Wrote ${options.out}: ${vocabulary.length.toLocaleString()} queries, ` +
      `${totalHits.toLocaleString()} hits, ${(bytes / 1e6).toFixed(2)}MB in ${seconds}s`
  );
  console.log(
    `  coverage: ${(vocabulary.length - emptyQueries).toLocaleString()} queries returned results, ` +
      `${emptyQueries.toLocaleString()} returned none ` +
      `(${((emptyQueries / vocabulary.length) * 100).toFixed(0)}% miss rate)`
  );
  console.log('  Commit this file; it is read at runtime by lib/target-precomputed.ts.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
