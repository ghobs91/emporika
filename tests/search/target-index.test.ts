import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildTargetDatabase,
  isTargetIndexAvailable,
  loadTargetIndex,
  resetTargetIndexCache,
  resolveTargetDbPath,
  tokenize,
  DEFAULT_DB_PATH,
} from '@/lib/target-index';
import type { TargetProductRecord } from '@/lib/target-catalog';

function record(tcin: string, slug: string): TargetProductRecord {
  return {
    tcin,
    slug,
    title: slug.replace(/-/g, ' '),
    url: `https://www.target.com/p/${slug}/-/A-${tcin}`,
  };
}

const SHARD = 'sitemap_00-0001.xml.gz';

const RECORDS: TargetProductRecord[] = [
  record('1', 'usb-c-cable'),
  record('2', 'usb-hub'),
  record('3', 'winter-hoodie'),
  record('4', ''),
];

/** Write one `.jsonl` shard file from records. */
function writeShard(dir: string, name: string, records: TargetProductRecord[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  );
}

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('USB-C Cable')).toEqual(['usb', 'cable']);
  });

  it('drops single characters and stopwords', () => {
    expect(tokenize('a cable for the hub')).toEqual(['cable', 'hub']);
  });

  it('returns nothing for text with no usable tokens', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('  - / +  ')).toEqual([]);
    expect(tokenize('the and for')).toEqual([]);
  });
});

describe('sqlite-backed index', () => {
  let dir: string;
  let shardDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-db-'));
    shardDir = path.join(dir, 'shards');
    dbPath = path.join(dir, 'target.sqlite');
    writeShard(shardDir, SHARD, RECORDS);
    writeShard(shardDir, 'sitemap_00-0002.xml.gz', [record('5', 'blue-mug')]);

    resetTargetIndexCache();
    process.env.TARGET_INDEX_PATH = dbPath;
    await buildTargetDatabase({ dbPath, shardDir });
  });

  afterEach(() => {
    resetTargetIndexCache();
    delete process.env.TARGET_INDEX_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds one indexed row per product across shards', async () => {
    const index = await loadTargetIndex();
    expect(index.size).toBe(5);
  });

  it('returns exact matches only for a two-token query', async () => {
    // A partial needs two matched tokens, so a two-token query cannot produce
    // one: tcin 2 ("usb hub") matches only "usb" and is filtered as noise.
    // Before the token floor this test asserted the opposite.
    const index = await loadTargetIndex();
    const hits = index.query('usb c cable', 10);
    expect(hits.map((hit) => hit.record.tcin)).toEqual(['1']);
    expect(hits[0].matchMode).toBe('all');
    expect(hits[0].coverage).toBe(1);
  });

  it('returns exact matches only when they already fill the page', async () => {
    const index = await loadTargetIndex();
    const hits = index.query('usb c cable', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].record.tcin).toBe('1');
    expect(hits[0].matchMode).toBe('all');
  });

  it('matches plurals via prefix search rather than stemming', async () => {
    // "hoodie" must reach "hoodies": FTS5 prefix query, no stemmer needed.
    writeShard(shardDir, 'sitemap_00-0003.xml.gz', [record('9', 'winter-hoodies')]);
    await buildTargetDatabase({ dbPath, shardDir });
    resetTargetIndexCache();
    expect((await loadTargetIndex()).query('winter hoodie', 10).length).toBeGreaterThan(0);
  });

  it('drops an any-token hit that covers less than half the query', async () => {
    const index = await loadTargetIndex();
    // Only "usb" exists out of three tokens: 0.33 coverage is noise.
    expect(index.query('usb quantum flux', 10)).toEqual([]);
  });

  it('never matches a bare row that has no searchable text', async () => {
    const index = await loadTargetIndex();
    expect(index.query('usb cable hoodie mug', 20).map((hit) => hit.record.tcin)).not.toContain('4');
  });

  it('returns nothing for an empty or stopword-only query', async () => {
    const index = await loadTargetIndex();
    expect(index.query('', 10)).toEqual([]);
    expect(index.query('the and for', 10)).toEqual([]);
    expect(index.query('usb', 0)).toEqual([]);
  });

  it('returns nothing when no token is in the catalog', async () => {
    const index = await loadTargetIndex();
    expect(index.query('quantum flux capacitor', 10)).toEqual([]);
  });

  it('orders deterministically across repeated queries', async () => {
    const index = await loadTargetIndex();
    const first = index.query('usb', 10).map((hit) => hit.record.tcin);
    const second = index.query('usb', 10).map((hit) => hit.record.tcin);
    expect(first).toEqual(second);
  });

  it('respects the result limit', async () => {
    const index = await loadTargetIndex();
    expect(index.query('usb', 1)).toHaveLength(1);
  });

  it('is not fooled by FTS5 syntax in the query text', async () => {
    // Quoted/operator-looking input must not become a MATCH expression.
    const index = await loadTargetIndex();
    for (const hostile of ['usb" OR "cable', 'usb NEAR/2 cable', '^usb', 'usb*', 'tcin:1']) {
      expect(() => index.query(hostile, 5)).not.toThrow();
    }
    expect(index.query('usb" OR "cable', 5).map((hit) => hit.record.tcin)).not.toContain('4');
  });
});

