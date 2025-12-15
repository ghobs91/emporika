'use client';

import { UnifiedProduct } from '@/types/unified';
import { X, Star, Truck, Zap, Package, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { useEffect } from 'react';

interface ProductModalProps {
  product: UnifiedProduct;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProductModal({ product, isOpen, onClose }: ProductModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-[#242424] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-[#242424] border-b border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between z-10">
          <div className={`${sourceColor} text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2`}>
            {sourceFavicon && (
              <Image
                src={sourceFavicon}
                alt={`${sourceLabel} favicon`}
                width={16}
                height={16}
                className="rounded-sm"
                unoptimized
              />
            )}
            {sourceLabel}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label="Close modal"
          >
            <X size={24} className="text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 grid md:grid-cols-2 gap-6">
          {/* Image Section */}
          <div className="relative aspect-square bg-gray-50 dark:bg-[#1a1a1a] rounded-xl overflow-hidden">
            {product.image && (
              <Image
                src={product.image}
                alt={product.name}
                fill
                className="object-contain p-8"
                sizes="(max-width: 768px) 100vw, 50vw"
                quality={90}
                unoptimized
              />
            )}
            {discount > 0 && (
              <div className="absolute top-4 left-4 bg-white dark:bg-[#242424] text-red-600 dark:text-red-500 px-3 py-1 rounded-lg text-sm font-semibold shadow-md">
                {discount}% OFF
              </div>
            )}
          </div>

          {/* Details Section */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {decodeHtmlEntities(product.name)}
              </h2>
              
              {product.customerRating && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1">
                    <Star className="fill-yellow-400 text-yellow-400" size={18} />
                    <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {product.customerRating.toFixed(1)}
                    </span>
                  </div>
                  {product.reviewCount && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({product.reviewCount.toLocaleString()} reviews)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Price Section */}
            <div className="border-t border-b border-gray-200 dark:border-gray-700 py-4">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">
                  {formatPrice(product.price)}
                </span>
                {discount > 0 && product.originalPrice && (
                  <span className="text-lg text-gray-500 dark:text-gray-400 line-through">
                    {formatPrice(product.originalPrice)}
                  </span>
                )}
              </div>
              {discount > 0 && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  You save {formatPrice((product.originalPrice || 0) - product.price)} ({discount}%)
                </p>
              )}
            </div>

            {/* Shipping Information */}
            {product.shipping && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Shipping</h3>
                <div className="flex flex-wrap gap-2">
                  {product.shipping.freeShipping && (
                    <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-2 rounded-lg text-sm font-medium">
                      <Truck size={16} />
                      <span>Free Shipping</span>
                    </div>
                  )}
                  
                  {product.shipping.twoDay && (
                    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-3 py-2 rounded-lg text-sm font-medium">
                      <Zap size={16} />
                      <span>2-Day Delivery</span>
                    </div>
                  )}
                  
                  {product.shipping.levels && product.shipping.levels.length > 0 && (
                    <div className="space-y-1">
                      {product.shipping.levels.map((level, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 px-3 py-2 rounded-lg text-sm font-medium">
                          <Package size={16} />
                          <span>{level.name}</span>
                          {level.price === 0 ? (
                            <span className="font-semibold">Free</span>
                          ) : (
                            <span>${level.price.toFixed(2)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {product.shipping.estimatedDates?.min && product.shipping.estimatedDates?.max && (
                    <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 px-3 py-2 rounded-lg text-sm">
                      <Truck size={16} />
                      <span>
                        Estimated delivery: {new Date(product.shipping.estimatedDates.min).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' - '}
                        {new Date(product.shipping.estimatedDates.max).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            {product.shortDescription && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Description</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {decodeHtmlEntities(product.shortDescription)}
                </p>
              </div>
            )}

            {/* Availability */}
            {product.availableOnline !== undefined && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Availability</h3>
                <p className={`text-sm font-medium ${product.availableOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {product.availableOnline ? 'In Stock' : 'Out of Stock'}
                </p>
              </div>
            )}

            {/* View on Retailer Button */}
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              View on {sourceLabel}
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
