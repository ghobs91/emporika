'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, BadgePercent } from 'lucide-react';
import { UnifiedProduct } from '@/types/unified';
import DealCard from './DealCard';

/**
 * "Deals for you" — horizontal carousel of discounted products.
 * Reuses the existing /api/trending response (no new API routes) and keeps
 * only items with a meaningful discount (originalPrice > price).
 */
export default function DealsCarousel() {
  const [deals, setDeals] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDeals = async () => {
      try {
        const response = await fetch('/api/trending');
        const data = await response.json();

        if (cancelled) return;

        const categorized = (data.categorizedProducts ?? {}) as Record<string, UnifiedProduct[]>;
        const all = Object.values(categorized).flat();
        const discounted = all
          .filter((p) => p.originalPrice !== undefined && p.originalPrice > p.price)
          .sort(
            (a, b) =>
              ((b.originalPrice ?? b.price) - b.price) - ((a.originalPrice ?? a.price) - a.price)
          )
          .slice(0, 12);

        setDeals(discounted);
      } catch (err) {
        console.error('Failed to fetch deals:', err);
        if (!cancelled) setError('Could not load deals');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadDeals();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error || (!isLoading && deals.length === 0)) return null;

  const scrollByAmount = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section aria-label="Deals for you" className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">
            Deals for you
          </h2>
          <BadgePercent size={20} className="text-red-500" />
        </div>

        {/* Scroll affordances — desktop only; mobile swipes */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByAmount(-1)}
            aria-label="Scroll deals left"
            className="p-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount(1)}
            aria-label="Scroll deals right"
            className="p-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-4 px-4 md:mx-0 md:px-0"
      >
        {isLoading
          ? [...Array(4)].map((_, i) => (
              <div
                key={i}
                className="w-60 md:w-72 shrink-0 snap-start bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-3xl h-96 animate-pulse"
              />
            ))
          : deals.map((product) => <DealCard key={product.id} product={product} />)}
      </div>
    </section>
  );
}
