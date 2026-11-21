'use client';

import type { ProviderStatus } from '@/types/unified';
import { getRetailerInfo } from '@/lib/retailer';
import Image from 'next/image';
import { AlertCircle, Loader2, PlugZap, ShieldAlert } from 'lucide-react';

interface ProviderStatusBarProps {
  statuses: ProviderStatus[];
  /** True while providers are still running (progressive results). */
  streaming?: boolean;
}

/**
 * Compact per-retailer result summary. Makes provider degradation explicit:
 * a retailer that returned 0 results, errored, or could not be reached at all
 * is shown, rather than silently omitted (which reads as "this retailer has
 * nothing").
 *
 * `unavailable` is deliberately distinct from `count: 0`. Target and Costco are
 * edge-blocked server-side and collected in the browser, so "the extension did
 * not supply them" is a configuration problem the shopper can act on, not an
 * absence of matching products.
 */
export default function ProviderStatusBar({ statuses, streaming }: ProviderStatusBarProps) {
  if (statuses.length === 0 && !streaming) return null;

  // One actionable line for the most likely cause, instead of repeating it per
  // retailer in every tooltip.
  const needsBrowser = statuses.find(
    (status) => status.unavailable?.kind === 'browser_required'
  );

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5" role="status" aria-label="Retailer results">
        {statuses.map(({ providerId, count, error, unavailable }) => {
          const info = getRetailerInfo(providerId);
          const label = unavailable
            ? `${info.label}: not searchable — ${unavailable.detail}`
            : error
              ? `${info.label}: ${error}`
              : `${info.label}: ${count} results`;

          const chip = unavailable
            ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
            : error
              ? 'border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              : count === 0
                ? 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 bg-white dark:bg-[#242424]'
                : 'border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20';

          return (
            <span
              key={providerId}
              title={label}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${chip}`}
            >
              {info.favicon && (
                <Image src={info.favicon} alt="" width={12} height={12} className="rounded-sm" unoptimized />
              )}
              {info.label}
              {unavailable ? (
                unavailable.kind === 'browser_required' ? (
                  <PlugZap size={11} aria-hidden />
                ) : (
                  <ShieldAlert size={11} aria-hidden />
                )
              ) : error ? (
                <AlertCircle size={11} aria-hidden />
              ) : (
                <span className="font-semibold">{count}</span>
              )}
            </span>
          );
        })}
        {streaming && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <Loader2 size={11} className="animate-spin" />
            searching…
          </span>
        )}
      </div>

      {needsBrowser && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <PlugZap size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {getRetailerInfo(needsBrowser.providerId).label} can only be searched
            from your own browser. Install or reload the Emporika extension to
            include it.
          </span>
        </p>
      )}
    </div>
  );
}
