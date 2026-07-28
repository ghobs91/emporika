'use client';

import { UnifiedProduct } from '@/types/unified';
import { Star, ExternalLink } from 'lucide-react';
import Image from 'next/image';

interface ProductCardProps {
  product: UnifiedProduct;
  onClick?: () => void;
}

export default function ProductCard({ product, onClick }: ProductCardProps) {
  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const decodeHtmlEntities = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
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
      case 'shopify':
        // Extract merchant name from product title if present, otherwise 'Shopify'
        if (product.name.includes(' — ')) {
          return product.name.split(' — ').pop() || 'Shopify';
        }
        return 'Shopify';
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
      case 'shopify': return '/shopify-logo.svg';
      default: return '';
    }
  };

  const sourceLabel = getSourceLabel();
  const sourceFavicon = getSourceFavicon();

  // For Shopify, prefer merchant name from title; clean up display title
  const displayTitle = product.source === 'shopify' && product.name.includes(' — ')
    ? product.name.split(' — ')[0]
    : product.name;

  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="relative bg-white dark:bg-[#242424] rounded-2xl overflow-hidden group hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col border border-gray-200 dark:border-gray-800 cursor-pointer"
      onClick={onClick}
    >
      {/* Image */}
      <div className="relative aspect-square bg-white dark:bg-[#1a1a1a] p-4">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-3 group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            quality={85}
            unoptimized
          />
        )}
        {discount > 0 && (
          <div className="absolute top-3 right-3 bg-red-600 text-white px-2 py-0.5 rounded-md text-xs font-bold shadow-sm">
            {discount}% OFF
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col grow">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 mb-2 leading-snug min-h-10">
          {decodeHtmlEntities(displayTitle)}
        </h3>

        {/* Retailer line */}
        <div className="flex items-center gap-1.5 mb-2">
          {sourceFavicon && (
            <Image
              src={sourceFavicon}
              alt={sourceLabel}
              width={14}
              height={14}
              className="rounded-sm"
              unoptimized
            />
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {sourceLabel}
          </span>
        </div>

        {/* Rating */}
        {product.customerRating && (
          <div className="flex items-center gap-1 mb-2">
            <Star className="fill-yellow-400 text-yellow-400" size={12} />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {product.customerRating.toFixed(1)}
            </span>
            {product.reviewCount && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({product.reviewCount.toLocaleString()})
              </span>
            )}
          </div>
        )}

        {/* Price */}
        <div className="mt-auto flex items-baseline gap-2">
          <span className="text-base font-bold text-gray-900 dark:text-white">
            {formatPrice(product.price)}
          </span>
          {discount > 0 && product.originalPrice && (
            <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>
      </div>

      {/* External link */}
      <a
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleExternalLinkClick}
        className="absolute top-3 left-3 bg-white/90 dark:bg-[#242424]/90 hover:bg-white dark:hover:bg-[#242424] p-1.5 rounded-full shadow-sm transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Open product page"
      >
        <ExternalLink size={14} className="text-gray-600 dark:text-gray-300" />
      </a>
    </div>
  );
}
