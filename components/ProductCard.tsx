'use client';

import { UnifiedProduct } from '@/types/unified';
import { ExternalLink, Star } from 'lucide-react';
import Image from 'next/image';

interface ProductCardProps {
  product: UnifiedProduct;
}

export default function ProductCard({ product }: ProductCardProps) {
  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const discount = product.originalPrice && product.originalPrice > product.price
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const sourceLabel = product.source === 'walmart' ? 'Walmart' : 'Best Buy';
  const sourceColor = product.source === 'walmart' ? 'bg-blue-600' : 'bg-yellow-500';
  const buttonColor = product.source === 'walmart' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-yellow-500 hover:bg-yellow-600';
  const buttonTextColor = product.source === 'walmart' ? 'text-white' : 'text-gray-900';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl hover:shadow-2xl border-2 border-gray-200 dark:border-gray-700 transition-all duration-300 overflow-hidden group hover:scale-[1.02] hover:-translate-y-1">
      <div className="relative h-64 bg-gray-100 dark:bg-gray-900">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        )}
        {discount > 0 && (
          <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-sm font-bold">
            -{discount}%
          </div>
        )}
        <div className={`absolute top-2 left-2 ${sourceColor} text-white px-2 py-1 rounded text-xs font-semibold`}>
          {sourceLabel}
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 line-clamp-2 mb-2 min-h-12">
          {product.name}
        </h3>

        {product.customerRating && (
          <div className="flex items-center gap-1 mb-2">
            <Star className="fill-yellow-400 text-yellow-400" size={16} />
            <span className="text-sm font-medium dark:text-gray-200">{product.customerRating.toFixed(1)}</span>
            {product.reviewCount && (
              <span className="text-sm text-gray-500 dark:text-gray-400">({product.reviewCount})</span>
            )}
          </div>
        )}

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-bold text-green-600">
            {formatPrice(product.price)}
          </span>
          {discount > 0 && product.originalPrice && (
            <span className="text-sm text-gray-500 line-through">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>

        {product.freeShipping && (
          <p className="text-xs text-green-600 mb-2">Free shipping</p>
        )}

        {product.availableOnline && (
          <p className="text-xs text-blue-600 mb-3">Available online</p>
        )}

        <a
          href={product.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-center gap-2 w-full ${buttonColor} ${buttonTextColor} py-3 rounded-xl transition-all duration-300 font-semibold shadow-lg hover:shadow-xl`}
        >
          View Product
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}
