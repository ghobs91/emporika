'use client';

import { WalmartProduct } from '@/types/walmart';
import { ExternalLink, Star } from 'lucide-react';
import Image from 'next/image';

interface ProductCardProps {
  product: WalmartProduct;
}

export default function ProductCard({ product }: ProductCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const discount = product.msrp > product.salePrice
    ? Math.round(((product.msrp - product.salePrice) / product.msrp) * 100)
    : 0;

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden group">
      <div className="relative h-64 bg-gray-100">
        <Image
          src={product.mediumImage || product.thumbnailImage}
          alt={product.name}
          fill
          className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        {discount > 0 && (
          <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-sm font-bold">
            -{discount}%
          </div>
        )}
        <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs font-semibold">
          Walmart
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-gray-800 line-clamp-2 mb-2 min-h-12">
          {product.name}
        </h3>

        {product.customerRating && (
          <div className="flex items-center gap-1 mb-2">
            <Star className="fill-yellow-400 text-yellow-400" size={16} />
            <span className="text-sm font-medium">{product.customerRating}</span>
            {product.numReviews && (
              <span className="text-sm text-gray-500">({product.numReviews})</span>
            )}
          </div>
        )}

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-bold text-green-600">
            {formatPrice(product.salePrice)}
          </span>
          {discount > 0 && (
            <span className="text-sm text-gray-500 line-through">
              {formatPrice(product.msrp)}
            </span>
          )}
        </div>

        {product.freeShippingOver35Dollars && (
          <p className="text-xs text-green-600 mb-2">Free shipping over $35</p>
        )}

        {product.availableOnline && (
          <p className="text-xs text-blue-600 mb-3">Available online</p>
        )}

        <a
          href={product.productTrackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          View Product
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}
