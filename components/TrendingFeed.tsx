'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import { ProductCategory, getAllCategories, CategoryConfig } from '@/types/categories';
import ProductCard from './ProductCard';

export default function TrendingFeed() {
  const [trendingItems, setTrendingItems] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory>('all');
  const categories = getAllCategories();

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`/api/trending?category=${selectedCategory}`);
        const data = await response.json();
        
        if (response.ok) {
          setTrendingItems(data.items || []);
        } else {
          setError(data.error || 'Failed to load trending items');
        }
      } catch (err) {
        console.error('Failed to fetch trending items:', err);
        setError('Failed to load trending items');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrending();
  }, [selectedCategory]);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Category Filter Tabs */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Trending Products</h2>
        
        {/* Category tabs - horizontal scroll on mobile */}
        <div className="overflow-x-auto scrollbar-hide -mx-6 px-6 md:mx-0 md:px-0">
          <div className="flex gap-2 min-w-max md:flex-wrap">
            {categories.map((category: CategoryConfig) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  selectedCategory === category.id
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-[#242424] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {/* Category description */}
        {selectedCategory !== 'all' && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
            {categories.find((c: CategoryConfig) => c.id === selectedCategory)?.description}
          </p>
        )}
      </div>

      {/* Products Grid */}
      <div>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-xl h-80" />
            ))}
          </div>
        ) : trendingItems.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {trendingItems.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">No trending items found for this category</p>
          </div>
        )}
      </div>
    </div>
  );
}
