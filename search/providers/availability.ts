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
 * Target has graduated out of this list. It used to be here because its Redsky
 * host answered every non-navigation request with an HTTP 435 PerimeterX
 * challenge; it is now served from a locally built catalog index
 * (`lib/target-index.ts`) that never contacts the retailer, gated on that
 * artifact existing rather than on this registry. The list is kept because
 * "this retailer is off, and here is why" is still a thing that happens —
 * deleting the mechanism would mean the next outage gets hard-coded into the
 * orchestrator instead.
 */
export const DISABLED_PROVIDERS: Partial<Record<RetailerSource, ProviderDisablement>> = {};

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
