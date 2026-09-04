'use client';

// ── Product result card for intelligent search ────────────────────────
//
// Displays a canonical product with its best offer, alternate offers,
// reasons to choose, tradeoffs, and uncertainty flags.

import { useState } from 'react';
import Image from 'next/image';
import { ChevronDown, ChevronUp, ExternalLink, TrendingUp, Info, AlertTriangle } from 'lucide-react';
import type { RankedProduct, RankedOffer } from '@/search/types';

interface ProductResultCardProps {
  ranked: RankedProduct;
  rank: number;
}

export default function ProductResultCard({ ranked, rank }: ProductResultCardProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);

  const product = ranked.product;
  const bestOffer = ranked.bestOffer;

  const formatPrice = (amount?: number, currency?: string) => {
    if (amount === undefined) return '—';
    return `${currency || '$'}${amount.toFixed(2)}`;
  };

  const sourceLabel = (providerId: string) => {
    const labels: Record<string, string> = {
      walmart: 'Walmart', bestbuy: 'Best Buy', target: 'Target',
      ebay: 'eBay', costco: 'Costco', shopify: 'Shopify',
    };
    return labels[providerId] || providerId;
  };

  const sourceColor = (providerId: string) => {
    const colors: Record<string, string> = {
      walmart: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      bestbuy: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
      target: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
      ebay: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
      costco: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600',
      shopify: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    };
    return colors[providerId] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
  };

  return (
    <div className="bg-white dark:bg-[#242424] rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      <div className="p-4">
        {/* Rank and title */}
        <div className="flex items-start gap-3 mb-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold flex items-center justify-center mt-0.5">
            {rank}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
              {product.title}
            </h3>
            {/* Source badges — show all providers that carry this product */}
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {product.sourceProviders.map(providerId => (
                <span
                  key={providerId}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium border ${sourceColor(providerId)}`}
                >
                  {sourceLabel(providerId)}
                </span>
              ))}
              {product.identity.confidence !== 'high' && (
                <span className="text-xs text-amber-500 dark:text-amber-400" title="Cross-retailer match confidence">
                  ({product.identity.confidence} match)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Best offer summary */}
        {bestOffer && (
          <div className="ml-9 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatPrice(bestOffer.offer.price?.amount, bestOffer.offer.price?.currency)}
                </span>
                {bestOffer.offer.listPrice && bestOffer.offer.listPrice.amount > (bestOffer.offer.price?.amount ?? 0) && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
                    {formatPrice(bestOffer.offer.listPrice.amount)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {bestOffer.offer.condition !== 'unknown' && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {bestOffer.offer.condition.replace('_', ' ')}
                  </span>
                )}
                {bestOffer.offer.availability === 'in_stock' && (
                  <span className="text-xs text-green-600 dark:text-green-400">In stock</span>
                )}
                {bestOffer.offer.fulfillment?.shippingCost !== undefined && (
                  <span className={`text-xs ${bestOffer.offer.fulfillment.shippingCost.amount === 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {bestOffer.offer.fulfillment.shippingCost.amount === 0
                      ? 'Free shipping'
                      : `+$${bestOffer.offer.fulfillment.shippingCost.amount.toFixed(2)} shipping`}
                  </span>
                )}
              </div>
            </div>

            {/* Reasons to choose / tradeoffs */}
            <div className="flex flex-wrap gap-1">
              {ranked.reasonsToChoose.slice(0, 2).map((reason, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded">
                  <TrendingUp size={10} />
                  {reason}
                </span>
              ))}
              {ranked.tradeoffs.slice(0, 1).map((tradeoff, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                  <Info size={10} />
                  {tradeoff}
                </span>
              ))}
            </div>

            {/* External link */}
            {bestOffer.offer.productUrl && (
              <a
                href={bestOffer.offer.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View on {sourceLabel(bestOffer.offer.providerId)} <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}

        {/* Alternate offers toggle */}
        {ranked.alternateOffers.length > 0 && (
          <div className="ml-9 mt-2">
            <button
              onClick={() => setShowAlternatives(!showAlternatives)}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {showAlternatives ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {ranked.alternateOffers.length} alternate offer{ranked.alternateOffers.length > 1 ? 's' : ''}
            </button>

            {showAlternatives && (
              <div className="mt-2 space-y-1.5">
                {ranked.alternateOffers.map((ro) => (
                  <AlternateOfferRow key={ro.offer.offerId} rankedOffer={ro} sourceLabel={sourceLabel} sourceColor={sourceColor} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Uncertainty flags */}
        {ranked.uncertaintyFlags.length > 0 && (
          <div className="ml-9 mt-2 text-xs text-amber-600 dark:text-amber-400">
            {ranked.uncertaintyFlags.slice(0, 2).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact alternate offer row. */
function AlternateOfferRow({
  rankedOffer,
  sourceLabel,
  sourceColor,
}: {
  rankedOffer: RankedOffer;
  sourceLabel: (id: string) => string;
  sourceColor: (id: string) => string;
}) {
  const offer = rankedOffer.offer;

  return (
    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/30 rounded-lg px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium border ${sourceColor(offer.providerId)}`}>
          {sourceLabel(offer.providerId)}
        </span>
        <span className="text-gray-900 dark:text-white font-medium">
          {offer.price ? `${offer.price.currency} ${offer.price.amount.toFixed(2)}` : 'Price N/A'}
        </span>
        {offer.condition !== 'unknown' && (
          <span className="text-gray-400 dark:text-gray-500 capitalize">· {offer.condition.replace('_', ' ')}</span>
        )}
        {offer.availability === 'in_stock' && (
          <span className="text-green-600 dark:text-green-400">· In stock</span>
        )}
        {offer.fulfillment?.shippingCost !== undefined && (
          <span className={offer.fulfillment.shippingCost.amount === 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}>
            · {offer.fulfillment.shippingCost.amount === 0 ? 'Free shipping' : `+$${offer.fulfillment.shippingCost.amount.toFixed(2)} ship`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {offer.productUrl && (
          <a
            href={offer.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 dark:text-blue-400"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
