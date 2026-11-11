import { Suspense } from 'react';
import type { Metadata } from 'next';
import EmporikaApp from '@/components/EmporikaApp';

export const metadata: Metadata = {
  title: 'Search results — Emporika',
};

/**
 * Addressable search results. The URL carries the whole search state:
 *
 *   /search/results?query=mac%20mini&inStock=true&maxPrice=990
 *
 * See `lib/search-url.ts` for the key contract (query, filters, stores, sort).
 */
export default function SearchResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-[#131313]" />}>
      <EmporikaApp />
    </Suspense>
  );
}
