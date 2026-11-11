import { Suspense } from 'react';
import EmporikaApp from '@/components/EmporikaApp';

/**
 * Home. Searches started here navigate to `/search/results?...`, so the
 * query and its filters are addressable from the first search onward.
 *
 * `EmporikaApp` reads the query string, which Next requires to be wrapped in
 * a Suspense boundary for the route to stay statically renderable.
 */
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-[#131313]" />}>
      <EmporikaApp />
    </Suspense>
  );
}
