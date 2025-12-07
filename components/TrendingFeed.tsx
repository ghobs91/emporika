'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import ProductCard from './ProductCard';
import { TrendingUp } from 'lucide-react';

export default function TrendingFeed() {
  const [trendingItems, setTrendingItems] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/api/trending');
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
  }, []);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-8">
        <TrendingUp className="text-orange-500 dark:text-orange-400" size={32} />
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Trending Deals</h2>
      </div>
      
      <div className="max-w-[80%] mx-auto">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-lg">
                <div className="bg-gray-300 dark:bg-gray-700 h-64 rounded-xl mb-4"></div>
                <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded w-3/4 mb-2"></div>
                <div className="bg-gray-300 dark:bg-gray-700 h-4 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {trendingItems.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
