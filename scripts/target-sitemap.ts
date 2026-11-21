/**
 * Build and incrementally refresh the Target catalog artifacts.
 *
 * Target cannot be searched server-side: `redsky.target.com` answers every
 * non-navigation request with an HTTP 435 PerimeterX challenge, and the
 * storefront HTML is a shell with no price on every URL form. The one surface
 * Target publishes for crawlers is its product sitemap, so this script turns
 * that into local artifacts the app can search without ever calling Target.
 *
 * Output (all under `data/target-index/`, git-ignored):
 *   manifest.json          — per-shard ETag bookkeeping
 *   shards/<name>.jsonl    — one file per downloaded shard, one product per line
 *
 * Per-shard JSONL rather than one big JSON blob because the full catalog is
 * ~2.5M products: a single `JSON.parse`/`JSON.stringify` of that is hundreds of
 * MB of resident strings. Streaming per shard keeps memory proportional to one
 * shard (~25–45k records), and lets an unchanged shard be carried forward by
 * simply leaving its file alone.
 *
 * Freshness is the whole problem, and HEAD + ETag is the only cheap answer:
 *
 *   • no <lastmod>/<changefreq>/<priority> in the index or the shards
 *   • If-None-Match / If-Modified-Since are ignored — a conditional GET
 *     returns 200 and the full ~8.6MB body, so revalidation saves nothing
 *   • HEAD returns a stable weak ETag per shard
 *
 * So every run HEADs all shards (a few KB, CDN-cached) and downloads only the
 * ones whose ETag moved. `--max-shards` bounds downloads per run; `--all`
 * removes the bound.
 *
 * Usage:
 *   npx tsx scripts/target-sitemap.ts --all          # every shard (~920MB)
 *   npx tsx scripts/target-sitemap.ts                # incremental, ≤2 shards
 *   npx tsx scripts/target-sitemap.ts --max-shards 10
 *   npx tsx scripts/target-sitemap.ts --max-shards 0 # probe only, no download
 *   npx tsx scripts/target-sitemap.ts --full         # refetch every shard
 *
 * Then: npx tsx scripts/target-index-build.ts
 *
 * Schedule it wherever `scripts/fetch-trends.ts` runs (GitHub Actions). A daily
 * HEAD pass plus a rebuild of only the changed shards keeps the catalog fresh
 * for a few MB of transfer.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  diffShards,
  reconcileManifest,
  shardsToFetch,
  type ShardManifestState,
  type TargetProductRecord,
} from '../lib/target-catalog';
import { fetchShardIndex, fetchShards, probeShards } from '../lib/target-sitemap';

interface Manifest {
  /** ISO timestamp of the last completed run. */
  updatedAt: string;
  /** Shard name → what our last HEAD saw, and whether we hold its rows. */
  shards: Record<string, ShardManifestState>;
}

interface Options {
  maxShards: number;
  unlimited: boolean;
  full: boolean;
  outDir: string;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    maxShards: 2,
    unlimited: false,
    full: false,
    outDir: 'data/target-index',
    concurrency: 4,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--max-shards':
        options.maxShards = Number(argv[++i] ?? options.maxShards);
        break;
      case '--all':
        options.unlimited = true;
        break;
      case '--full':
        options.full = true;
        break;
      case '--out':
        options.outDir = argv[++i] ?? options.outDir;
        break;
      case '--concurrency':
        options.concurrency = Number(argv[++i] ?? options.concurrency);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxShards) || options.maxShards < 0) {
    throw new Error('--max-shards must be a non-negative number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be at least 1');
  }
  return options;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** One product per line, so a shard is readable and streamable on its own. */
async function writeShardFile(dir: string, name: string, records: TargetProductRecord[]): Promise<void> {
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(path.join(dir, `${name}.jsonl`), body ? `${body}\n` : '');
}

