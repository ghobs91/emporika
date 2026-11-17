'use client';

// ── Gift recipients hook ────────────────────────────────────────────────
//
// Subscribes to the localStorage-backed store with
// `useSyncExternalStore`, so the server render and the first client render
// agree (empty list) and the saved people appear on the next paint. No
// state-setting effect, and the list cannot drift out of sync with storage.

import { useCallback, useSyncExternalStore } from 'react';
import {
  createRecipient,
  getRecipientsServerSnapshot,
  getRecipientsSnapshot,
  removeRecipient,
  saveRecipients,
  subscribeRecipients,
  updateRecipient,
  upsertRecipient,
  type RecipientDraft,
} from '@/lib/gift-recipients';
import type { GiftRecipient } from '@/search/gift/types';

const noop = () => () => {};

/** True only after hydration — lets the UI distinguish "empty" from "not read yet". */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}

export function useGiftRecipients() {
  const recipients = useSyncExternalStore(
    subscribeRecipients,
    getRecipientsSnapshot,
    getRecipientsServerSnapshot
  );

  const add = useCallback((draft: RecipientDraft) => {
    const recipient = createRecipient(draft);
    saveRecipients(upsertRecipient(getRecipientsSnapshot(), recipient));
    return recipient;
  }, []);

  const update = useCallback((existing: GiftRecipient, draft: RecipientDraft) => {
    const next = updateRecipient(existing, draft);
    saveRecipients(upsertRecipient(getRecipientsSnapshot(), next));
    return next;
  }, []);

  const remove = useCallback((id: string) => {
    saveRecipients(removeRecipient(getRecipientsSnapshot(), id));
  }, []);

  return { recipients, add, update, remove };
}
