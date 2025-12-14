'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import ProductCard from './ProductCard';
import { getAllCategories, ProductCategory } from '@/types/categories';

interface CategoryProducts {
  category: ProductCategory;
  name: string;
  description: string;
  items: UnifiedProduct[];
  isLoading: boolean;
  error: string | null;
}

export default function TrendingFeed() {
  const categories = getAllCategories().filter(cat => cat.id !== 'all');
  const [categoryData, setCategoryData] = useState<CategoryProducts[]>(() =>
    categories.map(cat => ({
      category: cat.id,
      name: cat.name,
      description: cat.description,
      items: [],
      isLoading: true,
      error: null,
    }))
  );

  useEffect(() => {
    const fetchAllCategories = async () => {
      // Fetch all categories with staggered delays to avoid rate limiting
      const fetchPromises = categories.map(async (cat, index) => {
        // Add a staggered delay (200ms per category) to prevent hitting rate limits
        await new Promise(resolve => setTimeout(resolve, index * 200));
        try {
          const params = new URLSearchParams();
          params.append('category', cat.id);
          
          const url = `/api/trending?${params.toString()}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (response.ok) {
            return {
              category: cat.id,
              name: cat.name,
              description: cat.description,
              items: data.items || [],
              isLoading: false,
              error: null,
            };
          } else {
            return {
              category: cat.id,
              name: cat.name,
              description: cat.description,
              items: [],
              isLoading: false,
              error: data.error || 'Failed to load items',
            };
          }
        } catch (err) {
          console.error(`Failed to fetch ${cat.name}:`, err);
          return {
            category: cat.id,
            name: cat.name,
            description: cat.description,
            items: [],
            isLoading: false,
            error: 'Failed to load items',
          };
        }
      });

      const results = await Promise.all(fetchPromises);
      setCategoryData(results);
    };

    fetchAllCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-12">
      {categoryData.map((catData) => (
        <div key={catData.category}>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
              {catData.name}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {catData.description}
            </p>
          </div>

          {catData.error ? (
            <div className="text-center py-8">
              <p className="text-red-500 dark:text-red-400">{catData.error}</p>
            </div>
          ) : catData.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="animate-pulse bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-xl h-80" />
              ))}
            </div>
          ) : catData.items.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {catData.items.slice(0, 8).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">No trending items available in this category.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
