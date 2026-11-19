'use client';

// ── Trend intelligence (client) ─────────────────────────────────────────
//
// `public/data/trends.json` is a static manifest rebuilt weekly by
// `.github/workflows/update-trends.yml` from free publication feeds. This module
// loads it once, caches it, maps a recipient to a cohort, and measures how
// strongly the manifest's terms align with the catalog and with a free-text
// question — all on the device.
//
// Nothing here calls a paid API, and nothing about the shopper leaves the
// browser: the manifest is a public file, and matching happens locally.

import type { AgeBracket, Gender } from '@/search/gift/types';
import {
  cosineSimilarity,
  embedDocuments,
  embedQuery,
  isSemanticReady,
  tokenSimilarity,
} from './semantic';

export const TRENDS_URL = '/data/trends.json';
export const TRENDS_STORAGE_KEY = 'emporika-trends:v1';

/** Mirrors `scripts/fetch-trends.ts` output. */
export interface TrendManifest {
  version: number;
  updatedAt: string;
  methodology?: Record<string, unknown>;
  sources?: Array<{ id: string; label: string; status: string; headlinesUsed: number }>;
  cohorts: Record<string, Record<string, string[]>>;
}

export interface TrendTerm {
  term: string;
  category: string;
  cohort: string;
}

export interface LoadedTrends {
  manifest: TrendManifest;
  /** Where this copy came from. */
  source: 'network' | 'cache' | 'none';
  /** Whole days since the manifest was generated. */
  ageDays: number;
}

// ── Loading + caching ──────────────────────────────────────────────────

const STORAGE_KEY = TRENDS_STORAGE_KEY;
const MAX_CACHE_AGE_DAYS = 30;

let memo: LoadedTrends | null = null;
let inflight: Promise<LoadedTrends> | null = null;

function ageInDays(iso: string, now = Date.now()): number {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

function isManifest(value: unknown): value is TrendManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<TrendManifest>;
  return (
    typeof manifest.updatedAt === 'string' &&
    Number.isFinite(Date.parse(manifest.updatedAt)) &&
    typeof manifest.cohorts === 'object' &&
    manifest.cohorts !== null
  );
}

function readCache(): LoadedTrends | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isManifest(parsed)) return null;
    if (ageInDays(parsed.updatedAt) > MAX_CACHE_AGE_DAYS) return null;
    return { manifest: parsed, source: 'cache', ageDays: ageInDays(parsed.updatedAt) };
  } catch {
    return null;
  }
}

function writeCache(manifest: TrendManifest): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
  } catch {
    // Quota or private mode: the in-memory copy still works for this session.
  }
}

/**
 * Load the manifest, preferring the network and falling back to the cached
 * copy when offline. Safe to call repeatedly; concurrent calls share a request.
 */
