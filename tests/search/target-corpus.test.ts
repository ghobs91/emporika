import { describe, expect, it } from 'vitest';
import {
  buildCorpusIndex,
  corpusDocTitle,
  corpusTcin,
  decodeCorpus,
  encodeCorpus,
  CORPUS_MAGIC,
  type CorpusDocInput,
} from '@/lib/target-corpus';

const DOCS: CorpusDocInput[] = [
  { tcin: '1000000076', title: 'campus lab hoodie' },
  { tcin: '9999999280', title: 'samsung 65 inch oled tv' },
  { tcin: '1009003108', title: 'startech usb c cable' },
  { tcin: '4242', title: 'nikel bath faucet' },
  { tcin: '777', title: 'levi strauss jeans' },
];

function roundTrip(docs: CorpusDocInput[] = DOCS) {
  return buildCorpusIndex(decodeCorpus(encodeCorpus(docs)));
}

describe('corpus round trip', () => {
  it('encodes and decodes the same documents', () => {
    const corpus = decodeCorpus(encodeCorpus(DOCS));
    expect(corpus.docCount).toBe(DOCS.length);
    expect(corpusTokenList(corpus)).toEqual(DOCS.map((doc) => doc.tcin));
    expect(corpusDocTitle(corpus, 0)).toBe('campus lab hoodie');
    expect(corpusDocTitle(corpus, 1)).toBe('samsung 65 inch oled tv');
  });

  it('preserves tcins beyond 32 bits', () => {
    // Target ids reach 10 digits; a u32 field silently corrupts these.
    const corpus = decodeCorpus(encodeCorpus([{ tcin: '9999999280', title: 'big id item' }]));
    expect(corpusTcin(corpus, 0)).toBe('9999999280');
  });

  it('dropped rows do not shift the doc/tcin alignment', () => {
    const corpus = decodeCorpus(
      encodeCorpus([
        { tcin: '1', title: 'first item' },
        { tcin: '1', title: 'duplicate tcin' }, // dropped
        { tcin: '2', title: 'second item' },
      ])
    );
    expect(corpusTokenList(corpus)).toEqual(['1', '2']);
    expect(corpusDocTitle(corpus, 1)).toBe('second item');
  });

  it('rejects a truncated buffer instead of returning an empty catalog', () => {
    const bytes = encodeCorpus(DOCS);
    expect(() => decodeCorpus(bytes.slice(0, 10))).toThrow(/truncated/i);
    expect(() => decodeCorpus(bytes.slice(0, bytes.length - 5))).toThrow(/truncated/i);
  });

  it('rejects a bad magic rather than guessing', () => {
    const bytes = encodeCorpus(DOCS);
    bytes[0] = 0;
    expect(() => decodeCorpus(bytes)).toThrow(/magic/i);
    expect(String.fromCharCode(...bytes.slice(0, 4))).not.toBe(CORPUS_MAGIC);
  });
});

describe('corpus query', () => {
  const index = roundTrip();

  it('returns the relevant products for a multi-token query', () => {
    const hits = index.query('samsung 65 inch tv', 5);
    expect(hits[0].tcin).toBe('9999999280');
    expect(hits[0].matchMode).toBe('all');
    expect(hits[0].title).toContain('samsung');
  });

  it('returns nothing when no token is present', () => {
    expect(index.query('quantum flux capacitor', 5)).toEqual([]);
  });

  it('returns nothing for an empty or stopword-only query', () => {
    expect(index.query('', 5)).toEqual([]);
    expect(index.query('the and for', 5)).toEqual([]);
    expect(index.query('samsung', 0)).toEqual([]);
  });

  it('rejects a single-token prefix coincidence', () => {
    // "nike" is a prefix of "nikel"; one of two tokens is not an answer.
    const hits = index.query('nike hoodie', 5);
    expect(hits.map((hit) => hit.tcin)).not.toContain('4242');
  });

  it('matches a plural query against a singular title', () => {
    const hits = index.query('levis jeans', 5);
    expect(hits.map((hit) => hit.tcin)).toContain('777');
  });

  it('respects the result limit', () => {
    expect(index.query('cable hoodie jeans tv faucet', 2).length).toBeLessThanOrEqual(2);
  });

  it('is deterministic across repeated queries', () => {
    const first = index.query('campus lab hoodie', 5).map((hit) => hit.tcin);
    const second = index.query('campus lab hoodie', 5).map((hit) => hit.tcin);
    expect(first).toEqual(second);
  });
});

/** Doc order as tcins, for alignment assertions. */
function corpusTokenList(corpus: ReturnType<typeof decodeCorpus>): string[] {
  const out: string[] = [];
  for (let doc = 0; doc < corpus.docCount; doc++) out.push(corpusTcin(corpus, doc));
  return out;
}
