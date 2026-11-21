// ── Target catalog corpus (browser-shippable index) ────────────────────
//
// Why this exists: the SQLite catalog (`lib/target-index.ts`) answers arbitrary
// queries well — measured at 93% relevant@1 and 100% precision@5 — but it is
// ~418MB on disk and none of it can run in a serverless function or be fetched
// per request. The precomputed artifact (`lib/target-precomputed.ts`) is small
// but can only answer queries someone enumerated in advance, which is why
// "samsung 65 inch tv" came back empty in production despite the catalog
// containing thousands of Samsung TVs.
//
// This module ships the catalog itself instead: a packed binary corpus
// (~97MB raw, ~50MB gzipped) that the browser downloads once, caches, and
// indexes locally. Arbitrary queries then cost nothing and never touch a server.
//
// Deliberately dependency-free and browser-safe: no `node:` imports, no
// worker APIs, no storage APIs. It takes an ArrayBuffer and answers queries, so
// the exact same code runs in Node (verified against the real 2.6M-product
// catalog) and in the browser. Only the fetch/cache shell differs.
//
// What it still cannot do: price, availability, ratings, images, brand or
// popularity. Those are absent from Target's published data (see
// `lib/target-catalog.ts`), so no ranking work recovers them.

import { tokenize, tokenSet } from '@/lib/target-vocabulary';

/** File magic. Bump the version suffix on any layout change. */
export const CORPUS_MAGIC = 'TGC1';

const HEADER_BYTES = 32;
/** 3 bytes per token id: supports 16.7M distinct tokens; we use ~396k. */
const TOKEN_ID_BYTES = 3;
/** 5 bytes per tcin: Target ids reach 10 digits (9999999280), past u32. */
const TCIN_BYTES = 5;
/** 2^40 - 1; comfortably above any Target product id. */
export const MAX_TCIN = 1099511627775;

/** Where the corpus is served from once built. */
export const CORPUS_URL = '/data/target-corpus.bin';

export interface TargetCorpus {
  /** Token strings, indexed by token id. */
  readonly vocab: readonly string[];
  /** Reverse map for query-time lookup. */
  readonly tokenIds: ReadonlyMap<string, number>;
  readonly docCount: number;
  readonly postingCount: number;
  /** Byte length the corpus occupied; useful for logging. */
  readonly byteLength: number;
  /** Cumulative posting index per doc, length `docCount + 1`. */
  readonly docOffsets: Uint32Array;
  /** Packed 5-byte Target product ids, one per doc. */
  readonly tcinBytes: Uint8Array;
  /** Packed 3-byte token ids, doc-major. */
  readonly tokens: Uint8Array;
}

export interface TargetCorpusHit {
  tcin: string;
  title: string;
  matchMode: 'all' | 'partial';
  matchedTokens: number;
  coverage: number;
  score: number;
}

export interface TargetCorpusIndex {
  readonly size: number;
  query(query: string, limit: number): TargetCorpusHit[];
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
  );
}

function readTokenId(tokens: Uint8Array, posting: number): number {
  const at = posting * TOKEN_ID_BYTES;
  return tokens[at] | (tokens[at + 1] << 8) | (tokens[at + 2] << 16);
}

/** Read the packed 5-byte tcin for a doc. */
export function corpusTcin(corpus: TargetCorpus, doc: number): string {
  const at = doc * TCIN_BYTES;
  const bytes = corpus.tcinBytes;
  const value =
    bytes[at] +
    bytes[at + 1] * 0x100 +
    bytes[at + 2] * 0x10000 +
    bytes[at + 3] * 0x1000000 +
    bytes[at + 4] * 0x100000000;
  return String(value);
}

/**
 * Parse the packed corpus produced by `scripts/target-corpus-build.ts`.
 *
 * Uses views over the supplied buffer rather than copies, so a 97MB download
 * does not become 97MB plus a duplicate. Throws on a bad magic or a truncated
 * file instead of returning a silently empty catalog.
 */
