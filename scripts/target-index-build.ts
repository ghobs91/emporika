/**
 * Build the searchable Target catalog index from the downloaded shard files.
 *
 * Reads `data/target-index/shards/*.jsonl` (written by `target-sitemap.ts`) and
 * writes a single SQLite FTS5 database at `data/target-index/target.sqlite`,
 * which `lib/target-index.ts` queries in-process.
 *
 * This is a full rebuild by design. The shard set on disk already contains only
 * the shards whose ETag moved, so a rebuild is cheap and cannot drift; trying to
 * upsert incrementally into a 2.5M-row FTS5 table would invite deletion bugs for
 * no gain. Rebuilding also means the database can be regenerated offline without
 * touching the network.
 *
 * Usage:
 *   npx tsx scripts/target-index-build.ts
 *   npx tsx scripts/target-index-build.ts --shards data/target-index/shards --db data/target-index/target.sqlite
 */

import { buildTargetDatabase, readManifest, resolveShardDir, resolveTargetDbPath } from '../lib/target-index';

interface Options {
  dbPath?: string;
  shardDir?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        options.dbPath = argv[++i];
        break;
      case '--shards':
        options.shardDir = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Emit progress every ~250k rows so a long build does not look hung. */
const PROGRESS_EVERY = 250_000;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveTargetDbPath(options.dbPath);
  const shardDir = resolveShardDir(options.shardDir);

  console.log(`Reading shards from ${shardDir}`);
  console.log(`Writing index to   ${dbPath}`);

  const started = Date.now();
  let lastReported = 0;

  const result = await buildTargetDatabase({
    dbPath: options.dbPath,
    shardDir: options.shardDir,
    onProgress: (shard, records, total) => {
      if (total - lastReported >= PROGRESS_EVERY) {
        lastReported = total;
        console.log(`  ${total.toLocaleString()} products (last: ${shard}, +${records})`);
      }
    },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(
    `Indexed ${result.products.toLocaleString()} products from ${result.shards} shard(s) ` +
      `in ${seconds}s → ${(result.bytes / 1e6).toFixed(0)}MB`
  );

  // Coverage honesty: the index only knows the shards that were downloaded.
  const manifest = await readManifest();
  if (manifest) {
    const entries = Object.values(manifest.shards);
    const pending = entries.filter((entry) => !entry.fetched).length;
    if (pending > 0) {
      console.log(
        `WARNING: ${pending}/${entries.length} shard(s) have never been downloaded, ` +
          `so this index covers part of the catalog. Run \`npx tsx scripts/target-sitemap.ts --all\`.`
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
