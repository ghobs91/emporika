import { Suspense } from 'react';
import DealsClient from './DealsClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Deals — Emporika',
};

export default function DealsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-[#131313]" />}>
      <DealsClient />
    </Suspense>
  );
}