describe('artifact paths and presence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-paths-'));
    resetTargetIndexCache();
    delete process.env.TARGET_INDEX_PATH;
  });

  afterEach(() => {
    resetTargetIndexCache();
    delete process.env.TARGET_INDEX_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to the git-ignored database path', () => {
    expect(resolveTargetDbPath()).toBe(path.resolve(process.cwd(), DEFAULT_DB_PATH));
  });

  it('lets TARGET_INDEX_PATH move the database outside the repo', () => {
    const file = path.join(dir, 'target.sqlite');
    process.env.TARGET_INDEX_PATH = file;
    expect(resolveTargetDbPath()).toBe(file);
    expect(resolveTargetDbPath('/tmp/explicit.sqlite')).toBe('/tmp/explicit.sqlite');
  });

  it('treats a missing database as unavailable', () => {
    process.env.TARGET_INDEX_PATH = path.join(dir, 'absent.sqlite');
    expect(isTargetIndexAvailable()).toBe(false);
  });

  it('treats a zero-length database as unavailable', () => {
    // A build killed mid-run leaves an empty file; it must not look populated.
    const file = path.join(dir, 'empty.sqlite');
    writeFileSync(file, '');
    process.env.TARGET_INDEX_PATH = file;
    expect(isTargetIndexAvailable()).toBe(false);
  });

  it('fails loudly when asked to load a database that is not there', async () => {
    process.env.TARGET_INDEX_PATH = path.join(dir, 'absent.sqlite');
    await expect(loadTargetIndex()).rejects.toThrow(/not built/i);
  });

  it('memoises the open handle per process', async () => {
    const shardDir = path.join(dir, 'shards');
    writeShard(shardDir, SHARD, [record('42', 'blue-mug')]);
    const dbPath = path.join(dir, 'target.sqlite');
    await buildTargetDatabase({ dbPath, shardDir });
    process.env.TARGET_INDEX_PATH = dbPath;

    const first = await loadTargetIndex();
    const second = await loadTargetIndex();
    expect(second).toBe(first);
  });

  it('rebuilds over an existing database without manual cleanup', async () => {
    const shardDir = path.join(dir, 'shards');
    writeShard(shardDir, SHARD, [record('42', 'blue-mug')]);
    const dbPath = path.join(dir, 'target.sqlite');

    await buildTargetDatabase({ dbPath, shardDir });
    expect(existsSync(dbPath)).toBe(true);
    await buildTargetDatabase({ dbPath, shardDir }); // same path again

    process.env.TARGET_INDEX_PATH = dbPath;
    expect((await loadTargetIndex()).size).toBe(1);
  });

  it('refuses to build with no shards rather than producing an empty index', async () => {
    await expect(
      buildTargetDatabase({ dbPath: path.join(dir, 'x.sqlite'), shardDir: path.join(dir, 'nope') })
    ).rejects.toThrow(/No shard artifacts/i);
  });
});

describe('partial-match token floor', () => {
  let dir: string;
  let shardDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-floor-'));
    shardDir = path.join(dir, 'shards');
    dbPath = path.join(dir, 'target.sqlite');
    writeShard(shardDir, SHARD, [
      record('1', 'nike hoodie'),
      record('2', 'nikel bath faucet'),
      record('3', 'nike hoodies bulk pack'),
    ]);
    resetTargetIndexCache();
    process.env.TARGET_INDEX_PATH = dbPath;
    await buildTargetDatabase({ dbPath, shardDir });
  });

  afterEach(() => {
    resetTargetIndexCache();
    delete process.env.TARGET_INDEX_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a single-token prefix coincidence', async () => {
    // "nike" is a prefix of "nikel". One-of-two coverage must not be enough to
    // return a bathroom faucet for a hoodie search.
    const index = await loadTargetIndex();
    const hits = index.query('nike hoodie', 10);
    expect(hits.map((hit) => hit.record.tcin)).not.toContain('2');
  });

  it('still falls back when two tokens genuinely match', async () => {
    // Three query tokens, so 2/3 coverage is a genuine partial rather than a
    // coincidence: both hoodie rows qualify, the faucet does not.
    const index = await loadTargetIndex();
    const hits = index.query('nike hoodie sale', 10);
    expect(hits.map((hit) => hit.record.tcin).sort()).toEqual(['1', '3']);
    expect(hits.every((hit) => hit.matchMode === 'partial')).toBe(true);
    expect(hits.every((hit) => hit.matchedTokens === 2)).toBe(true);
  });
});

describe('plural fallback', () => {
  let dir: string;
  let shardDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'emporika-target-plural-'));
    shardDir = path.join(dir, 'shards');
    dbPath = path.join(dir, 'target.sqlite');
    writeShard(shardDir, SHARD, [
      record('1', 'levi strauss signature jeans'),
      record('2', 'airpod pro wireless earbuds'),
    ]);
    resetTargetIndexCache();
    process.env.TARGET_INDEX_PATH = dbPath;
    await buildTargetDatabase({ dbPath, shardDir });
  });

  afterEach(() => {
    resetTargetIndexCache();
    delete process.env.TARGET_INDEX_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches a plural query against a singular title', async () => {
    // Prefix matching only runs one way, so "levis"* would never reach "levi".
    // Without the de-pluralised alternative this query returned nothing.
    const index = await loadTargetIndex();
    const hits = index.query('levis jeans', 10);
    expect(hits.map((hit) => hit.record.tcin)).toContain('1');
  });

  it('does not de-pluralise a token that merely ends in ss', async () => {
    const index = await loadTargetIndex();
    // "glass" must not be rewritten to "glas".
    expect(index.query('glass', 10)).toEqual([]);
  });
});
