'use client';

import { useState } from 'react';
import { UnifiedProduct } from '@/types/unified';
import type { RankedOffer, RankedProduct } from '@/search/types';
import { Star, ExternalLink, Truck, ChevronDown, ChevronUp, TrendingUp, Info } from 'lucide-react';
import Image from 'next/image';
import MerchantLogo from '@/components/MerchantLogo';
import { getRetailerInfo, decodeHtmlEntities } from '@/lib/retailer';

interface ProductCardProps {
  product: UnifiedProduct;
  /** 1-based rank, shown as a badge when the result is from ranked search. */
  rank?: number;
  /** Full ranked contract (best offer, alternates, reasons) when available. */
  ranked?: RankedProduct;
  onClick?: () => void;
}

export default function ProductCard({ product, rank, ranked, onClick }: ProductCardProps) {
  const [showOffers, setShowOffers] = useState(false);

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  const discount = product.originalPrice && product.originalPrice > product.price
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const { label: sourceLabel, favicon: sourceFavicon } = getRetailerInfo(product.source);

  // Shopify is a fulfillment platform, not the merchant — surface the actual
  // storefront as the primary label and keep Shopify as a secondary badge.
  const hasMerchant = product.source === 'shopify' && !!product.sellerName;

  // For Shopify, prefer merchant name from title; clean up display title
  const displayTitle = product.source === 'shopify' && product.name.includes(' — ')
    ? product.name.split(' — ')[0]
    : product.name;

  // ── Ranked contract (#1): offers, reasons, confidence ─────────────────
  const offers: RankedOffer[] = ranked
    ? [ranked.bestOffer, ...ranked.alternateOffers].filter((o): o is RankedOffer => Boolean(o))
    : [];
  const best = ranked?.bestOffer?.offer;
  const storeCount = new Set(offers.map((o) => o.offer.providerId)).size;
  const priceValues = offers
    .map((o) => o.offer.price?.amount)
    .filter((n): n is number => n !== undefined);
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : undefined;
  const multipleStores = storeCount > 1;

  const shippingDays = product.shipping?.estimatedDates?.min
    ? Math.max(1, Math.ceil((new Date(product.shipping.estimatedDates.min).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  // Landed cost (#3): prefer the ranked best-offer shipping, else the
  // normalized retailer shipping cost.
  const shippingCost =
    best?.fulfillment?.shippingCost?.amount ?? product.shippingCost;
  const landedCost = shippingCost !== undefined ? product.price + shippingCost : undefined;

  // Condensed shipping summary — one or two compact tags max to reduce clutter
  const shippingTags: string[] = [];
  if (shippingCost === 0 || product.shipping?.freeShipping) shippingTags.push('Free shipping');
  else if (shippingCost !== undefined) shippingTags.push(`+${formatPrice(shippingCost)} ship`);
  else if (product.shipping?.twoDay) shippingTags.push('2-day shipping');
  else if (product.shipping?.twoThreeDay) shippingTags.push('2-3 day shipping');
  else if (product.shipping?.speed) shippingTags.push(product.shipping.speed);
  if (shippingDays) shippingTags.push(`${shippingDays} day shipping`);

  const primaryReason = ranked?.reasonsToChoose?.[0];
  const primaryTradeoff = ranked?.uncertaintyFlags?.[0] ?? ranked?.tradeoffs?.[0];

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
        {rank !== undefined && (
          <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center shadow-sm">
            {rank}
          </div>
        )}
        {discount > 0 && (
          <div className="absolute top-3 right-3 bg-red-600 text-white px-2.5 py-1 rounded-full text-xs font-bold shadow-sm">
            {discount}% OFF
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col grow gap-2">
        {/* Retailer + rating — emphasized */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {hasMerchant ? (
              <>
                <MerchantLogo
                  domain={product.sellerDomain}
                  alt={product.sellerName!}
                  size={18}
                  className="rounded-sm shrink-0"
                />
                <span
                  className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate"
                  title={product.sellerName}
                >
                  {product.sellerName}
                </span>
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-[10px] font-medium shrink-0"
                  title="Fulfilled via Shopify"
                >
                  <Image src="/shopify-logo.svg" alt="" width={10} height={10} className="rounded-sm" unoptimized />
                  Shopify
                </span>
              </>
            ) : (
              <>
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
                  {multipleStores ? `${storeCount} stores` : sourceLabel}
                </span>
              </>
            )}
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

        {/* Price — show "from" when the same product is available cheaper elsewhere */}
        <div className="mt-auto pt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            {multipleStores && minPrice !== undefined && minPrice < product.price
              ? `from ${formatPrice(minPrice)}`
              : formatPrice(product.price)}
          </span>
          {discount > 0 && product.originalPrice && (
            <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>

        {/* Landed cost — only when paid shipping is known (free shipping is shown below) */}
        {landedCost !== undefined && shippingCost !== 0 && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {formatPrice(landedCost)} delivered
          </div>
        )}

        {/* Reasons / uncertainty from the ranked contract */}
        {ranked && (primaryReason || primaryTradeoff) && (
          <div className="flex flex-wrap gap-1">
            {primaryReason && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded">
                <TrendingUp size={10} />
                {primaryReason}
              </span>
            )}
            {primaryTradeoff && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                <Info size={10} />
                {primaryTradeoff}
              </span>
            )}
          </div>
        )}

        {/* Shipping — compact single line */}
        {shippingTags.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <Truck size={11} className="shrink-0" />
            <span className="truncate">{shippingTags.slice(0, 2).join(' · ')}</span>
          </div>
        )}

        {/* Alternate offers (cross-retailer comparison) */}
        {multipleStores && (
          <div className="pt-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowOffers((v) => !v);
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showOffers ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              Compare {storeCount} offers
            </button>
            {showOffers && (
              <div className="mt-1.5 space-y-1">
                {offers.map((ro) => {
                  const offer = ro.offer;
                  const info = getRetailerInfo(offer.providerId as UnifiedProduct['source']);
                  const offerLanded =
                    offer.price && offer.fulfillment?.shippingCost?.amount !== undefined
                      ? offer.price.amount + offer.fulfillment.shippingCost.amount
                      : offer.price?.amount;
                  return (
                    <div
                      key={offer.offerId}
                      className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-800/40 rounded px-2 py-1 text-[11px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="flex items-center gap-1 min-w-0">
                        {info.favicon && (
                          <Image src={info.favicon} alt="" width={12} height={12} className="rounded-sm shrink-0" unoptimized />
                        )}
                        <span className="text-gray-700 dark:text-gray-300 truncate">{info.label}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {offerLanded !== undefined ? formatPrice(offerLanded) : 'N/A'}
                        </span>
                        {offer.productUrl && (
                          <a
                            href={offer.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-600 dark:text-blue-400"
                            aria-label={`Open ${info.label} offer`}
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Match confidence */}
        {ranked && ranked.product.identity.confidence !== 'high' && (
          <div className="text-[10px] text-amber-500 dark:text-amber-400">
            {ranked.product.identity.confidence} match across stores
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
