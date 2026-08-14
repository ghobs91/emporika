'use client';

import Image from 'next/image';
import { Star } from 'lucide-react';
import { UnifiedProduct } from '@/types/unified';
import { getRetailerInfo, decodeHtmlEntities } from '@/lib/retailer';

interface DealCardProps {
  product: UnifiedProduct;
}

/**
 * Wide, image-forward card for the "Deals for you" carousel.
 * Shows the dollar savings, retailer logo, rating + review count, and price.
 */
export default function DealCard({ product }: DealCardProps) {
  const { label: sourceLabel, favicon: sourceFavicon } = getRetailerInfo(product.source);
  const savings =
    product.originalPrice && product.originalPrice > product.price
      ? product.originalPrice - product.price
      : 0;

  return (
    <a
      href={product.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group w-60 md:w-72 shrink-0 snap-start bg-white dark:bg-[#242424] rounded-3xl overflow-hidden flex flex-col border border-gray-200 dark:border-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
      aria-label={`${decodeHtmlEntities(product.name)} — Save $${savings.toFixed(0)}`}
    >
      {/* Image */}
      <div className="relative aspect-square bg-white dark:bg-[#1a1a1a]">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 240px, 288px"
            unoptimized
          />
        )}
        {savings > 0 && (
          <span className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
            Save ${savings.toFixed(0)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col grow gap-1.5">
        {/* Retailer */}
        <div className="flex items-center gap-1.5">
          {sourceFavicon && (
            <Image
              src={sourceFavicon}
              alt={sourceLabel}
              width={18}
              height={18}
              className="rounded-sm"
              unoptimized
            />
          )}
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 truncate">
            {sourceLabel}
          </span>
        </div>

        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
          {decodeHtmlEntities(product.name)}
        </h3>

        {/* Rating */}
        {product.customerRating !== undefined && (
          <div className="flex items-center gap-1">
            <Star className="fill-yellow-400 text-yellow-400" size={14} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {product.customerRating.toFixed(1)}
            </span>
            {product.reviewCount !== undefined && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({product.reviewCount.toLocaleString()})
              </span>
            )}
          </div>
        )}

        {/* Price */}
        <div className="mt-auto pt-2 flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900 dark:text-white">
            ${product.price.toFixed(2)}
          </span>
          {savings > 0 && product.originalPrice && (
            <span className="text-sm text-gray-400 dark:text-gray-500 line-through">
              ${product.originalPrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
