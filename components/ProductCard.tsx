'use client';

import Link from 'next/link';
import { UnifiedProduct } from '@/types/unified';
import type { RankedProduct } from '@/search/types';
import { Star, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import MerchantLogo from '@/components/MerchantLogo';
import { getRetailerInfo, decodeHtmlEntities, retailerExploreHref, merchantExploreHref } from '@/lib/retailer';

interface ProductCardProps {
  product: UnifiedProduct;
  /** 1-based rank, shown as a subtle label when the result is from ranked search. */
  rank?: number;
  /** Full ranked contract (best offer, alternates) when available. */
  ranked?: RankedProduct;
  onClick?: () => void;
}

const STAR_SLOTS = [1, 2, 3, 4, 5];

/**
 * Five star glyphs filled to the rounded rating, plus the review count.
 * The numeric rating stays in the accessible label so screen readers get
 * the exact value while the card stays visually quiet.
 */
function RatingRow({ rating, count }: { rating?: number; count?: number }) {
  if (rating == null) return null;
  const filled = Math.round(rating);
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Rated ${rating.toFixed(1)} out of 5${
        count ? ` from ${count.toLocaleString()} reviews` : ''
      }`}
    >
      <span className="flex items-center gap-[1px]" aria-hidden="true">
        {STAR_SLOTS.map((slot) => (
          <Star
            key={slot}
            size={11}
            strokeWidth={0}
            className={slot <= filled ? 'fill-amber-400' : 'fill-gray-200 dark:fill-gray-600'}
          />
        ))}
      </span>
      {count != null && count > 0 && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500" aria-hidden="true">
          ({count.toLocaleString()})
        </span>
      )}
    </div>
  );
}

export default function ProductCard({ product, rank, ranked, onClick }: ProductCardProps) {
  const formatPrice = (price: number | null | undefined) =>
    typeof price === 'number' && Number.isFinite(price) ? `$${price.toFixed(2)}` : '—';

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

  // ── Cross-retailer price context ──────────────────────────────────────
  const offers = ranked
    ? [ranked.bestOffer, ...ranked.alternateOffers].filter(
        (offer): offer is NonNullable<typeof offer> => Boolean(offer)
      )
    : [];
  const storeCount = new Set(offers.map((offer) => offer.offer.providerId)).size;
  const priceValues = offers
    .map((offer) => offer.offer.price?.amount)
    .filter((amount): amount is number => amount !== undefined);
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : undefined;
  const multipleStores = storeCount > 1;

  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="group flex min-w-0 cursor-pointer flex-col"
      onClick={onClick}
    >
      {/* Image plate — square, neutral ground, generous padding */}
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-gray-100 dark:bg-[#333333]">
        {product.image && (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain p-5 transition-transform duration-300 group-hover:scale-[1.04]"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
            quality={85}
            unoptimized
          />
        )}

        {/* Discount / savings badge, top-left */}
        {discount > 0 && (
          <div className="absolute left-2.5 top-2.5 rounded-lg bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {discount}% off
          </div>
        )}

        {/* Rank is positional, so it stays small and secondary */}
        {rank !== undefined && (
          <div
            className="absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-600 dark:bg-black/70 dark:text-gray-200"
            aria-label={`Rank ${rank}`}
          >
            #{rank}
          </div>
        )}

        {/* External link — revealed on hover/focus to keep the plate clean */}
        <a
          href={product.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleExternalLinkClick}
          className="absolute right-2.5 top-2.5 rounded-full bg-white/90 p-1.5 text-gray-600 opacity-0 shadow-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 dark:bg-black/70 dark:text-gray-200 dark:hover:bg-black/90"
          aria-label={`Open ${displayTitle} at ${sourceLabel}`}
        >
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Caption — merchant, title, rating, price. Nothing else. */}
      <div className="flex min-w-0 flex-col gap-1 px-0.5 pt-2.5">
        <div className="flex min-w-0 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          {hasMerchant ? (
            <Link
              href={merchantExploreHref(product.sellerName!, product.sellerDomain)}
              onClick={handleExternalLinkClick}
              className="flex min-w-0 items-center gap-1 hover:underline"
              title={`Explore ${product.sellerName}`}
            >
              <MerchantLogo
                domain={product.sellerDomain}
                alt={product.sellerName!}
                size={13}
                className="rounded-sm shrink-0"
              />
              <span className="truncate">{product.sellerName}</span>
            </Link>
          ) : (
            <Link
              href={retailerExploreHref(product.source)}
              onClick={handleExternalLinkClick}
              className="flex min-w-0 items-center gap-1 hover:underline"
              title={`Explore ${sourceLabel}`}
            >
              {sourceFavicon && (
                <Image
                  src={sourceFavicon}
                  alt=""
                  width={13}
                  height={13}
                  className="rounded-sm shrink-0"
                  unoptimized
                />
              )}
              <span className="truncate">{sourceLabel}</span>
            </Link>
          )}
          {multipleStores && (
            <span className="shrink-0 text-gray-400 dark:text-gray-500">
              · {storeCount} stores
            </span>
          )}
        </div>

        <h3 className="min-w-0 text-[13px] leading-snug text-gray-900 dark:text-gray-50">
          {/* The title is the keyboard entry point into the detail view. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClick?.();
            }}
            className="line-clamp-2 w-full text-left [overflow-wrap:anywhere] hover:underline focus-visible:underline"
          >
            {decodeHtmlEntities(displayTitle)}
          </button>
        </h3>

        <RatingRow rating={product.customerRating} count={product.reviewCount} />

        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-gray-900 dark:text-white">
            {multipleStores && minPrice !== undefined && minPrice < product.price
              ? `from ${formatPrice(minPrice)}`
              : formatPrice(product.price)}
          </span>
          {discount > 0 && product.originalPrice && (
            <span className="text-[12px] text-gray-400 line-through dark:text-gray-500">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
