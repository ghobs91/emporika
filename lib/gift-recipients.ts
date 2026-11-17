// ── Gift recipients: client persistence ─────────────────────────────────
//
// Recipients are the shopper's own data and live only in their browser, the
// same way `lib/learning.ts` stores learned preferences. There is no server
// round-trip for a recipient — the profile is sent with each "gift ideas"
// request and never persisted server-side.
//
// Everything here is a thin wrapper over pure functions so the storage
// boundary stays testable: malformed or stale entries are dropped rather
// than crashing the page, and a stored profile that no longer validates
// (e.g. an interest removed from the taxonomy) is discarded.

import {
  giftRecipientSchema,
  type ValidatedGiftRecipient,
} from '@/search/gift/recipient-schema';
import type { Gender, GiftRecipient, InterestId } from '@/search/gift/types';

const STORAGE_KEY = 'emporika-gift-recipients:v1';

/** Bounded so the picker stays usable and localStorage stays small. */
export const MAX_RECIPIENTS = 25;

export interface RecipientDraft {
  name: string;
  gender: Gender;
  age: number;
  interests: InterestId[];
  budget?: number;
}

function isRecipient(value: unknown): value is GiftRecipient {
  return giftRecipientSchema.safeParse(value).success;
}

/** Drop anything that no longer validates, preserving order. */
export function sanitizeRecipients(raw: unknown): GiftRecipient[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecipient).slice(0, MAX_RECIPIENTS);
}

export function newRecipientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Deterministic-enough fallback for browsers/environments without randomUUID.
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize a draft into a storable recipient (trimmed name, no empty budget). */
export function createRecipient(draft: RecipientDraft, now = Date.now()): GiftRecipient {
  const name = draft.name.trim().slice(0, 60);
  return {
    id: newRecipientId(),
    name: name.length > 0 ? name : 'Someone',
    gender: draft.gender,
    age: Math.max(0, Math.min(120, Math.round(draft.age))),
    interests: Array.from(new Set(draft.interests)),
    ...(draft.budget !== undefined && Number.isFinite(draft.budget) && draft.budget > 0
      ? { budget: Math.round(draft.budget * 100) / 100 }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Apply a draft to an existing recipient, keeping identity and createdAt. */
export function updateRecipient(
  recipient: GiftRecipient,
  draft: RecipientDraft,
  now = Date.now()
): GiftRecipient {
  const name = draft.name.trim().slice(0, 60);
  return {
    ...recipient,
    name: name.length > 0 ? name : recipient.name,
    gender: draft.gender,
    age: Math.max(0, Math.min(120, Math.round(draft.age))),
    interests: Array.from(new Set(draft.interests)),
    ...(draft.budget !== undefined && Number.isFinite(draft.budget) && draft.budget > 0
      ? { budget: Math.round(draft.budget * 100) / 100 }
      : { budget: undefined }),
    updatedAt: now,
  };
}

/** Insert or replace by id, newest first, capped. */
export function upsertRecipient(
  list: GiftRecipient[],
  recipient: GiftRecipient
): GiftRecipient[] {
  const others = list.filter((entry) => entry.id !== recipient.id);
  return [recipient, ...others].slice(0, MAX_RECIPIENTS);
}

export function removeRecipient(list: GiftRecipient[], id: string): GiftRecipient[] {
  return list.filter((entry) => entry.id !== id);
}

// ── Storage adapter ────────────────────────────────────────────────────
//
// Reads are snapshot-based so React can subscribe with
// `useSyncExternalStore`. The snapshot must be referentially stable while
// storage is unchanged, so the parsed list is cached against the raw string.

const EMPTY: GiftRecipient[] = [];

let cachedRaw: string | null = null;
let cachedList: GiftRecipient[] = EMPTY;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Subscribe to recipient-list changes in this tab. */
export function subscribeRecipients(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Current recipients. Returns the same array reference until storage
 * changes, which is what `useSyncExternalStore` requires to avoid looping.
 */
export function getRecipientsSnapshot(): GiftRecipient[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedList;

  cachedRaw = raw;
  if (raw === null) {
    cachedList = EMPTY;
    return cachedList;
  }
  try {
    cachedList = sanitizeRecipients(JSON.parse(raw));
  } catch {
    // Corrupt payload: start empty rather than break the page.
    cachedList = EMPTY;
  }
  return cachedList;
}

/** Server render and hydration always start from an empty list. */
export function getRecipientsServerSnapshot(): GiftRecipient[] {
  return EMPTY;
}

export function loadRecipients(): GiftRecipient[] {
  return getRecipientsSnapshot();
}

export function saveRecipients(list: GiftRecipient[]): GiftRecipient[] {
  const sanitized = sanitizeRecipients(list);
  if (typeof window === 'undefined') return sanitized;
  const serialized = JSON.stringify(sanitized);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedList = sanitized;
  } catch {
    // Quota or private-mode failure: keep the in-memory list usable.
    cachedList = sanitized;
  }
  notify();
  return sanitized;
}

export function clearRecipients(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  cachedRaw = null;
  cachedList = EMPTY;
  notify();
}

export type { ValidatedGiftRecipient };
