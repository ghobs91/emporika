'use client';

import { UnifiedProduct } from '@/types/unified';
import { Star } from 'lucide-react';
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

  const getSourceLabel = () => {
    switch (product.source) {
      case 'walmart': return 'Walmart';
      case 'target': return 'Target';
      case 'bestbuy': return 'Best Buy';
      case 'ebay': return 'eBay';
      case 'costco': return 'Costco';
      default: return product.source;
    }
  };

  const getSourceFavicon = () => {
    switch (product.source) {
      case 'walmart': return '/walmart-favicon.png';
      case 'target': return '/target-favicon.png';
      case 'bestbuy': return '/bestbuy-favicon.png';
      case 'ebay': return '/favicon-ebay.png';
      case 'costco': return '/costco-favicon.png';
      default: return '';
    }
  };

  const getSourceColor = () => {
    switch (product.source) {
      case 'walmart': return 'bg-blue-600';
      case 'target': return 'target-logo-bg';
      case 'bestbuy': return 'bg-yellow-500';
      case 'ebay': return 'bg-purple-600';
      case 'costco': return 'bg-gray-600';
      default: return 'bg-gray-600';
    }
  };

  const sourceLabel = getSourceLabel();
  const sourceFavicon = getSourceFavicon();
  const sourceColor = getSourceColor();

  return (
    <div className="bg-white dark:bg-[#242424] rounded-xl overflow-hidden group hover:shadow-xl transition-all duration-200 flex flex-col border border-gray-200 dark:border-gray-800 shadow-sm">
      <div className="relative aspect-square bg-gray-50 dark:bg-[#1a1a1a]">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
            quality={85}
            unoptimized
          />
        )}
        {discount > 0 && (
          <div className="absolute top-2 left-2 bg-white dark:bg-[#242424] text-red-600 dark:text-red-500 px-2 py-0.5 rounded text-xs font-semibold">
            {discount}% OFF
          </div>
        )}
      </div>

      <a
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-3 flex flex-col grow"
      >
        <div className={`${sourceColor} text-white px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1.5 w-fit mb-2`}>
          {sourceFavicon && (
            <Image
              src={sourceFavicon}
              alt={`${sourceLabel} favicon`}
              width={12}
              height={12}
              className="rounded-sm"
              unoptimized
            />
          )}
          {sourceLabel}
        </div>

        <h3 className="text-sm font-normal text-gray-900 dark:text-gray-100 line-clamp-2 mb-2 leading-snug">
          {product.name}
        </h3>

        <div className="mt-auto">
          {product.customerRating && (
            <div className="flex items-center gap-1 mb-1">
              <Star className="fill-yellow-400 text-yellow-400" size={14} />
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{product.customerRating.toFixed(1)}</span>
              {product.reviewCount && (
                <span className="text-xs text-gray-500 dark:text-gray-500">({product.reviewCount.toLocaleString()})</span>
              )}
            </div>
          )}

          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatPrice(product.price)}
            </span>
            {discount > 0 && product.originalPrice && (
              <span className="text-xs text-gray-500 dark:text-gray-500 line-through">
                {formatPrice(product.originalPrice)}
              </span>
            )}
          </div>
        </div>
      </a>
    </div>
  );
}