export async function loadTrends(): Promise<LoadedTrends> {
  if (memo) return memo;
  if (inflight) return inflight;

  inflight = (async (): Promise<LoadedTrends> => {
    try {
      const response = await fetch(TRENDS_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed: unknown = await response.json();
      if (!isManifest(parsed)) throw new Error('Malformed trend manifest');
      writeCache(parsed);
      memo = { manifest: parsed, source: 'network', ageDays: ageInDays(parsed.updatedAt) };
      return memo;
    } catch {
      const cached = readCache();
      if (cached) {
        memo = cached;
        return cached;
      }
      memo = {
        manifest: { version: 0, updatedAt: new Date(0).toISOString(), cohorts: {} },
        source: 'none',
        ageDays: Number.POSITIVE_INFINITY,
      };
      return memo;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Test seam: drop the memoized manifest. */
export function resetTrendsCache(): void {
  memo = null;
  inflight = null;
}

// ── Cohort mapping ─────────────────────────────────────────────────────

/** Decade bucket for a gift-index age bracket, per gender. */
export function decadeForBracket(bracket: AgeBracket): string | null {
  switch (bracket) {
    case 'young_adult':
      return '20s';
    case 'adult':
      return '30s';
    case 'mature_adult':
      return null; // 41–60 spans two decades; both are tried
    case 'senior':
      return '60plus';
    default:
      return null;
  }
}

/**
 * Ordered cohort fallbacks for a recipient, most specific first.
 *
 * The pipeline only creates a decade bucket when a publication explicitly says
 * "in their 30s", so most weeks these collapse to the gender cohort. That is
 * the point: we fall back rather than invent an age split.
 */
export function cohortChain(gender: Gender, bracket: AgeBracket): string[] {
  if (bracket === 'infant' || bracket === 'toddler' || bracket === 'child' || bracket === 'tween') {
    return ['kids', 'unisex'];
  }
  if (bracket === 'teen') return ['teens', 'unisex'];

  const gendered = gender === 'woman' ? 'women' : gender === 'man' ? 'men' : null;
  if (!gendered) return ['unisex'];

  const decades: string[] = [];
  if (bracket === 'mature_adult') decades.push('40s', '50s');
  else {
    const decade = decadeForBracket(bracket);
    if (decade) decades.push(decade);
  }

  return [...decades.map((decade) => `${gendered}-${decade}`), gendered, 'unisex'];
}

/** Unique terms for a cohort, deduped by term (first cohort wins). */
export function termsForCohorts(
  manifest: TrendManifest,
  cohorts: readonly string[]
): TrendTerm[] {
  const seen = new Set<string>();
  const terms: TrendTerm[] = [];

  for (const cohort of cohorts) {
    const categories = manifest.cohorts[cohort];
    if (!categories) continue;
    for (const [category, list] of Object.entries(categories)) {
      for (const term of list) {
        const key = term.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push({ term, category, cohort });
      }
    }
  }

  return terms;
}

/** Which cohort actually supplied the terms (for the UI label). */
export function resolvedCohort(manifest: TrendManifest, cohorts: readonly string[]): string | null {
  return cohorts.find((cohort) => manifest.cohorts[cohort] !== undefined) ?? null;
}

// ── Matching ───────────────────────────────────────────────────────────

/**
 * Words a shopper uses mapped to manifest categories. Needed because a category
 * can be absent from this week's manifest ("jewelry"), and the answer should
 * say that instead of returning nothing.
 */
const TOPIC_ALIASES: Record<string, string[]> = {
  jewelry: ['jewelry', 'jewellery', 'necklace', 'ring', 'earring', 'bracelet', 'cuff', 'pendant'],
  accessories: ['bag', 'purse', 'wallet', 'scarf', 'sunglasses', 'shoe', 'sneaker', 'boot', 'watch', 'hat'],
  cooking: ['kitchen', 'cook', 'cooking', 'coffee', 'espresso', 'cookware', 'bake', 'baking', 'grill'],
  tech: ['tech', 'gadget', 'phone', 'laptop', 'headphone', 'earbud', 'camera', 'gaming', 'tv'],
  home: ['home', 'decor', 'furniture', 'candle', 'lamp', 'rug', 'sofa', 'bedding'],
  beauty: ['beauty', 'skincare', 'makeup', 'perfume', 'serum', 'hair'],
  fitness: ['fitness', 'gym', 'yoga', 'running', 'workout'],
  outdoors: ['outdoor', 'outdoors', 'camping', 'hiking', 'fishing', 'trail'],
  kids: ['kids', 'toy', 'toys', 'children', 'baby'],
  pets: ['pet', 'pets', 'dog', 'cat'],
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'is',
  'are', 'what', 'whats', 'right', 'now', 'popular', 'trending', 'trend',
  'trends', 'best', 'good', 'gift', 'gifts', 'buy', 'should', 'their', 'they',
  'this', 'that', 'about', 'any', 'some', 'currently', 'lately',
  // Audience words are not topics: "what's trending for men" asks about the
  // cohort, and should return that cohort's terms rather than nothing.
  'men', 'women', 'man', 'woman', 'guys', 'guy', 'ladies', 'her', 'him',
  'she', 'he', 'their', 'them', '20s', '30s', '40s', '50s', '60s', '60plus',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export interface TrendMatch {
  term: string;
  category: string;
  cohort: string;
  /** 0–1 similarity to the question. */
  similarity: number;
}

export interface TrendAnswer {
  /** Ordered cohort fallbacks used. */
  cohorts: string[];
  /** The cohort that actually had terms. */
  resolved: string | null;
  matches: TrendMatch[];
  /** Headline answer for the UI, grounded only in the manifest. */
  summary: string;
  updatedAt: string;
  ageDays: number;
  source: LoadedTrends['source'];
  /** True when the answer came from the embedding model rather than keywords. */
  semantic: boolean;
}

/**
 * Answer "what's trending for …" from the manifest, locally.
 *
 * When the question names a cohort ("women in their 30s") that cohort is used;
 * otherwise the recipient's cohort chain decides. Matching is semantic when the
 * model is loaded, keyword overlap otherwise.
 */
export async function matchTrendsAndCatalog(
  query: string,
  profile: { gender: Gender; ageBracket: AgeBracket }
): Promise<TrendAnswer> {
  const loaded = await loadTrends();
  return answerFromManifest(loaded.manifest, query, profile, {
    source: loaded.source,
    ageDays: loaded.ageDays,
  });
}

/**
 * The matching itself, separated from loading so it can be tested against a
 * fixture manifest (and so the UI can re-answer without a refetch).
 */
export async function answerFromManifest(
  manifest: TrendManifest,
  query: string,
  profile: { gender: Gender; ageBracket: AgeBracket },
  meta: { source?: LoadedTrends['source']; ageDays?: number } = {}
): Promise<TrendAnswer> {
  const chain = cohortChain(profile.gender, profile.ageBracket);

  // Explicit cohort language in the question overrides the profile.
  const question = query.toLowerCase();
  const explicit: string[] = [];
  const decade = /\b(20s|30s|40s|50s|60s)\b/.exec(question)?.[1];
  const gender = /\b(women|woman|her)\b/.test(question)
    ? 'women'
    : /\b(men|man|him)\b/.test(question)
      ? 'men'
      : null;
  if (gender) {
    explicit.push(decade ? `${gender}-${decade === '60s' ? '60plus' : decade}` : gender);
  }
  if (!gender && /\bseniors?\b/.test(question)) explicit.push('seniors');
  if (/\bteens?\b/.test(question)) explicit.push('teens');
  if (/\bkids?|children\b/.test(question)) explicit.push('kids');

  const cohorts = explicit.length > 0 ? [...new Set([...explicit, ...chain])] : chain;
  const resolved = resolvedCohort(manifest, cohorts);
  const terms = termsForCohorts(manifest, cohorts);

  const empty: TrendAnswer = {
    cohorts,
    resolved,
    matches: [],
    summary: '',
    updatedAt: manifest.updatedAt,
    ageDays: meta.ageDays ?? ageInDays(manifest.updatedAt),
    source: meta.source ?? 'network',
    semantic: false,
  };

  if (terms.length === 0 || query.trim().length < 3) {
    return { ...empty, summary: 'No trend data for this cohort yet.' };
  }

  const words = keywords(query);
  let matches: TrendMatch[] = [];
  let semantic = false;

  if (isSemanticReady()) {
    const queryVectors = await embedQuery(query);
    const termVectors = await embedDocuments(terms.map((entry) => entry.term));
    if (queryVectors && termVectors) {
      semantic = true;
      matches = terms
        .map((entry, index) => ({
          ...entry,
          similarity: Math.max(0, cosineSimilarity(queryVectors[0], termVectors[index])),
        }))
        .sort((a, b) => b.similarity - a.similarity);
    }
  }

  if (matches.length === 0) {
    // Keyword fallback: a term scores by how many of the question's words it
    // contains, so "what jewelry is popular for women in their 30s" still finds
    // every jewelry term.
    matches = terms
      .map((entry) => {
        const termWords = new Set(keywords(entry.term));
        const hits = words.filter(
          (word) => termWords.has(word) || entry.term.toLowerCase().includes(word) || entry.category === word
        ).length;
        return { ...entry, similarity: words.length === 0 ? 0 : hits / words.length };
      })
      .sort((a, b) => b.similarity - a.similarity);
  }

  const threshold = semantic ? 0.3 : 0.3;
  const top = matches.filter((match) => match.similarity >= threshold).slice(0, 6);

  // A bare "what's trending" question has no topical words: show the cohort's
  // strongest terms rather than nothing.
  const topical = words.length > 0;
  const selected = top.length > 0 ? top : topical ? [] : matches.slice(0, 6);

  let finalMatches = selected;
  let summaryCohort = resolved;

  // The question may name a category the cohort has nothing for this week
  // ("what jewelry is popular for women in their 30s"). Rather than answer
  // nothing, fall back to that category's terms from any cohort and say so.
  if (finalMatches.length === 0) {
    const categories = new Set(
      Object.values(manifest.cohorts).flatMap((entry) => Object.keys(entry))
    );
    const mentioned =
      Object.entries(TOPIC_ALIASES).find(([, words]) =>
        // Word boundaries: "what" must not match the alias "hat".
        words.some((word) => new RegExp(`\\b${word}\\b`).test(question))
      )?.[0] ??
      [...categories].find(
        (category) => question.includes(category) || question.includes(category.replace(/s$/, ''))
      );

    if (mentioned) {
      const seenTerm = new Set<string>();
      const fallbackTerms: TrendTerm[] = Object.entries(manifest.cohorts)
        .flatMap(([cohort, byCategory]) =>
          (byCategory[mentioned] ?? []).map((term) => ({ term, category: mentioned, cohort }))
        )
        .filter((entry) => {
          const key = entry.term.toLowerCase();
          if (seenTerm.has(key)) return false;
          seenTerm.add(key);
          return true;
        });
      const fallbackMatches = fallbackTerms
        .map((entry) => ({ ...entry, similarity: 0.5 }))
        .sort((a, b) => a.cohort.localeCompare(b.cohort))
        .slice(0, 6);
      if (fallbackMatches.length > 0) {
        finalMatches = fallbackMatches;
        summaryCohort = `other cohorts (no ${mentioned} terms for ${resolved ?? 'this cohort'} yet)`;
      } else {
        // Nothing anywhere in that category this week. Answer with what *is*
        // trending for the cohort and say plainly that the category was empty.
        finalMatches = terms.slice(0, 6).map((entry) => ({ ...entry, similarity: 0.4 }));
        summaryCohort = `${resolved ?? 'this cohort'} (no ${mentioned} trends this week)`;
      }
    }
  }

  const label = summaryCohort ?? 'this cohort';
  const summary =
    finalMatches.length === 0
      ? `No trend terms match that question for ${resolved ?? 'this cohort'}.`
      : `${label}: ${finalMatches.slice(0, 4).map((match) => match.term).join(', ')}`;

  return { ...empty, matches: finalMatches, summary };
}

// ── Affinity signals for ranking ───────────────────────────────────────

export interface TrendAffinity {
  score: number;
  term: string;
  category: string;
}

/**
 * Score products against the cohort's trend terms.
 *
 * Returns `canonicalId → affinity`, where affinity is the best similarity any
 * single trend term achieved. Used as a ranking boost, never a filter.
 */
export async function trendAffinityForProducts(
  products: Array<{ canonicalId: string; title: string }>,
  terms: readonly TrendTerm[]
): Promise<Map<string, TrendAffinity>> {
  const result = new Map<string, TrendAffinity>();
  if (products.length === 0 || terms.length === 0) return result;

  if (isSemanticReady()) {
    const termVectors = await embedDocuments(terms.map((entry) => entry.term));
    const productVectors = await embedDocuments(products.map((product) => product.title));
    if (termVectors && productVectors) {
      for (let p = 0; p < products.length; p += 1) {
        const productVector = productVectors[p];
        let best: TrendAffinity | null = null;
        for (let t = 0; t < terms.length; t += 1) {
          const score = Math.max(0, cosineSimilarity(termVectors[t], productVector));
          if (!best || score > best.score) {
            best = { score, term: terms[t].term, category: terms[t].category };
          }
        }
        if (best && best.score > 0) result.set(products[p].canonicalId, best);
      }
      return result;
    }
  }

  // Keyword fallback: a trend term found verbatim in the title is a strong hit.
  for (const product of products) {
    const title = product.title.toLowerCase();
    let best: TrendAffinity | null = null;
    for (const entry of terms) {
      const needle = entry.term.toLowerCase();
      const score = title.includes(needle)
        ? 1
        : tokenSimilarity(entry.term, product.title);
      if (!best || score > best.score) best = { score, term: entry.term, category: entry.category };
    }
    if (best && best.score > 0) result.set(product.canonicalId, best);
  }
  return result;
}

/** How strongly a search query aligns with the cohort's trend terms. */
export async function trendAffinityForQueries(
  queries: readonly string[],
  terms: readonly TrendTerm[]
): Promise<Map<string, TrendAffinity>> {
  const result = new Map<string, TrendAffinity>();
  if (queries.length === 0 || terms.length === 0) return result;

  if (isSemanticReady()) {
    const termVectors = await embedDocuments(terms.map((entry) => entry.term));
    const queryVectors = await embedDocuments(queries);
    if (termVectors && queryVectors) {
      for (let q = 0; q < queries.length; q += 1) {
        const queryVector = queryVectors[q];
        let best: TrendAffinity | null = null;
        for (let t = 0; t < terms.length; t += 1) {
          const score = Math.max(0, cosineSimilarity(termVectors[t], queryVector));
          if (!best || score > best.score) {
            best = { score, term: terms[t].term, category: terms[t].category };
          }
        }
        if (best && best.score > 0) result.set(queries[q], best);
      }
      return result;
    }
  }

  for (const query of queries) {
    let best: TrendAffinity | null = null;
    for (const entry of terms) {
      const score = tokenSimilarity(entry.term, query);
      if (!best || score > best.score) best = { score, term: entry.term, category: entry.category };
    }
    if (best && best.score > 0) result.set(query, best);
  }
  return result;
}

/** Human label for a cohort id, for the UI. */
export function cohortLabel(cohort: string): string {
  const [gender, decade] = cohort.split('-');
  if (cohort === 'unisex') return 'everyone';
  if (cohort === 'teens') return 'teens';
  if (cohort === 'kids') return 'kids';
  const who = gender === 'women' ? 'women' : gender === 'men' ? 'men' : gender;
  if (!decade) return who;
  return `${who} in their ${decade === '60plus' ? '60s+' : decade}`;
}
