'use client';

import { useEffect, useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
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
        // Make a single API call to get all trending products categorized
        const response = await fetch('/api/trending');
        const data = await response.json();
        
        if (data.categorizedProducts) {
          // Update each category with its products from the categorized response
          const updatedCategories = categories.map(cat => ({
            category: cat.id,
            name: cat.name,
            description: cat.description,
            items: data.categorizedProducts[cat.id] || [],
            isLoading: false,
            error: data.error || null, // Show error if present but still display any products
          }));
          
          setCategoryData(updatedCategories);
        } else {
          // Handle error case - no categorizedProducts in response
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
        // Handle error case
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
        </div>
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
