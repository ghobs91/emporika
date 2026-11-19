/**
 * Embedding-model bake-off for the gift index.
 *
 * Picks the local model on evidence instead of reputation: every candidate is
 * downloaded, run on this machine, and scored on the two jobs the app actually
 * does — mapping a free-text query to a gift intent, and ranking a product
 * title against a query.
 *
 * Reports quality per megabyte, load time and embedding latency.
 *
 *   npx tsx scripts/bench-embedding-models.ts
 *   npx tsx scripts/bench-embedding-models.ts --models minilm-q8,bge-small-q8
 *   npx tsx scripts/bench-embedding-models.ts --out docs/embedding-bench.json
 */

import { writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { giftCorpus } from '../lib/gift/corpus';

interface Candidate {
  id: string;
  /** Transformers.js model id. */
  model: string;
  /** ONNX quantization to request. */
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  /** Prefixes some models were trained with (bge/e5). Empty = symmetric use. */
  queryPrefix?: string;
  docPrefix?: string;
  notes: string;
}

/**
 * Candidates chosen for the size/quality frontier, not a leaderboard sweep.
 * Everything here is available as ONNX for Transformers.js.
 */
const CANDIDATES: Candidate[] = [
  {
    id: 'minilm-q8',
    model: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'q8',
    notes: 'current baseline · 22M params · 384d',
  },
  {
    id: 'minilm-q4',
    model: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'q4',
    notes: 'same model, 4-bit — tests how much quantization costs',
  },
  {
    id: 'gte-tiny-q8',
    model: 'Xenova/gte-tiny',
    dtype: 'q8',
    notes: '17M params · 384d — smaller than the baseline',
  },
  {
    id: 'minilm-l12-q8',
    model: 'Xenova/all-MiniLM-L12-v2',
    dtype: 'q8',
    notes: '33M params · 384d — the deeper MiniLM',
  },
  {
    id: 'gte-small-q8',
    model: 'Xenova/gte-small',
    dtype: 'q8',
    notes: '30M params · 384d',
  },
  {
    id: 'bge-small-q8',
    model: 'Xenova/bge-small-en-v1.5',
    dtype: 'q8',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    notes: '33M params · 384d · retrieval-tuned, wants a query prefix',
  },
  {
    id: 'e5-small-q8',
    model: 'Xenova/e5-small-v2',
    dtype: 'q8',
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
    notes: '33M params · 384d · trained with query/passage prefixes',
  },
  {
    id: 'jina-small-q8',
    model: 'Xenova/jina-embeddings-v2-small-en',
    dtype: 'q8',
    notes: '33M params · 512d · 8k context',
  },
  {
    id: 'arctic-xs-q8',
    model: 'Snowflake/snowflake-arctic-embed-xs',
    dtype: 'q8',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    notes: '22M params · 384d — smallest retrieval-tuned candidate',
  },
  {
    id: 'arctic-s-q8',
    model: 'Snowflake/snowflake-arctic-embed-s',
    dtype: 'q8',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    notes: '33M params · 384d · retrieval-tuned',
  },
  {
    id: 'bge-base-q8',
    model: 'Xenova/bge-base-en-v1.5',
    dtype: 'q8',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    notes: '109M params · 768d — the "is bigger worth it" control',
  },
];

// ── Evaluation set ─────────────────────────────────────────────────────

interface IntentCase {
  query: string;
  /** Any of these corpus *queries* counts as correct (ids are an impl detail). */
  accept: string[];
}

/**
 * Queries a shopper would plausibly type, with the intents a human would accept.
 * Kept small and hand-checked: a bad label is worse than a small set.
 */
const INTENT_CASES: IntentCase[] = [
  {
    query: 'cozy baking afternoon with fresh bread',
    accept: ['sourdough starter kit', 'stand mixer', 'piping tip set'],
  },
  {
    query: 'gift for someone who just got into espresso',
    accept: ['espresso machine', 'coffee grinder'],
  },
  {
    query: 'my dad is always in the garage tinkering',
    accept: ['cordless drill', 'tool set', 'multitool'],
  },
  {
    query: 'she loves plants and has a tiny balcony',
    accept: ['ceramic plant pots', 'gardening tool set', 'seed starter kit'],
  },
  {
    query: 'something for a teenager who games all day',
    accept: ['gaming headset', 'wireless controller', 'gaming mouse'],
  },
  {
    query: 'gift for a newborn baby',
    accept: ['baby sensory toys', 'organic cotton baby blanket', 'silicone teether set'],
  },
  {
    query: 'keeps drinks cold on a long hike',
    accept: ['insulated water bottle', 'headlamp'],
  },
  {
    query: 'home office upgrade for someone who works from home',
    accept: ['usb c hub', 'desk organizer', 'wireless charging stand'],
  },
  {
    query: 'grilling season is coming up',
    accept: ['meat thermometer', 'grill tool set', 'bbq rub gift set'],
  },
  {
    query: 'she reads every night before bed',
    accept: ['book light', 'bookends', 'e reader'],
  },
  {
    query: 'something to help them relax and unwind',
    accept: ['scented candle', 'yoga mat', 'reed diffuser'],
  },
  {
    query: 'a gift for someone who just moved into their first apartment',
    accept: ['weighted blanket', 'desk lamp', 'packing cubes'],
  },
  {
    query: 'my mom loves cooking shows and fancy kitchen gear',
    accept: ['chef knife', 'cast iron skillet', 'cutting board'],
  },
  {
    query: 'gift for a runner training for a marathon',
    accept: ['running socks', 'running watch', 'running shoes'],
  },
  {
    query: 'something handmade and crafty',
    accept: ['knitting kit', 'crochet hooks set', 'watercolor set'],
  },
  {
    query: 'they just got a puppy',
    accept: ['dog toy bundle', 'pet bed', 'pet grooming brush'],
  },
  {
    query: 'something warm and stylish for winter',
    accept: ['cashmere scarf', 'cashmere sweater', 'beanie hat'],
  },
  {
    query: 'a hobby they can do at home on rainy days',
    accept: ['board game', 'jigsaw puzzle', 'sketchbook'],
  },
  {
    query: 'gift for a grandmother who loves her garden',
    accept: ['garden gloves', 'bird feeder', 'ergonomic garden tool'],
  },
  {
    query: 'something for a kid who is obsessed with dinosaurs',
    accept: ['lego set', 'stuffed animal plush', 'magnetic building tiles'],
  },
  {
    query: 'gift for someone starting a new office job',
    accept: ['desk organizer', 'leather briefcase', 'usb c hub'],
  },
  {
    query: 'they are always cold',
    accept: ['heated throw blanket', 'weighted blanket', 'throw blanket'],
  },
  {
    query: 'gift for someone who drinks whiskey',
    accept: ['whiskey glass set', 'whiskey decanter set', 'wine decanter'],
  },
  {
    query: 'something to take to the beach',
    accept: ['insulated water bottle', 'sunglasses', 'packing cubes'],
  },
  {
    query: 'gift for a cyclist who commutes every day',
    accept: ['bike lights', 'bike multitool', 'cycling gloves'],
  },
  {
    query: 'something for a coffee snob',
    accept: ['espresso machine', 'coffee grinder', 'pour over coffee maker'],
  },
  {
    query: 'gift for someone who travels a lot for work',
    accept: ['packing cubes', 'carry on luggage', 'universal travel adapter'],
  },
  {
    query: 'gift for a teenager starting high school',
    accept: ['backpack', 'wireless earbuds', 'led strip lights'],
  },
];

interface ProductCase {
  query: string;
  /** The title a shopper would want. */
  good: string;
  /** Titles that share vocabulary but are the wrong product. */
  distractors: string[];
}

/** Taken from the real retailer probe, including the failures we had to fix. */
const PRODUCT_CASES: ProductCase[] = [
  {
    query: 'coffee grinder',
    good: 'Manual Coffee Grinder Ceramic Burr Hand Crank Portable Adjustable',
    distractors: ['4 PCS Herb Tobacco Grinder Spice Herbal Metal Crusher', 'Coffee Mug 12oz Ceramic'],
  },
  {
    query: 'wireless earbuds',
    good: 'Wireless Earbuds Bluetooth 5.3 with Charging Case',
    distractors: ['Earbud Replacement Tips Silicone 6 Pairs', 'Bluetooth Speaker Waterproof'],
  },
  {
    query: 'cast iron skillet',
    good: 'Lodge 12 Inch Pre-Seasoned Cast Iron Skillet',
    distractors: ['Cast Iron Skillet Handle Cover Silicone', 'Nonstick Frying Pan 10 Inch'],
  },
  {
    query: 'cashmere scarf',
    good: 'Cashmere Triangle Scarf for Women Soft Knit',
    distractors: ['Scarf Hanger Organizer 10 Pack', 'Wool Blend Beanie'],
  },
  {
    query: 'yoga mat',
    good: 'Manduka PRO Yoga Mat 6mm Non-Slip',
    distractors: ['Yoga Mat Strap Carrier', 'Exercise Ball Pump'],
  },
  {
    query: 'meat thermometer',
    good: 'ThermoPro Wireless Meat Thermometer 500ft Range',
    distractors: ['Thermometer Probe Replacement for Grills', 'Oven Mitt Pair'],
  },
  {
    query: 'noise cancelling headphones',
    good: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    distractors: ['Headphone Replacement Earpads Cushions', 'Bluetooth Speaker Waterproof'],
  },
  {
    query: 'chef knife',
    good: 'Wusthof Classic Chef Knife 8 Inch',
    distractors: ['Chef Knife Sharpener Manual', 'Bamboo Cutting Board Large'],
  },
  {
    query: 'stand mixer',
    good: 'KitchenAid Artisan Series 5 Qt Stand Mixer',
    distractors: ['Stand Mixer Attachments Pasta Maker', 'Hand Mixer Electric'],
  },
  {
    query: 'running socks',
    good: 'Balega Hidden Comfort Running Socks 3 Pack',
    distractors: ['Sock Drawer Organizer Dividers', 'Running Shoes Trail'],
  },
  {
    query: 'scented candle',
    good: 'Voluspa Japonica Scented Candle 9oz',
    distractors: ['Candle Lighter Rechargeable', 'Reed Diffuser Set'],
  },
  {
    query: 'gaming headset',
    good: 'Razer BlackShark V2 Gaming Headset',
    distractors: ['Gaming Headset Stand Holder', 'Gaming Mouse Wireless'],
  },
];

// ── Metrics ────────────────────────────────────────────────────────────

function cosine(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function rankOf(scores: number[], correctIndices: Set<number>): number {
  const order = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score);
  const position = order.findIndex((entry) => correctIndices.has(entry.index));
  return position < 0 ? Number.POSITIVE_INFINITY : position + 1;
}

// ── Runner ─────────────────────────────────────────────────────────────

interface Args {
  models: string[];
  out: string;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { models: [], out: 'docs/embedding-bench.json', concurrency: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--models') args.models = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
  }
  return args;
}

/** File name Transformers.js uses per dtype. */
const ONNX_FILE: Record<Candidate['dtype'], string> = {
  fp32: 'model.onnx',
  fp16: 'model_fp16.onnx',
  q8: 'model_quantized.onnx',
  q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx',
};

function modelSize(modelDir: string, dtype: Candidate['dtype']): number {
  if (!existsSync(modelDir)) return 0;
  const target = ONNX_FILE[dtype];
  let total = 0;
  for (const entry of readdirSync(modelDir, { withFileTypes: true })) {
    const full = join(modelDir, entry.name);
    if (entry.isDirectory()) {
      total += modelSize(full, dtype);
      continue;
    }
    // Count the weights for this dtype plus tokenizer/config overhead, but not
    // other quantization files that happen to share the cache directory.
    if (entry.name.endsWith('.onnx')) {
      if (entry.name === target) total += statSync(full).size;
      continue;
    }
    total += statSync(full).size;
  }
  return total;
}

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += statSync(full).size;
  }
  return total;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = args.models.length
    ? CANDIDATES.filter((candidate) => args.models.includes(candidate.id))
    : CANDIDATES;

  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = join(process.cwd(), '.cache');

  const corpus = giftCorpus();
  const corpusTexts = corpus.map((entry) => entry.text);
  // Reference intents by their literal search query: stable across the index's
  // id scheme, and what a human actually checks against.
  // A query can appear in several layers (interest, age, brand); every copy
  // counts as a correct retrieval.
  const indicesByQuery = new Map<string, Set<number>>();
  corpus.forEach((entry, index) => {
    const key = entry.query.trim().toLowerCase();
    const set = indicesByQuery.get(key) ?? new Set<number>();
    set.add(index);
    indicesByQuery.set(key, set);
  });

  console.log(`Corpus: ${corpus.length} intents. Cases: ${INTENT_CASES.length} queries, ${PRODUCT_CASES.length} product rankings.`);
  console.log(`Evaluating ${candidates.length} candidate(s).\n`);

  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const started = Date.now();
    let extractor: Awaited<ReturnType<typeof pipeline>>;
    try {
      extractor = await pipeline('feature-extraction', candidate.model, {
        dtype: candidate.dtype,
        device: 'cpu',
      });
    } catch (error) {
      console.log(`✗ ${candidate.id}: unavailable (${error instanceof Error ? error.message.slice(0, 80) : 'load failed'})`);
      results.push({ id: candidate.id, model: candidate.model, available: false });
      continue;
    }
    const loadMs = Date.now() - started;

    const embed = async (texts: string[]): Promise<Float32Array[]> => {
      const output = await (extractor as (input: string[], options: object) => Promise<{ tolist(): number[][] }>)(
        texts,
        { pooling: 'mean', normalize: true }
      );
      return output.tolist().map((row) => Float32Array.from(row));
    };

    // Size on disk (post-download).
    const cacheRoot = join(env.cacheDir as string, candidate.model);
    const sizeBytes = modelSize(cacheRoot, candidate.dtype) || dirSize(cacheRoot);

    // ── Intent retrieval ──────────────────────────────────────────────
    const embedStart = Date.now();
    const corpusVectors = await embed(
      candidate.docPrefix ? corpusTexts.map((text) => `${candidate.docPrefix}${text}`) : corpusTexts
    );
    const corpusMs = Date.now() - embedStart;

    let hitsAt1 = 0;
    let hitsAt3 = 0;
    let reciprocalRankSum = 0;
    const perQuery: Array<{ query: string; rank: number; top: string }> = [];

    for (const testCase of INTENT_CASES) {
      const queryVector = (await embed([`${candidate.queryPrefix ?? ''}${testCase.query}`]))[0];
      const scores = corpusVectors.map((vector) => cosine(queryVector, vector));
      const correct = new Set<number>();
      for (const query of testCase.accept) {
        for (const index of indicesByQuery.get(query.trim().toLowerCase()) ?? []) {
          correct.add(index);
        }
      }
      if (correct.size === 0) {
        throw new Error(`Eval case references no corpus query: ${testCase.accept.join(', ')}`);
      }
      const rank = rankOf(scores, correct);
      if (rank === 1) hitsAt1 += 1;
      if (rank <= 3) hitsAt3 += 1;
      reciprocalRankSum += Number.isFinite(rank) ? 1 / rank : 0;

      const bestIndex = scores.indexOf(Math.max(...scores));
      perQuery.push({ query: testCase.query, rank, top: corpus[bestIndex]?.id ?? '?' });
    }

    // ── Product ranking (1 good vs N distractors) ─────────────────────
    let productCorrect = 0;
    for (const testCase of PRODUCT_CASES) {
      const texts = [testCase.good, ...testCase.distractors].map(
        (text) => `${candidate.docPrefix ?? ''}${text}`
      );
      const vectors = await embed(texts);
      const queryVector = (await embed([`${candidate.queryPrefix ?? ''}${testCase.query}`]))[0];
      const scores = vectors.map((vector) => cosine(queryVector, vector));
      if (scores.indexOf(Math.max(...scores)) === 0) productCorrect += 1;
    }

    const dimensions = corpusVectors[0]?.length ?? 0;
    const result = {
      id: candidate.id,
      model: candidate.model,
      dtype: candidate.dtype,
      available: true,
      notes: candidate.notes,
      dimensions,
      sizeMB: Math.round((sizeBytes / 1024 / 1024) * 10) / 10,
      loadMs,
      corpusEmbedMs: corpusMs,
      msPerDoc: Math.round((corpusMs / corpusTexts.length) * 100) / 100,
      intentRecall1: Math.round((hitsAt1 / INTENT_CASES.length) * 1000) / 1000,
      intentRecall3: Math.round((hitsAt3 / INTENT_CASES.length) * 1000) / 1000,
      mrr: Math.round((reciprocalRankSum / INTENT_CASES.length) * 1000) / 1000,
      productTop1: Math.round((productCorrect / PRODUCT_CASES.length) * 1000) / 1000,
      quality: Math.round(((hitsAt3 / INTENT_CASES.length) * 0.6 + (productCorrect / PRODUCT_CASES.length) * 0.4) * 1000) / 1000,
      misses: perQuery.filter((entry) => entry.rank > 3).map((entry) => `${entry.query} → ${entry.top}`),
    };
    results.push(result);

    console.log(
      `${candidate.id.padEnd(16)} ${String(result.sizeMB).padStart(6)} MB  ` +
        `R@1 ${result.intentRecall1.toFixed(2)}  R@3 ${result.intentRecall3.toFixed(2)}  MRR ${result.mrr.toFixed(2)}  ` +
        `product ${result.productTop1.toFixed(2)}  ${candidate.dtype}`
    );
  }

  const available = results.filter((entry) => entry.available !== false) as Array<Record<string, unknown>>;
  available.sort((a, b) => (b.quality as number) - (a.quality as number));

  const summary = {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    intentCases: INTENT_CASES.length,
    productCases: PRODUCT_CASES.length,
    models: results,
    ranking: available.map((entry) => ({
      id: entry.id,
      quality: entry.quality,
      sizeMB: entry.sizeMB,
      /** Higher is better: quality per megabyte. */
      qualityPerMB: Math.round(((entry.quality as number) / Math.max(1, entry.sizeMB as number)) * 1000) / 1000,
    })),
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\nWrote ${args.out}`);
  console.log('\nRanked by quality:');
  for (const entry of summary.ranking) {
    console.log(
      `  ${String(entry.id).padEnd(16)} quality ${String(entry.quality).padEnd(6)} ${String(entry.sizeMB).padStart(6)} MB  ` +
        `(${entry.qualityPerMB} quality/MB)`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
