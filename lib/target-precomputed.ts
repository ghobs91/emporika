// ── Precomputed Target results ─────────────────────────────────────────
//
// Production Target serving. `lib/target-index.ts` queries a ~433MB SQLite
// catalog, which is the right shape locally but cannot run on a host with no
// persistent disk: serverless bundles are capped in the tens of MB, `/tmp` is
// cold per instance, so opening the database per request is not possible.
//
// Option A therefore moves the search *off* the request path. A scheduled job
// (see `scripts/target-precompute.ts`) runs the real SQLite index over a bounded
// query vocabulary and commits `data/target-precomputed.json`. At runtime this
// module answers from that map with a single object lookup — no I/O, no cold
// start, no database.
//
// The trade is explicit and deliberate: arbitrary queries are only served when
// `lib/target-index.ts` has a database on disk (local/dev). On production the
// answer is "Target results are precomputed for a curated query set", reported
// as a warning, never as "Target has no matching products".
//
// The artifact is imported rather than fetched: bundling it into the server
// chunk means it is parsed once per instance with no network round trip and no
// dependence on `NEXT_PUBLIC_BASE_URL`. At a couple of MB that is cheap.

import precomputed from '@/data/target-precomputed.json';
import { normalizeQuery } from '@/lib/target-vocabulary';

/** Where the generator writes and this module reads. */
export const TARGET_PRECOMPUTED_PATH = 'data/target-precomputed.json';

/** `[tcin, title]` — positional to keep the artifact small. */
export type PrecomputedTargetHitTuple = [string, string];

interface PrecomputedArtifact {
  version: number;
  generatedAt: string;
  source: {
    /** Products in the catalog the artifact was generated from. */
    products: number;
    shards: number;
    /** Hits stored per query. */
    hitLimit: number;
  };
  queries: Record<string, PrecomputedTargetHitTuple[]>;
}

const artifact = precomputed as unknown as PrecomputedArtifact;

/**
 * Guard against a corrupted or hand-edited artifact.
 *
 * The file is generated and committed by a scheduled job, so a truncated write
 * or a bad merge is a real (if unlikely) possibility. Dropping malformed rows
 * degrades coverage for one query; trusting them would put `undefined` titles
 * into the ranking pipeline.
 */
function isHitTuple(value: unknown): value is PrecomputedTargetHitTuple {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string' &&
    value[0].length > 0
  );
}

/** Normalised query → hits. Built once per process at module load. */
const byQuery = new Map<string, readonly PrecomputedTargetHitTuple[]>(
  Object.entries(artifact.queries ?? {}).map(([query, hits]) => [
    query,
    // An empty array is meaningful: the query was precomputed and Target had
    // no match. Absent entirely means the vocabulary does not cover it.
    (Array.isArray(hits) ? hits : []).filter(isHitTuple),
  ])
);

/** True when the artifact has any usable entries. */
export function isPrecomputedTargetAvailable(): boolean {
  return byQuery.size > 0;
}

/** Artifact facts, for logs and the UI's coverage note. */
export function precomputedTargetStats(): {
  version: number;
  generatedAt: string;
  queryCount: number;
  products: number;
  shards: number;
  hitLimit: number;
} {
  return {
    version: artifact.version,
    generatedAt: artifact.generatedAt,
    queryCount: byQuery.size,
    products: artifact.source?.products ?? 0,
    shards: artifact.source?.shards ?? 0,
    hitLimit: artifact.source?.hitLimit ?? 0,
  };
}

export interface PrecomputedTargetHit {
  tcin: string;
  title: string;
}

/**
 * Look up a query.
 *
 * Returns `undefined` when the vocabulary does not cover the query — distinct
 * from `[]`, which means the query was precomputed and Target genuinely had no
 * match. Callers must not collapse the two: one is a coverage gap, the other is
 * a real empty result.
 */
export function lookupPrecomputedTarget(query: string): PrecomputedTargetHit[] | undefined {
  const hits = byQuery.get(normalizeQuery(query));
  if (!hits) return undefined;
  return hits.map(([tcin, title]) => ({ tcin, title }));
}
