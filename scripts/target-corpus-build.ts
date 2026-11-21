/**
 * Build the browser-shippable Target corpus.
 *
 * Reads the shard JSONL artifacts and emits a packed binary that
 * `lib/target-corpus.ts` decodes and indexes in the browser: arbitrary queries,
 * no server, no recurring cost — see that module for why the precomputed query
 * map was not good enough.
 *
 * Prerequisites:
 *   npx tsx scripts/target-sitemap.ts --all
 *
 * Then:
 *   npx tsx scripts/target-corpus-build.ts
 *
 * Streaming by design: one shard (25–45k products) is in memory at a time, so
 * this runs in a few hundred MB regardless of catalog size. Reading the shards
 * rather than the SQLite index also keeps this independent of `node:sqlite`.
 *
 * Layout (little-endian):
 *   [0,32)   header: magic, counts, section offsets
 *   vocab    vocabCount × (u16 byteLength, UTF-8 bytes)
 *   counts   docCount × u8 tokens per doc
 *   tcins    docCount × 5-byte product id (Target ids exceed 32 bits)
 *   tokens   postingCount × 3-byte token id
 *
 * Mixed widths are deliberate: token ids need 19 bits (396k vocabulary), tokens
 * per title fit in a byte. Smallest workable width is what
 * keeps the download near 50MB instead of ~180MB.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { listShardFiles, readShardFile } from '../lib/target-index';
import { tokenize } from '../lib/target-vocabulary';
import { CORPUS_MAGIC, CORPUS_URL, MAX_TCIN } from '../lib/target-corpus';

const HEADER_BYTES = 32;
const TOKEN_ID_BYTES = 3;
const MAX_TOKENS_PER_DOC = 255;
const MAX_VOCAB = 1 << (TOKEN_ID_BYTES * 8);

interface Options {
  out: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { out: path.join('public', CORPUS_URL.replace(/^\//, '')) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') options.out = argv[++i] ?? options.out;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

/** Growable Uint32 buffer; 27M postings is the expected ceiling. */
class Uint32Sink {
  private buffer = new Uint32Array(1 << 25);
  length = 0;

  push(value: number): void {
    if (this.length === this.buffer.length) {
      const grown = new Uint32Array(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length++] = value;
  }

  view(): Uint32Array {
    return this.buffer.subarray(0, this.length);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const shardFiles = listShardFiles();
  if (shardFiles.length === 0) {
    throw new Error('No shard artifacts found. Run `npx tsx scripts/target-sitemap.ts --all` first.');
  }
  console.log(`Reading ${shardFiles.length} shard file(s)…`);

  const vocab: string[] = [];
  const tokenIds = new Map<string, number>();
  const idFor = (token: string): number => {
    const existing = tokenIds.get(token);
    if (existing !== undefined) return existing;
    if (vocab.length >= MAX_VOCAB) {
      throw new Error(`Vocabulary exceeds ${MAX_VOCAB} tokens; widen TOKEN_ID_BYTES.`);
    }
    const id = vocab.length;
    tokenIds.set(token, id);
    vocab.push(token);
    return id;
  };

  const postings = new Uint32Sink();
  const counts: number[] = [];
  const tcins: number[] = [];
  const seenTcins = new Set<string>();
  let skippedTooLong = 0;
  let skippedDuplicate = 0;

  for (const [shardIndex, file] of shardFiles.entries()) {
    const records = await readShardFile(file);
    for (const record of records) {
      // A product can appear in more than one shard across rebuilds.
      if (seenTcins.has(record.tcin)) {
        skippedDuplicate += 1;
        continue;
      }
      seenTcins.add(record.tcin);

      const tcin = Number(record.tcin);
      if (!Number.isSafeInteger(tcin) || tcin < 0 || tcin > MAX_TCIN) {
        throw new Error(`tcin ${record.tcin} exceeds the packed 40-bit limit`);
      }

      const tokens = [...new Set(tokenize(record.title || record.slug))];
      if (tokens.length > MAX_TOKENS_PER_DOC) {
        skippedTooLong += 1;
        continue;
      }

      tcins.push(tcin);
      counts.push(tokens.length);
      for (const token of tokens) postings.push(idFor(token));
    }
    if ((shardIndex + 1) % 20 === 0 || shardIndex === shardFiles.length - 1) {
      console.log(`  ${shardIndex + 1}/${shardFiles.length} shards — ${counts.length.toLocaleString()} docs`);
    }
  }

  const docCount = counts.length;
  const postingView = postings.view();
  const postingCount = postingView.length;
  if (docCount === 0) throw new Error('Corpus would be empty');

  const vocabBytes = vocab.reduce((total, token) => total + 2 + Buffer.byteLength(token, 'utf8'), 0);
  const vocabOffset = HEADER_BYTES;
  const countsOffset = vocabOffset + vocabBytes;
  const tcinOffset = countsOffset + docCount;
  const tokensOffset = tcinOffset + docCount * 5;
  const total = tokensOffset + postingCount * TOKEN_ID_BYTES;

  const out = Buffer.allocUnsafe(total);
  out.write(CORPUS_MAGIC, 0, 'ascii');
  out.writeUInt32LE(vocab.length, 4);
  out.writeUInt32LE(docCount, 8);
  out.writeUInt32LE(postingCount, 12);
  out.writeUInt32LE(vocabOffset, 16);
  out.writeUInt32LE(countsOffset, 20);
  out.writeUInt32LE(tcinOffset, 24);
  out.writeUInt32LE(tokensOffset, 28);

  let at = vocabOffset;
  for (const token of vocab) {
    const bytes = Buffer.from(token, 'utf8');
    out.writeUInt16LE(bytes.length, at);
    at += 2;
    bytes.copy(out, at);
    at += bytes.length;
  }

  for (let i = 0; i < docCount; i++) {
    out[countsOffset + i] = counts[i];
    let value = tcins[i];
    for (let byte = 0; byte < 5; byte++) {
      out[tcinOffset + i * 5 + byte] = value & 0xff;
      value = Math.floor(value / 256);
    }
  }

  for (let i = 0; i < postingCount; i++) {
    const id = postingView[i];
    const base = tokensOffset + i * TOKEN_ID_BYTES;
    out[base] = id & 0xff;
    out[base + 1] = (id >>> 8) & 0xff;
    out[base + 2] = (id >>> 16) & 0xff;
  }

  mkdirSync(path.dirname(options.out), { recursive: true });
  writeFileSync(options.out, out);

  const gzipped = gzipSync(out, { level: 6 }).length;
  console.log('');
  console.log(`Wrote ${options.out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(
    `  docs ${docCount.toLocaleString()} | postings ${postingCount.toLocaleString()} | vocab ${vocab.length.toLocaleString()}`
  );
  console.log(
    `  raw ${(statSync(options.out).size / 1e6).toFixed(0)}MB | gzip -6 ${(gzipped / 1e6).toFixed(0)}MB`
  );
  if (skippedDuplicate) console.log(`  skipped ${skippedDuplicate} duplicate tcin(s)`);
  if (skippedTooLong) console.log(`  skipped ${skippedTooLong} doc(s) over ${MAX_TOKENS_PER_DOC} tokens`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