/** Observed average shard size, only used to put a number on what we skipped. */
const AVG_SHARD_MB = 8.66;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(options.outDir, 'manifest.json');
  const shardDir = path.join(options.outDir, 'shards');

  const manifest = await readJson<Manifest>(manifestPath, { updatedAt: '', shards: {} });
  await mkdir(shardDir, { recursive: true });

  console.log('Fetching sitemap index…');
  const shardUrls = await fetchShardIndex();
  console.log(`  ${shardUrls.length} product shards published`);

  console.log('Probing shard freshness (HEAD)…');
  const probes = await probeShards(shardUrls, options.concurrency);
  const probed = probes.filter((probe) => probe.ok);
  console.log(`  ${probed.length} ok, ${probes.length - probed.length} unreachable`);

  // Diff only against shards the index still lists, so a bounded run does not
  // misread "never downloaded" as "removed from the catalog".
  const listed = new Set(probes.map((probe) => probe.name));
  const relevantManifest = Object.fromEntries(
    Object.entries(manifest.shards).filter(([name]) => listed.has(name))
  );

  const delta = diffShards(relevantManifest, probes);
  console.log(
    `  added ${delta.added.length}, changed ${delta.changed.length}, ` +
      `unchanged ${delta.unchanged.length}, removed ${delta.removed.length}`
  );

  // A shard we have HEAD'd but never downloaded still needs its rows.
  const neverFetched = delta.unchanged.filter((probe) => !manifest.shards[probe.name]?.fetched);
  const candidates = options.full
    ? probed
    : [...shardsToFetch(delta), ...neverFetched];

  const budget = options.unlimited ? candidates.length : Math.min(options.maxShards, candidates.length);
  const toFetch = candidates.slice(0, budget);
  const deferred = candidates.length - toFetch.length;

  const skippedByEtag = options.full ? 0 : delta.unchanged.length;
  console.log(
    `Downloading ${toFetch.length} shard(s)` +
      (deferred > 0 ? `, ${deferred} deferred (use --all)` : '') +
      `; ${skippedByEtag} shard(s) (~${(skippedByEtag * AVG_SHARD_MB).toFixed(0)}MB) proven unchanged by ETag`
  );

  // Download in bounded batches, writing each shard out before the next batch
  // starts. Collecting all ~2.5M records first would hold the whole catalog in
  // memory, which is exactly what the per-shard JSONL format exists to avoid.
  const counts = new Map<string, number>();
  const startedAt = Date.now();
  for (let i = 0; i < toFetch.length; i += options.concurrency) {
    const batch = toFetch.slice(i, i + options.concurrency);
    const results = await fetchShards(batch, options.concurrency);
    for (const [name, records] of [...results].sort(([a], [b]) => (a < b ? -1 : 1))) {
      await writeShardFile(shardDir, name, records);
      counts.set(name, records.length);
      console.log(
        `  [${Math.min(i + batch.length, toFetch.length)}/${toFetch.length}] ${name}: ${records.length} products`
      );
    }
  }
  if (toFetch.length > 0) {
    console.log(`  downloaded in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  }

  // A shard the index no longer lists must not linger as a stale artifact.
  for (const name of delta.removed) {
    await rm(path.join(shardDir, `${name}.jsonl`), { force: true });
  }

  // Counts for shards we did not download come from the previous manifest, so
  // this run never has to read every shard file back off disk.
  const productCounts = new Map<string, number>();
  for (const [name, entry] of Object.entries(manifest.shards)) {
    if (entry.fetched) productCounts.set(name, entry.productCount);
  }
  for (const [name, count] of counts) productCounts.set(name, count);

  const nextShards = reconcileManifest(
    manifest.shards,
    probes,
    new Set(counts.keys()),
    productCounts
  );

  await writeFile(
    manifestPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), shards: nextShards }, null, 2)}\n`
  );

  const held = Object.values(nextShards).filter((entry) => entry.fetched);
  const totalProducts = held.reduce((sum, entry) => sum + entry.productCount, 0);
  const pending = Object.values(nextShards).filter((entry) => !entry.fetched).length;

  console.log('');
  console.log(
    `Held: ${totalProducts.toLocaleString()} products across ${held.length}/${Object.keys(nextShards).length} shard(s)`
  );
  console.log(`Pending: ${pending} shard(s) HEAD'd but not yet downloaded`);
  console.log(`Wrote ${manifestPath} and ${shardDir}/`);
  console.log('Next: npx tsx scripts/target-index-build.ts');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
