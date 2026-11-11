'use client';

import { UnifiedProduct } from '@/types/unified';
import ProductCard from './ProductCard';
import ProductModal from './ProductModal';
import { useState } from 'react';

interface ProductGridProps {
  products: UnifiedProduct[];
  isLoading?: boolean;
}

// Wide generation gaps keep the borderless, image-forward cards readable:
// the whitespace, not a card outline, separates results.
export const RESULTS_GRID_CLASS =
  'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-5 sm:gap-y-10';

export default function ProductGrid({ products, isLoading }: ProductGridProps) {
  const [selectedProduct, setSelectedProduct] = useState<UnifiedProduct | null>(null);

  if (isLoading) {
    return (
      <div className={RESULTS_GRID_CLASS}>
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-2.5">
            <div className="aspect-square rounded-2xl bg-gray-100 dark:bg-[#333333] animate-pulse" />
            <div className="h-2.5 w-1/3 rounded bg-gray-100 dark:bg-[#333333] animate-pulse" />
            <div className="h-2.5 w-full rounded bg-gray-100 dark:bg-[#333333] animate-pulse" />
            <div className="h-2.5 w-2/3 rounded bg-gray-100 dark:bg-[#333333] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">No products found. Try a different search.</p>
      </div>
    );
  }

  return (
    <>
      <div className={RESULTS_GRID_CLASS}>
        {products.map((product) => (
          <ProductCard 
            key={product.id} 
            product={product} 
            onClick={() => setSelectedProduct(product)}
          />
        ))}
      </div>

      {selectedProduct && (
        <ProductModal
          key={selectedProduct.id}
          product={selectedProduct}
          isOpen={true}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
}
