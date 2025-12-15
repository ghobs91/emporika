'use client';

import { UnifiedProduct } from '@/types/unified';
import ProductCard from './ProductCard';
import ProductModal from './ProductModal';
import { useState } from 'react';

interface ProductGridProps {
  products: UnifiedProduct[];
  isLoading?: boolean;
}

export default function ProductGrid({ products, isLoading }: ProductGridProps) {
  const [selectedProduct, setSelectedProduct] = useState<UnifiedProduct | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-[#242424] rounded-xl h-80 animate-pulse border border-gray-200 dark:border-gray-800" />
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
          product={selectedProduct}
          isOpen={true}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
}
