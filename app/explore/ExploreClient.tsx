'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ShoppingBag, Sparkles } from 'lucide-react';
import { CartProvider } from '@/context/CartContext';
import ProductGrid from '@/components/ProductGrid';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import { getRetailerInfo } from '@/lib/retailer';
import { PRODUCT_CATEGORIES, ProductCategory } from '@/types/categories';

const BROWSE_CATEGORIES: ProductCategory[] = [
  'all',
  'electronics',
  'home',
  'fashion',
  'sports',
  'toys',
];

const VALID_SOURCES: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

/** Strip the leading emoji from category names (e.g. "📱 Electronics"). */
function cleanCategoryName(name: string): string {
  return name.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}

/**
 * Curated browse page behind the retailer/merchant pills and the per-category
 * Explore buttons. Reads a combination of ?source, ?merchant, ?category, ?q
 * and lists only products that match, backed by /api/explore.
 */
export default function ExploreClient() {
  const searchParams = useSearchParams();
  const rawSource = searchParams.get('source');
  const rawCategory = searchParams.get('category');
  const source = VALID_SOURCES.includes(rawSource as RetailerSource)
    ? (rawSource as RetailerSource)
    : undefined;
  const category =
    rawCategory && Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORIES, rawCategory)
      ? (rawCategory as ProductCategory)
      : undefined;
  const merchant = searchParams.get('merchant') || undefined;
  const merchantDomain = searchParams.get('merchantDomain') || undefined;
  const q = searchParams.get('q') || undefined;

  const paramsKey = searchParams.toString();

  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/explore?${paramsKey}`);
        const data = await response.json();
        if (cancelled) return;
        setProducts((data.products ?? []) as UnifiedProduct[]);
        setError(data.error ?? null);
      } catch (err) {
        console.error('Failed to load explore feed:', err);
        if (cancelled) return;
        setProducts([]);
        setError('Could not load products');
      } finally {
        if (!cancelled) setLoadedKey(paramsKey);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [paramsKey]);

  const isLoading = loadedKey !== paramsKey;

  const retailer = source ? getRetailerInfo(source) : null;
  const categoryLabel =
    category && category !== 'all' ? cleanCategoryName(PRODUCT_CATEGORIES[category].name) : null;

  const title = merchant ?? retailer?.label ?? (q ? `Results for “${q}”` : categoryLabel ?? 'Explore');
  const subtitle = merchant
    ? `Everything from ${merchant}`
    : retailer
      ? `Popular products from ${retailer.label}`
      : categoryLabel
        ? `Top ${categoryLabel} picks across retailers`
        : 'Popular products across retailers';

  const categoryLinks = useMemo(() => {
    return BROWSE_CATEGORIES.map((cat) => {
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      if (merchant) params.set('merchant', merchant);
      if (merchantDomain) params.set('merchantDomain', merchantDomain);
      if (cat !== 'all') params.set('category', cat);
      const query = params.toString();
      return { cat, href: query ? `/explore?${query}` : '/explore' };
    });
  }, [source, merchant, merchantDomain]);

  const showCategoryRail = Boolean(source || category || merchant);

  return (
    <CartProvider>
      <div className="min-h-screen bg-white dark:bg-[#1a1a1a]">
        <header className="sticky top-0 z-40 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1a1a1a]/80 backdrop-blur-xl">
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
              {title}
              {!merchant && <Sparkles size={20} className="text-yellow-500" />}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
              {!isLoading && !error ? ` · ${products.length} items` : ''}
            </p>
          </div>

          {showCategoryRail && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-6">
              {categoryLinks.map(({ cat, href }) => {
                const active = (category ?? 'all') === cat;
                const label =
                  cat === 'all' ? 'All' : cleanCategoryName(PRODUCT_CATEGORIES[cat].name);
                return (
                  <Link
                    key={cat}
                    href={href}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                        : 'bg-white dark:bg-[#242424] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          )}

          {error && !isLoading && products.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500 dark:text-gray-400">{error}</p>
            </div>
          ) : (
            <ProductGrid products={products} isLoading={isLoading} />
          )}
        </main>
      </div>
    </CartProvider>
  );
}
