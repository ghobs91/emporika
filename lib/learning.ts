// ── Deterministic interaction learning ──────────────────────────────────
//
// Turns local user interactions (clicks, add-to-cart, checkout) into
// *shopper preferences* that the existing deterministic planner/ranker
// already understands (preferred brands). No model, no server, no
// randomness: the same interaction history always yields the same
// preferences, and the LLM/ranker boundary is untouched.
//
// Persistence is localStorage (client only). All derivation functions are
// pure and covered by tests; the storage adapter is a thin wrapper.

import type { ShopperPreferences } from '@/search/types';

export type InteractionKind = 'click' | 'add_to_cart' | 'purchase';

export interface InteractionSignal {
  kind: InteractionKind;
  providerId?: string;
  brand?: string;
}

export interface LearnedProfile {
  /** Normalized brand token → accumulated weight. */
  brands: Record<string, number>;
  /** Retailer/provider id → accumulated weight. */
  providers: Record<string, number>;
  updatedAt: number;
}

/** Bounded weights per interaction kind (a purchase counts most). */
export const KIND_WEIGHT: Record<InteractionKind, number> = {
  click: 1,
  add_to_cart: 2,
  purchase: 3,
};

const MAX_BRAND_ENTRIES = 50;
const MAX_PROVIDER_ENTRIES = 10;

/** A brand is only surfaced after it accumulates at least this weight. */
export const MIN_BRAND_WEIGHT = 2;
const MAX_DERIVED_BRANDS = 3;

export function emptyProfile(): LearnedProfile {
  return { brands: {}, providers: {}, updatedAt: 0 };
}

function normalizeBrandKey(brand: string): string {
  return brand.trim().toLowerCase().replace(/\s+/g, ' ');
}

function capEntries(record: Record<string, number>, max: number): Record<string, number> {
  const entries = Object.entries(record);
  if (entries.length <= max) return record;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, max));
}

/** Fold a new interaction into the profile (pure). */
export function recordSignal(
  profile: LearnedProfile,
  signal: InteractionSignal
): LearnedProfile {
  const weight = KIND_WEIGHT[signal.kind];
  const brands = { ...profile.brands };
  const providers = { ...profile.providers };

  if (signal.brand) {
    const key = normalizeBrandKey(signal.brand);
    if (key) brands[key] = (brands[key] ?? 0) + weight;
  }
  if (signal.providerId) {
    providers[signal.providerId] = (providers[signal.providerId] ?? 0) + weight;
  }

  return {
    brands: capEntries(brands, MAX_BRAND_ENTRIES),
    providers: capEntries(providers, MAX_PROVIDER_ENTRIES),
    updatedAt: Date.now(),
  };
}

/**
 * Derive `ShopperPreferences` from a profile. Only brands with enough
 * accumulated weight are emitted, strongest first. Returns `{}` when nothing
 * clears the threshold so callers can merge it without side effects.
 */
export function derivePreferences(
  profile: LearnedProfile,
  options?: { minWeight?: number; maxBrands?: number }
): ShopperPreferences {
  const minWeight = options?.minWeight ?? MIN_BRAND_WEIGHT;
  const maxBrands = options?.maxBrands ?? MAX_DERIVED_BRANDS;

  const preferredBrands = Object.entries(profile.brands)
    .filter(([, weight]) => weight >= minWeight)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxBrands)
    .map(([brand]) => brand);

  return preferredBrands.length > 0 ? { preferredBrands } : {};
}

/**
 * Merge learned preferences under explicit ones. Explicit user choices always
 * win; learned brands/priorities are appended (deduped) rather than replacing.
 */
export function mergePreferences(
  explicit: ShopperPreferences | undefined,
  learned: ShopperPreferences
): ShopperPreferences {
  const dedupe = (values: string[] | undefined) => {
    if (!values || values.length === 0) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
    return out;
  };

  const preferredBrands = dedupe([
    ...(explicit?.preferredBrands ?? []),
    ...(learned.preferredBrands ?? []),
  ]);
  const priorities = dedupe([
    ...(explicit?.priorities ?? []),
    ...(learned.priorities ?? []),
  ]);

  return {
    ...learned,
    ...explicit,
    ...(preferredBrands ? { preferredBrands } : {}),
    ...(priorities ? { priorities } : {}),
  };
}

// ── Client storage adapter ──────────────────────────────────────────────

const STORAGE_KEY = 'emporika-learned-profile';

export function loadLearnedProfile(): LearnedProfile {
  if (typeof window === 'undefined') return emptyProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<LearnedProfile>;
    return {
      brands: parsed.brands ?? {},
      providers: parsed.providers ?? {},
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return emptyProfile();
  }
}

export function saveLearnedProfile(profile: LearnedProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage unavailable/full — learning is best-effort.
  }
}

/** Record an interaction and persist the updated profile. */
export function recordInteraction(signal: InteractionSignal): LearnedProfile {
  const next = recordSignal(loadLearnedProfile(), signal);
  saveLearnedProfile(next);
  return next;
}

export function clearLearnedProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
