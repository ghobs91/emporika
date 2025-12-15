'use client';

import { UnifiedProduct } from '@/types/unified';
import { Star, Truck, Zap, Package, ExternalLink } from 'lucide-react';
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

  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className="bg-white dark:bg-[#242424] rounded-xl overflow-hidden group hover:shadow-xl transition-all duration-200 flex flex-col border border-gray-200 dark:border-gray-800 shadow-sm cursor-pointer"
      onClick={onClick}
    >
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

      <div className="p-3 flex flex-col grow relative">
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
          {decodeHtmlEntities(product.name)}
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

          {/* Shipping Information */}
          {product.shipping && (
            <div className="mb-2 flex flex-wrap gap-1">
              {/* Free Shipping Badge */}
              {product.shipping.freeShipping && (
                <div className="flex items-center gap-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded text-xs font-medium">
                  <Truck size={12} />
                  <span>Free Ship</span>
                </div>
              )}
              
              {/* 2-Day Shipping (Walmart) */}
              {product.shipping.twoDay && (
                <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded text-xs font-medium">
                  <Zap size={12} />
                  <span>2-Day</span>
                </div>
              )}
              
              {/* Shipping Levels (Best Buy) */}
              {product.shipping.levels && product.shipping.levels.length > 0 && (
                <div className="flex items-center gap-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded text-xs font-medium">
                  <Package size={12} />
                  <span>{product.shipping.levels[0].name}</span>
                  {product.shipping.levels[0].price === 0 ? (
                    <span className="font-semibold">Free</span>
                  ) : (
                    <span>${product.shipping.levels[0].price.toFixed(2)}</span>
                  )}
                </div>
              )}
              
              {/* Estimated Delivery (eBay) */}
              {product.shipping.estimatedDates?.min && product.shipping.estimatedDates?.max && (
                <div className="flex items-center gap-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded text-xs font-medium">
                  <Truck size={12} />
                  <span>
                    {new Date(product.shipping.estimatedDates.min).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' - '}
                    {new Date(product.shipping.estimatedDates.max).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
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
        
        <a
          href={product.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleExternalLinkClick}
          className="absolute bottom-2 right-2 bg-white dark:bg-[#242424] hover:bg-gray-100 dark:hover:bg-gray-800 p-2 rounded-full shadow-md transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Open product page"
        >
          <ExternalLink size={16} className="text-gray-700 dark:text-gray-300" />
        </a>
      </div>
    </div>
  );
}
