'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import ProductCard from './ProductCard';

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
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Trending Products</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">Discover the most popular products across all retailers.</p>
      </div>
      
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="animate-pulse bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-xl h-80" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {trendingItems.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
