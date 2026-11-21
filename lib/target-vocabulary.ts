// ── Query vocabulary for the precomputed Target index ──────────────────
//
// Option A for serving Target on a host with no persistent disk: precompute
// results for a bounded query vocabulary at build time and ship them as a
// static artifact. That makes coverage a *product* decision rather than a
// runtime constraint, so the vocabulary quality is the whole ballgame.
//
// Pure functions, no imports — so the generator script and the runtime lookup
// share exactly one definition of "the same query" and this is trivially
// testable.

/**
 * Query text canonicalisation. Must be identical at generation and lookup.
 *
 * Punctuation runs collapse to single spaces so that "USB-C cable", "usb+cable"
 * and "usb c cable" are one key. Lowercasing alone would have made the first two
 * unreachable against a vocabulary built from the third.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Cap on the generated artifact.
 *
 * 2,612,363 products and a 396k-token vocabulary mean an unbounded vocabulary
 * explodes the artifact for no gain — past a few thousand queries the marginal
 * entry is a search nobody runs. Sized so the JSON stays a couple of MB, which
 * is small enough to bundle into a serverless function.
 */
export const MAX_VOCABULARY_QUERIES = 20_000;

/** Shortest query worth precomputing; single words are covered by tokens. */
const MIN_QUERY_LENGTH = 3;

/**
 * Union several query sources into one deduplicated, normalised vocabulary.
 *
 * Order is preserved and earlier groups win, so callers can put the highest
 * value sources first (observed trends, then brands, then seeds) and rely on
 * the cap truncating the least valuable tail.
 */
export function buildQueryVocabulary(
  groups: ReadonlyArray<readonly string[]>,
  maxQueries: number = MAX_VOCABULARY_QUERIES
): string[] {
  const seen = new Set<string>();
  const vocabulary: string[] = [];

  for (const group of groups) {
    for (const raw of group) {
      if (typeof raw !== 'string') continue;
      const query = normalizeQuery(raw);
      if (query.length < MIN_QUERY_LENGTH) continue;
      if (seen.has(query)) continue;
      seen.add(query);
      vocabulary.push(query);
      if (vocabulary.length >= maxQueries) return vocabulary;
    }
  }

  return vocabulary;
}

// ── Tokenisation ──────────────────────────────────────────────────────
//
// Shared by every Target backend: the SQLite query layer, the corpus builder,
// and the browser index. It must be one definition, because a token that is
// indexed differently from the way it is queried simply never matches.

/** Tokens shorter than this carry no signal. */
const MIN_TOKEN_LENGTH = 2;

/** Words that appear in titles but never distinguish a product. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'but',
  'not', 'you', 'all', 'any', 'can', 'had', 'has', 'have', 'its', 'our',
  'out', 'were', 'will', 'your',
]);

/** Split text into lowercase alphanumeric tokens, dropping noise words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/** Tokenize for a query: order is irrelevant, so duplicates are dropped. */
export function tokenSet(text: string): string[] {
  return [...new Set(tokenize(text))];
}
