// ── Local behavioural ledger (per recipient, on-device only) ────────────
//
// Shoppers click, save and dismiss gift ideas. Those signals never leave the
// browser: they are aggregated here, decayed, and turned into an affinity map
// that the client-side ranker uses to nudge future scores.
//
// Design notes:
//  - Aggregated, not event-sourced: one row per (recipient, dimension, key),
//    so a year of browsing cannot grow the store without bound.
//  - Dismissals weigh more than clicks, saves more than either. A dismissal is
//    a deliberate "not this", which is the strongest gift-specific signal.
//  - Half-life decay, so an old dismissal stops punishing a category forever.
//  - Distinct from `lib/learning.ts`, which learns *brand* preferences globally
//    for search. This is per recipient and gift-specific.

import type { ProductType } from './product-type';

export const LEDGER_STORAGE_KEY = 'emporika-gift-ledger:v1';

export type LedgerAction = 'clicked' | 'saved' | 'dismissed';
export type LedgerDimension = 'interest' | 'brand' | 'productType' | 'intent' | 'retailer';

/** Weight per interaction. Dismissal is deliberately the strongest. */
export const ACTION_WEIGHT: Record<LedgerAction, number> = {
  clicked: 1,
  saved: 3,
  dismissed: -4,
};

/** Days after which a signal loses half its influence. */
export const HALF_LIFE_DAYS = 30;

/** Bounds so localStorage cannot grow without limit. */
const MAX_ROWS_PER_RECIPIENT = 60;

export interface LedgerRow {
  recipientId: string;
  dimension: LedgerDimension;
  key: string;
  /**
   * Per-action counts. Kept separate on purpose: a single `count` that
   * overwrote `action` meant "saved once, then dismissed" became two
   * dismissals and hid an entire product type.
   */
  counts: Record<LedgerAction, number>;
  lastAt: number;
}

export interface Ledger {
  version: 1;
  rows: LedgerRow[];
}

export function emptyLedger(): Ledger {
  return { version: 1, rows: [] };
}

/**
 * Stable empty snapshot. `useSyncExternalStore` compares by reference, so
 * returning a fresh object from `getServerSnapshot` re-renders forever.
 */
const EMPTY_LEDGER: Ledger = { version: 1, rows: [] };

function rowId(recipientId: string, dimension: LedgerDimension, key: string): string {
  return `${recipientId}|${dimension}|${key}`;
}

/** Fold one interaction into the ledger (pure). */
export function recordSignal(
  ledger: Ledger,
  input: {
    recipientId: string;
    dimension: LedgerDimension;
    key: string;
    action: LedgerAction;
    at?: number;
  }
): Ledger {
  const at = input.at ?? Date.now();
  const normalizedKey = input.key.trim().toLowerCase();
  if (!normalizedKey) return ledger;

  const rows = [...ledger.rows];
  const index = rows.findIndex(
    (row) =>
      rowId(row.recipientId, row.dimension, row.key) ===
      rowId(input.recipientId, input.dimension, normalizedKey)
  );

  if (index >= 0) {
    const counts = { ...rows[index].counts };
    counts[input.action] += 1;
    rows[index] = { ...rows[index], counts, lastAt: at };
  } else {
    rows.push({
      recipientId: input.recipientId,
      dimension: input.dimension,
      key: normalizedKey,
      counts: { clicked: 0, saved: 0, dismissed: 0, [input.action]: 1 },
      lastAt: at,
    });
  }

  // Keep the most recent rows per recipient.
  const forRecipient = rows.filter((row) => row.recipientId === input.recipientId);
  if (forRecipient.length > MAX_ROWS_PER_RECIPIENT) {
    const keep = new Set(
      forRecipient
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, MAX_ROWS_PER_RECIPIENT)
        .map((row) => rowId(row.recipientId, row.dimension, row.key))
    );
    return {
      version: 1,
      rows: rows.filter(
        (row) => row.recipientId !== input.recipientId || keep.has(rowId(row.recipientId, row.dimension, row.key))
      ),
    };
  }

  return { version: 1, rows };
}

/** Exponential decay with `HALF_LIFE_DAYS` half-life. */
export function decayFactor(lastAt: number, now = Date.now()): number {
  const days = Math.max(0, (now - lastAt) / 86_400_000);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** Signed standing for one key, decayed and squashed to [-1, 1]. */
export function affinity(
  ledger: Ledger,
  input: { recipientId: string; dimension: LedgerDimension; key: string },
  now = Date.now()
): number {
  const key = input.key.trim().toLowerCase();
  let total = 0;

  for (const row of ledger.rows) {
    if (row.recipientId !== input.recipientId) continue;
    if (row.dimension !== input.dimension || row.key !== key) continue;
    const decay = decayFactor(row.lastAt, now);
    total +=
      (ACTION_WEIGHT.clicked * row.counts.clicked +
        ACTION_WEIGHT.saved * row.counts.saved +
        ACTION_WEIGHT.dismissed * row.counts.dismissed) *
      decay;
  }

  // tanh keeps the effect bounded: 5 net dismissals ≈ -0.85, 1 save ≈ +0.6.
  return Math.tanh(total / 4);
}

/** Affinity for every key in a dimension, e.g. all interests. */
export function affinityMap(
  ledger: Ledger,
  recipientId: string,
  dimension: LedgerDimension,
  now = Date.now()
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of ledger.rows) {
    if (row.recipientId !== recipientId || row.dimension !== dimension) continue;
    out[row.key] = affinity(ledger, { recipientId, dimension, key: row.key }, now);
  }
  return out;
}

