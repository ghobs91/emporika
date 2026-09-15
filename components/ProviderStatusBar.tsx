'use client';

import type { ProviderStatus } from '@/types/unified';
import { getRetailerInfo } from '@/lib/retailer';
import Image from 'next/image';
import { AlertCircle, Loader2 } from 'lucide-react';

interface ProviderStatusBarProps {
  statuses: ProviderStatus[];
  /** True while providers are still running (progressive results). */
  streaming?: boolean;
}

/**
 * Compact per-retailer result summary. Makes provider degradation explicit:
 * a retailer that returned 0 results or errored is shown, rather than
 * silently omitted (which reads as "this retailer has nothing").
 */
export default function ProviderStatusBar({ statuses, streaming }: ProviderStatusBarProps) {
  if (statuses.length === 0 && !streaming) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3" role="status" aria-label="Retailer results">
      {statuses.map(({ providerId, count, error }) => {
        const info = getRetailerInfo(providerId);
        const chip = error
          ? 'border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
          : count === 0
            ? 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 bg-white dark:bg-[#242424]'
            : 'border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20';

        return (
          <span
            key={providerId}
            title={error ? `${info.label}: ${error}` : `${info.label}: ${count} results`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${chip}`}
          >
            {info.favicon && (
              <Image src={info.favicon} alt="" width={12} height={12} className="rounded-sm" unoptimized />
            )}
            {info.label}
            {error ? <AlertCircle size={11} /> : <span className="font-semibold">{count}</span>}
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
  );
}
