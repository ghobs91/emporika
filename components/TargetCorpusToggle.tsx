'use client';

// ── Opt-in toggle for the local Target catalog ─────────────────────────
//
// The corpus is ~98MB on the wire and needs roughly 250MB resident once
// indexed. Downloading or holding that would be indefensible on a phone, and on
// iOS Safari it kills the tab — which reloads, re-reads the persisted flag, and
// downloads again: a crash loop.
//
// Two independent guards stop that:
//   • `isTargetCorpusEnabled()` returns false on unsupported devices, so no
//     download can start even if the flag was set elsewhere on this origin.
//   • this control is hidden below `lg` via CSS, so it is never offered there.
//     CSS rather than state, so server and client markup stay identical.
//
// A failed load also clears the preference, so a reload cannot silently retry
// the thing that just failed.

import { useCallback, useEffect, useState } from 'react';
import { DatabaseZap, Loader2 } from 'lucide-react';
import {
  isTargetCorpusEnabled,
  setTargetCorpusEnabled,
} from '@/lib/target-corpus-provider';
import { loadTargetCorpusIndex } from '@/lib/target-corpus-client';

type Status = 'off' | 'loading' | 'ready' | 'error';

export default function TargetCorpusToggle() {
  const [status, setStatus] = useState<Status>('off');
  const [error, setError] = useState<string | null>(null);

  // Warm the index if the shopper already opted in. No synchronous setState:
  // the first state change happens when the promise settles.
  useEffect(() => {
    if (!isTargetCorpusEnabled()) return;

    let cancelled = false;
    loadTargetCorpusIndex()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Terminal, not retried on the next load.
        setTargetCorpusEnabled(false);
        setError(cause instanceof Error ? cause.message : 'Could not load');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (status === 'ready' || status === 'loading') {
      setTargetCorpusEnabled(false);
      setStatus('off');
      setError(null);
      return;
    }

    setTargetCorpusEnabled(true);
    setStatus('loading');
    setError(null);
    try {
      await loadTargetCorpusIndex();
      setStatus('ready');
    } catch (cause) {
      setTargetCorpusEnabled(false);
      setError(cause instanceof Error ? cause.message : 'Could not load');
      setStatus('error');
    }
  }, [status]);

  const label =
    status === 'ready'
      ? 'Full Target catalog on'
      : status === 'loading'
        ? 'Downloading Target catalog…'
        : status === 'error'
          ? 'Retry Target catalog'
          : 'Load full Target catalog (53MB)';

  return (
    <div className="hidden flex-wrap items-center gap-2 lg:flex">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={status === 'ready' || status === 'loading'}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100"
      >
        {status === 'loading' ? (
          <Loader2 size={11} className="animate-spin" aria-hidden />
        ) : (
          <DatabaseZap size={11} aria-hidden />
        )}
        {label}
      </button>
      {error && (
        <span className="text-[11px] text-amber-700 dark:text-amber-400">{error}</span>
      )}
    </div>
  );
}
