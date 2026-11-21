// ── Target catalog query layer (SQLite FTS5) ───────────────────────────
//
// Turns the shard artifacts built by `scripts/target-sitemap.ts` into a
// searchable local index, so Target can be answered *without any network
// call*. This is what makes Target viable as a provider at all:
// `redsky.target.com` is PerimeterX-guarded and the storefront HTML carries no
// price (see `lib/target-catalog.ts`), so the only data we can have is the
// catalog enumeration, and the only way to query it is locally.
//
// Why SQLite rather than the in-memory postings map this replaced: the full
// catalog is ~106 shards / ~2.5M products. As JS objects plus an inverted
// index that is several GB — not loadable in a request process, and not
// loadable in a serverless function at all. FTS5 keeps it on disk (~1GB),
// answers in milliseconds, and gives BM25 ranking instead of a hand-rolled
// surrogate. `node:sqlite` is a Node built-in, so this adds no dependency.
//
// What this can and cannot answer — and the provider must not pretend
// otherwise:
//   ✓ "does Target carry something matching these words", and where to link
//   ✗ price, availability, shipping, pickup, ratings, images, brand
// The artifact is `tcin` + slug + title only. `rawFieldAvailability` in the
// adapter records that honestly.
//
// Determinism: BM25 over a fixed corpus, with an explicit tie-break. No
// randomness, no clock, no LLM. This layer only orders candidates *within*
// Target; `search/ranker.ts` still decides the final order.

import { existsSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { DatabaseSync as SqliteDatabaseSync } from 'node:sqlite';
import type { TargetProductRecord } from '@/lib/target-catalog';
import { tokenize, tokenSet } from '@/lib/target-vocabulary';

export { tokenize };

/** Directory holding `manifest.json` and per-shard `.jsonl` files. */
export const DEFAULT_INDEX_DIR = 'data/target-index';

/** The built SQLite database the query layer reads. */
export const DEFAULT_DB_PATH = `${DEFAULT_INDEX_DIR}/target.sqlite`;

/** One `.jsonl` per sitemap shard. */
export const DEFAULT_SHARD_DIR = `${DEFAULT_INDEX_DIR}/shards`;

/**
 * How much of the query an any-token fallback result must cover to be shown.
 *
 * Without a floor, "quantum flux capacitor" returns welding wire ("flux") and
 * car audio capacitors ("capacitor") — each a single-token match on a three
 * token query. Half the query is the point at which a partial match still says
 * something about what the shopper asked for.
 */
const MIN_PARTIAL_COVERAGE = 0.5;

/**
 * An any-token fallback must also match at least this many distinct tokens.
 *
 * Coverage alone is not enough: on a two-token query, 0.5 coverage is a single
 * token, and because matching is prefix-based a single token can be a prefix
 * coincidence — "nike hoodie" matched a faucet whose title contains "nikel".
 * Two real token matches is the floor for calling something a weaker answer
 * rather than noise.
 */
const MIN_PARTIAL_TOKENS = 2;

/** FTS5 table definition. `UNINDEXED` columns are stored but not searchable. */
const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE VIRTUAL TABLE search USING fts5(
    tcin UNINDEXED,
    slug UNINDEXED,
    url UNINDEXED,
    title,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`;

export interface TargetIndexHit {
  record: TargetProductRecord;
  /**
   * `all` when every query token was found in the title, `partial` when the
   * result is an any-token fallback. Surfaced so the adapter can label recall
   * honestly rather than implying an exact match.
   */
  matchMode: 'all' | 'partial';
  /** Query tokens present in the title. */
  matchedTokens: number;
  /** matchedTokens / queryTokens, 0–1. */
  coverage: number;
  /** Higher is better: BM25 negated, plus deterministic tie-breaks. */
  score: number;
}

export interface TargetIndex {
  /** Records in the catalog. */
  readonly size: number;
  query(query: string, limit: number): TargetIndexHit[];
  close(): void;
}

/**
 * Build an FTS5 MATCH expression from already-sanitised tokens.
 *
 * `tokenize` only ever emits `[a-z0-9]+`, so wrapping each token in double
 * quotes cannot leak an FTS5 operator (`AND`, `OR`, `NOT`, `NEAR`, `^`, `*`,
 * `:`). The trailing `*` makes it a prefix query, which is also what makes
 * "hoodie" match "hoodies" without stemming.
 */
function matchExpression(tokens: readonly string[], operator: 'AND' | 'OR'): string {
  return tokens.map((token) => toTerm(token)).join(` ${operator} `);
}

/**
 * One query token as an FTS5 term, with a singular variant.
 *
 * Prefix matching only runs one way: query "levis"* matches title token "levis"
 * but not "levi", so a shopper typing the plural gets a fraction of the catalog
 * ("levis jeans" returned one hit). Adding the de-pluralised form as an OR
 * alternative inside the same term — not as an extra token — keeps the AND
 * semantics of the rest of the query intact.
 */
function toTerm(token: string): string {
  const variants = [token];
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    variants.push(token.slice(0, -1));
  }
  if (variants.length === 1) return `"${token}"*`;
  return `(${variants.map((variant) => `"${variant}"*`).join(' OR ')})`;
}

/**
 * Fraction of query tokens that appear as a prefix of some title token.
 *
 * Recomputed in JS rather than trusted from FTS5 because the value is shown to
 * the shopper ("matched only some of your terms") and gates the coverage floor.
 */
function coverageOf(tokens: readonly string[], title: string): number {
  if (tokens.length === 0) return 0;
  const titleTokens = tokenize(title);
  if (titleTokens.length === 0) return 0;
  let matched = 0;
  for (const token of tokens) {
    const singular = token.length > 3 && token.endsWith('s') && !token.endsWith('ss')
      ? token.slice(0, -1)
      : null;
    if (
      titleTokens.some(
        (candidate) =>
          candidate.startsWith(token) || (singular !== null && candidate.startsWith(singular))
      )
    ) {
      matched += 1;
    }
  }
  return matched / tokens.length;
}

interface HitRow {
  tcin: string;
  slug: string;
  url: string;
  title: string;
  bm: number;
}

/** Absolute path to the SQLite database. */
export function resolveTargetDbPath(override?: string): string {
  return path.resolve(process.cwd(), override ?? process.env.TARGET_INDEX_PATH ?? DEFAULT_DB_PATH);
}

export function resolveShardDir(override?: string): string {
  return path.resolve(process.cwd(), override ?? DEFAULT_SHARD_DIR);
}

/**
 * Whether a built database exists on disk.
 *
 * A zero-length file is treated as absent: a build killed mid-run would
 * otherwise look like a populated catalog and fail every query.
 */
export function isTargetIndexAvailable(override?: string): boolean {
  const file = resolveTargetDbPath(override);
  try {
    return statSync(file).size > 0;
  } catch {
    return false;
  }
}

function toHits(rows: HitRow[], tokens: readonly string[], mode: 'all' | 'partial'): TargetIndexHit[] {
  return rows.map((row) => {
    const coverage = coverageOf(tokens, row.title);
    return {
      record: { tcin: row.tcin, slug: row.slug, title: row.title, url: row.url },
      matchMode: mode,
      matchedTokens: Math.round(coverage * tokens.length),
      coverage,
      // SQLite's bm25() is negative-with-better-matches, so negate it to make
      // "higher is better" hold, matching the rest of the search pipeline.
      score: -row.bm,
    };
  });
}

/** Wrap a `DatabaseSync` handle in the query interface. */
export function createTargetIndex(db: SqliteDatabaseSync, size: number): TargetIndex {
  const exactStmt = db.prepare(
    'SELECT tcin, slug, url, title, bm25(search) AS bm FROM search WHERE search MATCH ? ORDER BY bm LIMIT ?'
  );

  const run = (expression: string, limit: number): HitRow[] =>
    exactStmt.all(expression, limit) as unknown as HitRow[];

  return {
    size,

    query(rawQuery: string, limit: number): TargetIndexHit[] {
      if (limit <= 0) return [];
      const tokens = tokenSet(rawQuery);
      if (tokens.length === 0) return [];

      // Exact matches fill the page first: every token must appear.
      const exact = toHits(run(matchExpression(tokens, 'AND'), limit), tokens, 'all');
      if (exact.length >= limit) {
        return exact.sort(stableOrder).slice(0, limit);
      }

      // Then top up with any-token matches that still cover half the query.
      // Over-fetch because the coverage floor and de-duplication both discard.
      const seen = new Set(exact.map((hit) => hit.record.tcin));
      const partial: TargetIndexHit[] = [];
      for (const hit of toHits(run(matchExpression(tokens, 'OR'), limit * 4), tokens, 'partial')) {
        if (seen.has(hit.record.tcin)) continue;
        if (hit.coverage < MIN_PARTIAL_COVERAGE) continue;
        if (hit.matchedTokens < MIN_PARTIAL_TOKENS) continue;
        partial.push(hit);
        if (exact.length + partial.length >= limit) break;
      }

      return [...exact.sort(stableOrder), ...partial.sort(stableOrder)];
    },

    close(): void {
      db.close();
    },
  };
}

/** Deterministic tie-break: score, then shorter title, then tcin. */
function stableOrder(a: TargetIndexHit, b: TargetIndexHit): number {
  return (
    b.score - a.score ||
    a.record.title.length - b.record.title.length ||
    (a.record.tcin < b.record.tcin ? -1 : a.record.tcin > b.record.tcin ? 1 : 0)
  );
}

type SqliteModule = typeof import('node:sqlite');

let sqliteModule: SqliteModule | null = null;

/**
 * Load `node:sqlite` lazily.
 *
 * A static top-level import would make the *entire* search pipeline fail to load
 * on Node < 22.5 (`ERR_UNKNOWN_BUILTIN_MODULE`), taking every retailer down with
 * Target. Production serves Target from the precomputed artifact and never
 * needs SQLite, so this must fail only when someone actually opens the catalog.
 * The specifier is assembled at runtime so the bundler does not resolve it at
 * build time on a Node 20 build image.
 */
async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteModule) return sqliteModule;
  const specifier = ['node', 'sqlite'].join(':');
  try {
    sqliteModule = (await import(/* webpackIgnore: true */ specifier)) as SqliteModule;
    return sqliteModule;
  } catch {
    throw new Error(
      'The Target catalog index requires Node >= 22.5 (node:sqlite). ' +
        'Production serves Target from data/target-precomputed.json instead.'
    );
  }
}

let cached: { file: string; index: TargetIndex } | null = null;

/**
 * Open the built database, memoised per process.
 *
 * A missing database throws — the adapter turns that into a shopper-visible
 * `index_unavailable` status rather than an empty result set, so "Target has
 * nothing" and "Target is not built here" never look the same.
 */
export async function loadTargetIndex(override?: string): Promise<TargetIndex> {
  const file = resolveTargetDbPath(override);
  if (cached?.file === file) return cached.index;

  if (!isTargetIndexAvailable(override)) {
    throw new Error(
      'Target catalog index is not built. Run `npx tsx scripts/target-index-build.ts`.'
    );
  }

  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(file, { readOnly: true });
  const size = readProductCount(db);
  const index = createTargetIndex(db, size);
  cached = { file, index };
  return index;
}

function readProductCount(db: SqliteDatabaseSync): number {
  // Prefer the count recorded at build time. `SELECT count(*)` on an FTS5 table
  // walks the whole doc list and measured ~2.6s on the 2.6M-row catalog — an
  // unacceptable cold-start cost for a number we already know.
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'products'").get() as
      | { value: string }
      | undefined;
    if (row) return Number(row.value) || 0;
  } catch {
    // Older artifact without a meta table; fall through to counting.
  }
  const row = db.prepare('SELECT count(*) AS n FROM search').get() as
    | { n: number | bigint }
    | undefined;
  return row ? Number(row.n) : 0;
}

/** Test hook: drop the memoised index. */
export function resetTargetIndexCache(): void {
  if (cached) {
    try {
      cached.index.close();
    } catch {
      // Already closed by the test; nothing to do.
    }
  }
  cached = null;
}

// ── Build side ─────────────────────────────────────────────────────────

/** Read one `.jsonl` shard file line by line. */
export async function readShardFile(file: string): Promise<TargetProductRecord[]> {
  const records: TargetProductRecord[] = [];
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    records.push(JSON.parse(line) as TargetProductRecord);
  }
  return records;
}

/** Shard `.jsonl` files present on disk, deterministically ordered. */
export function listShardFiles(shardDir?: string): string[] {
  const dir = resolveShardDir(shardDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * Build a fresh SQLite database from the shard `.jsonl` files.
 *
 * Deliberately a full rebuild rather than an incremental upsert: the shards on
 * disk are already only the ones whose ETag moved (that is what
 * `scripts/target-sitemap.ts` does), so rebuilding from them is both cheap and
 * guaranteed consistent. Deletion bookkeeping across 2.5M FTS5 rows is a class
 * of bug not worth inviting.
 */
export async function buildTargetDatabase(options: {
  dbPath?: string;
  shardDir?: string;
  onProgress?: (shard: string, records: number, total: number) => void;
} = {}): Promise<{ products: number; shards: number; bytes: number }> {
  const dbPath = resolveTargetDbPath(options.dbPath);
  const shardFiles = listShardFiles(options.shardDir);

  if (shardFiles.length === 0) {
    throw new Error(
      `No shard artifacts found. Run \`npx tsx scripts/target-sitemap.ts --all\` first.`
    );
  }

  // Start from nothing so a partial previous build cannot leak into this one.
  // This is a build artifact, so overwriting is the expected behaviour.
  for (const stale of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(stale, { force: true });
  }

  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = OFF');
  db.exec('PRAGMA synchronous = OFF');
  db.exec(SCHEMA);

  const insert = db.prepare('INSERT INTO search (tcin, slug, url, title) VALUES (?, ?, ?, ?)');
  let products = 0;

  try {
    db.exec('BEGIN');
    for (const file of shardFiles) {
      const records = await readShardFile(file);
      for (const record of records) {
        insert.run(record.tcin, record.slug, record.url, record.title);
      }
      products += records.length;
      options.onProgress?.(path.basename(file, '.jsonl'), records.length, products);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('products', ?)").run(String(products));
    db.exec('COMMIT');
    // Compact the FTS b-tree so the file ships well.
    db.exec('INSERT INTO search(search) VALUES (\'optimize\')');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  db.close();
  return { products, shards: shardFiles.length, bytes: statSync(dbPath).size };
}

/** Read the manifest written by the sitemap script, if present. */
export async function readManifest(
  indexDir?: string
): Promise<{ updatedAt: string; shards: Record<string, { productCount: number; fetched: boolean }> } | null> {
  const file = path.resolve(process.cwd(), indexDir ?? DEFAULT_INDEX_DIR, 'manifest.json');
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