/** True when a key has been dismissed enough to be hidden outright. */
export function isSuppressed(score: number): boolean {
  return score <= -0.8;
}

// ── Storage adapter ────────────────────────────────────────────────────

function emptyCounts(): Record<LedgerAction, number> {
  return { clicked: 0, saved: 0, dismissed: 0 };
}

/**
 * Accept only well-formed rows. v1 rows (single `action` + `count`) are
 * migrated rather than dropped, so upgrading does not erase learned signals.
 */
function toRow(value: unknown): LedgerRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<LedgerRow> & { action?: string; count?: number };

  if (
    typeof row.recipientId !== 'string' ||
    typeof row.dimension !== 'string' ||
    typeof row.key !== 'string' ||
    typeof row.lastAt !== 'number'
  ) {
    return null;
  }

  if (row.counts && typeof row.counts === 'object') {
    const counts = emptyCounts();
    for (const action of ['clicked', 'saved', 'dismissed'] as LedgerAction[]) {
      const value = (row.counts as Record<string, unknown>)[action];
      counts[action] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    }
    return {
      recipientId: row.recipientId,
      dimension: row.dimension as LedgerDimension,
      key: row.key,
      counts,
      lastAt: row.lastAt,
    };
  }

  // v1 migration.
  if (typeof row.action === 'string' && typeof row.count === 'number') {
    const action = row.action as LedgerAction;
    if (!(action in ACTION_WEIGHT)) return null;
    return {
      recipientId: row.recipientId,
      dimension: row.dimension as LedgerDimension,
      key: row.key,
      counts: { ...emptyCounts(), [action]: row.count },
      lastAt: row.lastAt,
    };
  }

  return null;
}

export function sanitizeLedger(raw: unknown): Ledger {
  if (typeof raw !== 'object' || raw === null) return emptyLedger();
  const rows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return emptyLedger();
  return {
    version: 1,
    rows: rows.map(toRow).filter((row): row is LedgerRow => row !== null),
  };
}

let cachedRaw: string | null = null;
let cachedLedger: Ledger = emptyLedger();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLedgerSnapshot(): Ledger {
  if (typeof window === 'undefined') return cachedLedger;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedLedger;
  cachedRaw = raw;
  try {
    cachedLedger = raw ? sanitizeLedger(JSON.parse(raw)) : emptyLedger();
  } catch {
    cachedLedger = emptyLedger();
  }
  return cachedLedger;
}

export function getLedgerServerSnapshot(): Ledger {
  return EMPTY_LEDGER;
}

export function saveLedger(ledger: Ledger): Ledger {
  const sanitized = sanitizeLedger(ledger);
  cachedLedger = sanitized;
  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(sanitized);
      window.localStorage.setItem(LEDGER_STORAGE_KEY, serialized);
      cachedRaw = serialized;
    } catch {
      // Quota or private mode — keep the in-memory ledger usable.
    }
  }
  notify();
  return sanitized;
}

/** Record one interaction and persist it. */
export function recordGiftInteraction(input: {
  recipientId: string;
  dimension: LedgerDimension;
  key: string;
  action: LedgerAction;
}): Ledger {
  return saveLedger(recordSignal(getLedgerSnapshot(), input));
}

export function clearLedger(recipientId?: string): Ledger {
  const current = getLedgerSnapshot();
  const next = recipientId
    ? { version: 1 as const, rows: current.rows.filter((row) => row.recipientId !== recipientId) }
    : emptyLedger();
  return saveLedger(next);
}

/** Signals derived from one idea, for `recordGiftInteraction`. */
export function signalsForIdea(input: {
  recipientId: string;
  interests: readonly string[];
  productType: ProductType;
  brands: readonly string[];
  intentId: string;
  retailer?: string;
}): Array<{ dimension: LedgerDimension; key: string }> {
  const signals: Array<{ dimension: LedgerDimension; key: string }> = [
    { dimension: 'productType', key: input.productType },
    { dimension: 'intent', key: input.intentId },
  ];
  for (const interest of input.interests) signals.push({ dimension: 'interest', key: interest });
  for (const brand of input.brands) signals.push({ dimension: 'brand', key: brand });
  if (input.retailer) signals.push({ dimension: 'retailer', key: input.retailer });
  return signals;
}
