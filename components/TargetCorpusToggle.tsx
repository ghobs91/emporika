'use client';

// ── Opt-in toggle for the local Target catalog ─────────────────────────
//
// The corpus is ~53MB gzipped. Downloading that without asking would be
// indefensible, so it is behind an explicit, persisted choice. Once loaded, the
// index lives in memory for the session and Target answers arbitrary queries
// from the browser instead of the server's curated precomputed vocabulary.

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

  // Reflect an already-enabled session, and warm the index if it was on.
  useEffect(() => {
    if (!isTargetCorpusEnabled()) return;
    setStatus('loading');
    loadTargetCorpusIndex()
      .then(() => setStatus('ready'))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load');
        setStatus('error');
      });
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
      // Leave the preference on so a retry is one click, but say what failed.
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
    <div className="flex flex-wrap items-center gap-2">
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
        <span className="text-[11px] text-amber-700 dark:text-amber-400">
          {error}
        </span>
      )}
    </div>
  );
}
