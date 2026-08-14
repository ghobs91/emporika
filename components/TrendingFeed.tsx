'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import { ChevronRight, Sparkles } from 'lucide-react';
import ProductCard from './ProductCard';
import ProductModal from './ProductModal';
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
  const [selectedProduct, setSelectedProduct] = useState<UnifiedProduct | null>(null);
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
    const fetchTrendingProducts = async () => {
      try {
        const response = await fetch('/api/trending');
        const data = await response.json();
        
        if (data.categorizedProducts) {
          const updatedCategories = categories.map(cat => ({
            category: cat.id,
            name: cat.name,
            description: cat.description,
            items: data.categorizedProducts[cat.id] || [],
            isLoading: false,
            error: data.error || null,
          }));
          
          setCategoryData(updatedCategories);
        } else {
          const errorCategories = categories.map(cat => ({
            category: cat.id,
            name: cat.name,
            description: cat.description,
            items: [],
            isLoading: false,
            error: data.error || 'Failed to load items',
          }));
          
          setCategoryData(errorCategories);
        }
      } catch (err) {
        console.error('Failed to fetch trending products:', err);
        const errorCategories = categories.map(cat => ({
          category: cat.id,
          name: cat.name,
          description: cat.description,
          items: [],
          isLoading: false,
          error: 'Failed to load items',
        }));
        
        setCategoryData(errorCategories);
      }
    };

    fetchTrendingProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      {categoryData.map((catData) => (
        <section
          key={catData.category}
          className="bg-[#f8f9fa] dark:bg-[#1a1a1a] rounded-3xl p-4 md:p-6 border border-gray-200 dark:border-gray-800"
        >
          {/* Section header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">
                {catData.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {catData.description}
              </p>
            </div>
            <button
              onClick={() => {
                // Could navigate to dedicated category page in the future
                document.getElementById(`category-${catData.category}`)?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-[#242424] hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded-full border border-gray-200 dark:border-gray-700 transition-colors"
            >
              Explore
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Sublabel */}
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles size={14} className="text-yellow-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Top deals
            </span>
          </div>

          {catData.error ? (
            <div className="text-center py-8">
              <p className="text-red-500 dark:text-red-400">{catData.error}</p>
            </div>
          ) : catData.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-800 rounded-3xl h-72" />
              ))}
            </div>
          ) : catData.items.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {catData.items.slice(0, 6).map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onClick={() => setSelectedProduct(product)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">No trending items available in this category.</p>
            </div>
          )}
        </section>
      ))}

      {selectedProduct && (
        <ProductModal
          key={selectedProduct.id}
          product={selectedProduct}
          isOpen={true}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}
