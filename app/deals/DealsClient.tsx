'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, BadgePercent, ShoppingBag } from 'lucide-react';
import DealCard from '@/components/DealCard';
import { UnifiedProduct } from '@/types/unified';
import { PRODUCT_CATEGORIES, ProductCategory } from '@/types/categories';

/** One deal as served by /api/deals (see `DealItem` in the route). */
interface DealItem {
  product: UnifiedProduct;
  category: ProductCategory;
  savings: number;
  discountPct: number;
}

/** Categories that get their own section, in display order. */
const SECTION_ORDER: ProductCategory[] = [
  'electronics',
  'home',
  'fashion',
  'sports',
  'toys',
];

/** Strip the leading emoji from category names (e.g. "📱 Electronics"). */
function cleanCategoryName(name: string): string {
  return name.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}

function categoryLabel(category: ProductCategory): string {
  return category === 'all' ? 'More deals' : cleanCategoryName(PRODUCT_CATEGORIES[category].name);
}

/**
 * Full deals page behind the "Deals" item in the left nav rail.
 *
 * Backed by /api/deals, which returns each deal with its deterministic category
 * (from `lib/categorize-product`) and its savings, so this page only groups and
 * filters — it never re-scores products. `?category=` is addressable so a
 * section can be linked directly.
 */
export default function DealsClient() {
  const searchParams = useSearchParams();
  const rawCategory = searchParams.get('category');
  const category =
    rawCategory && SECTION_ORDER.includes(rawCategory as ProductCategory)
      ? (rawCategory as ProductCategory)
      : undefined;

  const [deals, setDeals] = useState<DealItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/deals');
        const data = await response.json();
        if (cancelled) return;
        setDeals((data.deals ?? []) as DealItem[]);
        setError(data.error ?? null);
      } catch (err) {
        console.error('Failed to load deals:', err);
        if (cancelled) return;
        setDeals([]);
        setError('Could not load deals');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group into sections. Uncategorized deals (categorizeProduct → 'all') land in
  // a trailing "More deals" section instead of being dropped.
  const sections = useMemo(() => {
    const wanted: ProductCategory[] = category ? [category] : [...SECTION_ORDER, 'all'];
    return wanted
      .map((cat) => ({
        category: cat,
        deals: deals.filter((deal) => deal.category === cat),
      }))
      .filter((section) => section.deals.length > 0);
  }, [deals, category]);

  const visibleCount = sections.reduce((total, section) => total + section.deals.length, 0);
  const totalSavings = sections.reduce(
    (total, section) => total + section.deals.reduce((sum, deal) => sum + deal.savings, 0),
    0
  );

  return (
    <div className="min-h-screen bg-white dark:bg-[#131313]">
      <header className="sticky top-0 z-40 border-b border-gray-200 dark:border-[#2b2b2b] bg-white/80 dark:bg-[#131313]/80 backdrop-blur-xl">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-75 transition-opacity">
            <ShoppingBag size={22} className="text-blue-500 dark:text-blue-400" />
            <span className="font-semibold text-gray-900 dark:text-white">Emporika</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to search
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Deals
            <BadgePercent size={24} className="text-red-500" />
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Genuine markdowns across every retailer we search
            {!isLoading && !error && visibleCount > 0
              ? ` · ${visibleCount} deals · $${totalSavings.toFixed(0)} off in total`
              : ''}
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-8">
          <Link
            href="/deals"
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              !category
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                : 'bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            All
          </Link>
          {SECTION_ORDER.map((cat) => (
            <Link
              key={cat}
              href={`/deals?category=${cat}`}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                category === cat
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                  : 'bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              {categoryLabel(cat)}
            </Link>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-96 bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-3xl animate-pulse"
              />
            ))}
          </div>
        ) : sections.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 dark:text-gray-400">
              {error ?? 'No deals right now — check back shortly.'}
            </p>
          </div>
        ) : (
          sections.map((section) => (
            <section key={section.category} aria-labelledby={`deals-${section.category}`} className="mb-10">
              <div className="flex items-baseline justify-between mb-4">
                <h2
                  id={`deals-${section.category}`}
                  className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white"
                >
                  {categoryLabel(section.category)}
                </h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {section.deals.length} {section.deals.length === 1 ? 'deal' : 'deals'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {section.deals.map((deal) => (
                  <DealCard key={deal.product.id} product={deal.product} className="w-full" />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
