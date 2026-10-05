import { Suspense } from 'react';
import ExploreClient from './ExploreClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Explore — Emporika',
};

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-[#1a1a1a]" />}>
      <ExploreClient />
    </Suspense>
  );
}