export function decodeCorpus(bytes: Uint8Array): TargetCorpus {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error('Target corpus is truncated (shorter than its header)');
  }
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== CORPUS_MAGIC) {
    throw new Error(`Target corpus has unexpected magic "${magic}", expected "${CORPUS_MAGIC}"`);
  }

  const vocabCount = u32(bytes, 4);
  const docCount = u32(bytes, 8);
  const postingCount = u32(bytes, 12);
  const vocabOffset = u32(bytes, 16);
  const countsOffset = u32(bytes, 20);
  const tcinOffset = u32(bytes, 24);
  const tokensOffset = u32(bytes, 28);

  const expected = tokensOffset + postingCount * TOKEN_ID_BYTES;
  const tcinEnd = tcinOffset + docCount * TCIN_BYTES;
  if (expected < tcinEnd) {
    throw new Error('Target corpus header describes overlapping sections');
  }
  if (bytes.byteLength < expected) {
    throw new Error(
      `Target corpus is truncated: ${bytes.byteLength} bytes, header declares ${expected}`
    );
  }

  // ── Vocabulary: length-prefixed UTF-8 strings ──
  const vocab: string[] = new Array(vocabCount);
  const tokenIds = new Map<string, number>();
  const decoder = new TextDecoder();
  let at = vocabOffset;
  for (let i = 0; i < vocabCount; i++) {
    const length = bytes[at] | (bytes[at + 1] << 8);
    at += 2;
    const token = decoder.decode(bytes.subarray(at, at + length));
    at += length;
    vocab[i] = token;
    tokenIds.set(token, i);
  }

  // ── Per-doc token counts → cumulative offsets ──
  const docOffsets = new Uint32Array(docCount + 1);
  let running = 0;
  for (let doc = 0; doc < docCount; doc++) {
    docOffsets[doc] = running;
    running += bytes[countsOffset + doc];
  }
  docOffsets[docCount] = running;
  if (running !== postingCount) {
    throw new Error(
      `Target corpus posting count mismatch: header ${postingCount}, doc counts sum to ${running}`
    );
  }

  return {
    vocab,
    tokenIds,
    docCount,
    postingCount,
    byteLength: bytes.byteLength,
    docOffsets,
    tcinBytes: bytes.subarray(tcinOffset, tcinEnd),
    tokens: bytes.subarray(tokensOffset, expected),
  };
}

/** Rebuild a display title from the doc's token ids. */
export function corpusDocTitle(corpus: TargetCorpus, doc: number): string {
  const from = corpus.docOffsets[doc];
  const to = corpus.docOffsets[doc + 1];
  const words: string[] = [];
  for (let posting = from; posting < to; posting++) {
    words.push(corpus.vocab[readTokenId(corpus.tokens, posting)]);
  }
  return words.join(' ');
}

/**
 * Build an inverted index (CSR) over the corpus.
 *
 * Costs one pass over ~27M postings and ~108MB of `Uint32Array`. That is the
 * price of arbitrary queries with no server, and it is why the loader runs this
 * in a worker rather than on the main thread.
 */
export function buildCorpusIndex(corpus: TargetCorpus): TargetCorpusIndex {
  const { vocab, docCount, postingCount, docOffsets, tokens } = corpus;

  const start = new Uint32Array(vocab.length + 1);
  for (let posting = 0; posting < postingCount; posting++) {
    start[readTokenId(tokens, posting) + 1] += 1;
  }
  for (let i = 0; i < vocab.length; i++) start[i + 1] += start[i];

  const cursor = start.slice(0, vocab.length);
  const docs = new Uint32Array(postingCount);
  for (let doc = 0; doc < docCount; doc++) {
    for (let posting = docOffsets[doc]; posting < docOffsets[doc + 1]; posting++) {
      const id = readTokenId(tokens, posting);
      docs[cursor[id]++] = doc;
    }
  }

  const docFreq = (id: number): number => start[id + 1] - start[id];
  const idf = (id: number): number => Math.log(1 + docCount / Math.max(1, docFreq(id)));

  /** Documents containing this token, in ascending order. */
  const postings = (id: number): Uint32Array => docs.subarray(start[id], start[id + 1]);

  return {
    size: docCount,

    query(rawQuery: string, limit: number): TargetCorpusHit[] {
      if (limit <= 0) return [];
      const queryTokens = tokenSet(rawQuery);
      if (queryTokens.length === 0) return [];

      // Resolve to ids, keeping an OR-alternative for a plural query token so
      // "levis" reaches "levi" — prefix matching via `toTerm` covers the rest.
      const groups: number[][] = [];
      for (const token of queryTokens) {
        const ids: number[] = [];
        const direct = corpus.tokenIds.get(token);
        if (direct !== undefined) ids.push(direct);
        if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
          const singular = corpus.tokenIds.get(token.slice(0, -1));
          if (singular !== undefined && singular !== direct) ids.push(singular);
        }
        if (ids.length > 0) groups.push(ids);
      }
      if (groups.length === 0) return [];

      // scored[doc] = { matched, rarity }
      const scored = new Map<number, { matched: number; rarity: number }>();
      for (const ids of groups) {
        const seen = new Set<number>();
        for (const id of ids) {
          const weight = idf(id);
          for (const doc of postings(id)) {
            if (seen.has(doc)) continue;
            seen.add(doc);
            const entry = scored.get(doc);
            if (entry) {
              entry.matched += 1;
              entry.rarity += weight;
            } else {
              scored.set(doc, { matched: 1, rarity: weight });
            }
          }
        }
      }

      const hits: TargetCorpusHit[] = [];
      for (const [doc, { matched, rarity }] of scored) {
        hits.push({
          tcin: corpusTcin(corpus, doc),
          title: corpusDocTitle(corpus, doc),
          matchMode: matched === groups.length ? 'all' : 'partial',
          matchedTokens: matched,
          coverage: matched / groups.length,
          score: (matched / groups.length) * 1000 + rarity,
        });
      }

      hits.sort(
        (a, b) =>
          b.coverage - a.coverage ||
          b.score - a.score ||
          a.title.length - b.title.length ||
          (a.tcin < b.tcin ? -1 : a.tcin > b.tcin ? 1 : 0)
      );

      // Same contract as the SQLite layer: exact matches first, then any-token
      // fallbacks that still cover half the query on at least two tokens.
      const exact = hits.filter((hit) => hit.matchMode === 'all');
      if (exact.length >= limit) return exact.slice(0, limit);
      const partial = hits.filter(
        (hit) =>
          hit.matchMode === 'partial' &&
          hit.coverage >= 0.5 &&
          hit.matchedTokens >= 2
      );
      return [...exact, ...partial.slice(0, limit - exact.length)];
    },
  };
}

