'use client';

// ── Search status and source coverage component ────────────────────────

import { Search, Loader2, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import type { SearchMetadata, SearchStatus as SearchStatusType } from '@/search/types';
import type { ProviderId } from '@/search/types';

interface SearchStatusProps {
  status: SearchStatusType;
  metadata?: SearchMetadata;
  isLoading: boolean;
  query: string;
}

export default function SearchStatus({ status, metadata, isLoading, query }: SearchStatusProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
        <Loader2 size={16} className="animate-spin text-blue-500" />
        <span>Searching across retailers&hellip;</span>
      </div>
    );
  }

  if (!metadata) return null;

  return (
    <div className="mb-4 space-y-2">
      {status === 'no_results' && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
          <Info size={14} />
          <span>No products matched your criteria. Try broadening your search.</span>
        </div>
      )}

      {/* Source coverage */}
      <SourceCoverage metadata={metadata} />

      {/* Timing summary (compact) */}
      {metadata.providersSearched.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
          <span>Found {metadata.totalCandidates} candidates across {metadata.providersSearched.length} sources</span>
          <span>{metadata.entityResolutionCounts.highConfidence + metadata.entityResolutionCounts.mediumConfidence + metadata.entityResolutionCounts.lowConfidence} unique products</span>
          <span>{metadata.timingMs.total}ms</span>
        </div>
      )}
    </div>
  );
}

/** Source coverage indicator — pill for each provider showing searched/failed. */
function SourceCoverage({ metadata }: { metadata: SearchMetadata }) {
  const searched = new Set(metadata.providersSearched);
  const failed = new Set(metadata.providersFailed.map(f => f.providerId));

  // Only show providers that were actually searched or failed
  const allProviders = [
    { id: 'walmart' as ProviderId, label: 'Walmart' },
    { id: 'bestbuy' as ProviderId, label: 'Best Buy' },
    { id: 'target' as ProviderId, label: 'Target' },
    { id: 'ebay' as ProviderId, label: 'eBay' },
    { id: 'costco' as ProviderId, label: 'Costco' },
    { id: 'shopify' as ProviderId, label: 'Shopify' },
  ];

  const relevantProviders = allProviders.filter(p => searched.has(p.id) || failed.has(p.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      {relevantProviders.map(provider => {
        const isSearched = searched.has(provider.id);
        const isFailed = failed.has(provider.id);

        return (
          <span
            key={provider.id}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border ${
              isSearched
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
            }`}
            title={isSearched ? `${provider.label} — searched` : `${provider.label} — unavailable`}
          >
            {isSearched ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
            {provider.label}
          </span>
        );
      })}
    </div>
  );
}
