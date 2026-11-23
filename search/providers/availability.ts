// ── Provider availability / temporary disablement ──────────────────────
//
// A retailer can be structurally unreachable even though its adapter is
// correct. Rather than scatter that knowledge across the orchestrator, the URL
// parser, the retailer pickers and the extension, it lives here as one list.
//
// Disabling a provider here means:
//   • the orchestrator never marks it eligible (so it is never searched)
//   • `?sources=` cannot select it, and a link that only names it falls back
//     to every enabled retailer instead of returning "no eligible providers"
//   • the retailer pickers stop offering it
//   • the web app stops asking the extension to collect it
//
// Re-enabling is deleting its entry — nothing else needs to change.

import type { RetailerSource } from '@/types/unified';

export interface ProviderDisablement {
  /** Shopper-facing reason, short enough for a picker subtitle. */
  reason: string;
  /** Why it is off, and what would have to change to turn it back on. */
  blockedBy: string;
}

/**
 * Retailers that are deliberately not searched right now.
 *
 * Keep this list short and dated: an entry is a known outage, not a place to
 * hide a broken adapter.
 *
 * Target is back in this list, and this time the reason is final rather than an
 * outage. It graduated out once, served from a catalog we built ourselves, and
 * that worked for titles, images and ratings — but never for price. Every route
 * to price was measured and closed: Node, the extension service worker, a page's
 * main world from both the homepage and the search page, a fresh profile, a real
 * user profile with history, and seven retries over twenty seconds. All 435.
 * The remaining options were a visible tab per search or licensed data, and the
 * product decision was to have neither.
 *
 * What is parked, not deleted: `lib/target-index.ts`, `lib/target-corpus.ts`,
 * `scripts/target-sitemap.ts`, `scripts/target-index-build.ts`,
 * `scripts/target-corpus-build.ts` and `scripts/target-precompute.ts` all work
 * and are covered by tests. Reviving Target means deleting this entry and
 * restoring the app-side wiring — not rebuilding any of it.
 */
export const DISABLED_PROVIDERS: Partial<Record<RetailerSource, ProviderDisablement>> = {
  target: {
    reason: 'Target is not currently searchable.',
    blockedBy:
      'Price is only served by redsky.target.com, which answers every request we ' +
      'originate with an HTTP 435 PerimeterX challenge — verified from Node, the ' +
      'extension service worker, a page main world (homepage and search page), a ' +
      'fresh profile, a real user profile, and on retry. The catalog index still ' +
      'supplies titles, images and ratings from the catalog sitemap, but without ' +
      'price it is not worth offering. Disabled 2026-11; see this file for what ' +
      'would have to change.',
  },
};

/** True when the retailer must not be searched or offered. */
export function isProviderDisabled(id: RetailerSource): boolean {
  return Object.prototype.hasOwnProperty.call(DISABLED_PROVIDERS, id);
}

/** Shopper-facing reason, or undefined when the retailer is enabled. */
export function getDisablement(id: RetailerSource): ProviderDisablement | undefined {
  return DISABLED_PROVIDERS[id];
}

/** Every disabled retailer, in the order declared above. */
export function getDisabledProviders(): RetailerSource[] {
  return Object.keys(DISABLED_PROVIDERS) as RetailerSource[];
}

/** Drop disabled retailers, preserving the caller's order. */
export function withoutDisabledProviders(ids: readonly RetailerSource[]): RetailerSource[] {
  return ids.filter((id) => !isProviderDisabled(id));
}