// ── Encoding ──────────────────────────────────────────────────────────
//
// The production writer is `scripts/target-corpus-build.ts`, which streams the
// shard files. This exists so the format is round-trippable in tests: a binary
// format that can only be written by a build script is a format nobody can
// check for a broken header.

export interface CorpusDocInput {
  tcin: string;
  title: string;
}

/** Encode docs into the packed corpus layout. Mirrors the build script exactly. */
export function encodeCorpus(docs: readonly CorpusDocInput[]): Uint8Array {
  const vocab: string[] = [];
  const tokenIds = new Map<string, number>();
  const idFor = (token: string): number => {
    const existing = tokenIds.get(token);
    if (existing !== undefined) return existing;
    const id = vocab.length;
    tokenIds.set(token, id);
    vocab.push(token);
    return id;
  };

  const docTokenIds: number[][] = [];
  const tcins: number[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    if (seen.has(doc.tcin)) continue;
    seen.add(doc.tcin);
    const tcin = Number(doc.tcin);
    if (!Number.isSafeInteger(tcin) || tcin < 0 || tcin > MAX_TCIN) {
      throw new Error(`tcin ${doc.tcin} cannot be encoded`);
    }
    const tokens = [...new Set(tokenize(doc.title))];
    if (tokens.length > 255) throw new Error(`title for ${doc.tcin} has too many tokens`);
    tcins.push(tcin);
    docTokenIds.push(tokens.map(idFor));
  }

  const docCount = docTokenIds.length;
  const postingCount = docTokenIds.reduce((sum, ids) => sum + ids.length, 0);

  const vocabBytes = vocab.reduce((sum, t) => sum + 2 + new TextEncoder().encode(t).length, 0);
  const vocabOffset = HEADER_BYTES;
  const countsOffset = vocabOffset + vocabBytes;
  const tcinOffset = countsOffset + docCount;
  const tokensOffset = tcinOffset + docCount * TCIN_BYTES;
  const total = tokensOffset + postingCount * TOKEN_ID_BYTES;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CORPUS_MAGIC.charCodeAt(i);
  view.setUint32(4, vocab.length, true);
  view.setUint32(8, docCount, true);
  view.setUint32(12, postingCount, true);
  view.setUint32(16, vocabOffset, true);
  view.setUint32(20, countsOffset, true);
  view.setUint32(24, tcinOffset, true);
  view.setUint32(28, tokensOffset, true);

  const encoder = new TextEncoder();
  let at = vocabOffset;
  for (const token of vocab) {
    const bytes = encoder.encode(token);
    view.setUint16(at, bytes.length, true);
    at += 2;
    out.set(bytes, at);
    at += bytes.length;
  }

  let posting = 0;
  for (let doc = 0; doc < docCount; doc++) {
    out[countsOffset + doc] = docTokenIds[doc].length;
    let value = tcins[doc];
    for (let byte = 0; byte < TCIN_BYTES; byte++) {
      out[tcinOffset + doc * TCIN_BYTES + byte] = value % 256;
      value = Math.floor(value / 256);
    }
    for (const id of docTokenIds[doc]) {
      const base = tokensOffset + posting * TOKEN_ID_BYTES;
      out[base] = id & 0xff;
      out[base + 1] = (id >>> 8) & 0xff;
      out[base + 2] = (id >>> 16) & 0xff;
      posting += 1;
    }
  }

  return out;
}
