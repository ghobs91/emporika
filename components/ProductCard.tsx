'use client';

import { UnifiedProduct } from '@/types/unified';
import { Star, ExternalLink, Truck } from 'lucide-react';
import Image from 'next/image';
import { getRetailerInfo, decodeHtmlEntities } from '@/lib/retailer';

interface ProductCardProps {
  product: UnifiedProduct;
  onClick?: () => void;
}

export default function ProductCard({ product, onClick }: ProductCardProps) {
  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const discount = product.originalPrice && product.originalPrice > product.price
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const { label: sourceLabel, favicon: sourceFavicon } = getRetailerInfo(product.source);

  // For Shopify, prefer merchant name from title; clean up display title
  const displayTitle = product.source === 'shopify' && product.name.includes(' — ')
    ? product.name.split(' — ')[0]
    : product.name;

  const shippingDays = product.shipping?.estimatedDates?.min
    ? Math.max(1, Math.ceil((new Date(product.shipping.estimatedDates.min).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  // Condensed shipping summary — one or two compact tags max to reduce clutter
  const shippingTags: string[] = [];
  if (product.shipping?.freeShipping) shippingTags.push('Free shipping');
  else if (product.shipping?.twoDay) shippingTags.push('2-day shipping');
  else if (product.shipping?.twoThreeDay) shippingTags.push('2-3 day shipping');
  else if (product.shipping?.speed) shippingTags.push(product.shipping.speed);
  if (shippingDays) shippingTags.push(`${shippingDays} day shipping`);

  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="relative bg-white dark:bg-[#242424] rounded-3xl overflow-hidden group hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col border border-gray-200 dark:border-gray-800 cursor-pointer"
      onClick={onClick}
    >
      {/* Image — image-forward with generous padding */}
      <div className="relative aspect-square bg-white dark:bg-[#1a1a1a]">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            quality={85}
            unoptimized
          />
        )}
        {discount > 0 && (
          <div className="absolute top-3 left-3 bg-red-600 text-white px-2.5 py-1 rounded-full text-xs font-bold shadow-sm">
            {discount}% OFF
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col grow gap-2">
        {/* Retailer + rating — emphasized */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {sourceFavicon && (
              <Image
                src={sourceFavicon}
                alt={sourceLabel}
                width={18}
                height={18}
                className="rounded-sm shrink-0"
                unoptimized
              />
            )}
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 truncate">
              {sourceLabel}
            </span>
          </div>
          {product.customerRating !== undefined && (
            <div className="flex items-center gap-1 shrink-0">
              <Star className="fill-yellow-400 text-yellow-400" size={13} />
              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                {product.customerRating.toFixed(1)}
              </span>
              {product.reviewCount !== undefined && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  ({product.reviewCount.toLocaleString()})
                </span>
              )}
            </div>
          )}
        </div>

        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
          {decodeHtmlEntities(displayTitle)}
        </h3>

        {/* Price */}
        <div className="mt-auto pt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            {formatPrice(product.price)}
          </span>
          {discount > 0 && product.originalPrice && (
            <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>

        {/* Shipping — compact single line */}
        {shippingTags.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <Truck size={11} className="shrink-0" />
            <span className="truncate">{shippingTags.slice(0, 2).join(' · ')}</span>
          </div>
        )}
      </div>

      {/* External link */}
      <a
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleExternalLinkClick}
        className="absolute top-3 right-3 bg-white/90 dark:bg-[#242424]/90 hover:bg-white dark:hover:bg-[#242424] p-1.5 rounded-full shadow-sm transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Open product page"
      >
        <ExternalLink size={14} className="text-gray-600 dark:text-gray-300" />
      </a>
    </div>
  );
}
