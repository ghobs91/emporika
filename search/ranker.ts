// ── Deterministic ranking engine ────────────────────────────────────────
//
// Ranks canonical products and their offers using the criteria weights
// from the SearchPlan. Does NOT use LLM for ranking — this is pure
// deterministic code.

import type {
  CanonicalProduct,
  NormalizedOffer,
  RankedOffer,
  RankedProduct,
  SearchPlan,
  ShopperPreferences,
} from './types';

// ── Scoring helpers ────────────────────────────────────────────────────

type CriterionScore = {
  criterion: string;
  rawValue?: number | string | boolean;
  weightedContribution: number;
  reason: string;
};

/**
 * Score a single offer against the ranking criteria.
 */
function scoreOffer(
  offer: NormalizedOffer,
  plan: SearchPlan,
  preferences?: ShopperPreferences
): { score: number; breakdown: CriterionScore[] } {
  const breakdown: CriterionScore[] = [];
  let totalScore = 0;

  for (const { criterion, weight } of plan.ranking) {
    let raw: number = 0;
    let reason = '';

    switch (criterion) {
      case 'price': {
        if (offer.price) {
          // Landed cost = item price + cheapest known shipping. Bounded
          // inverse curve (no cliff at $1000 like a linear scale has):
          // $50 → 0.80, $200 → 0.50, $1000 → 0.17, $5000 → 0.04.
          const shipping = offer.fulfillment?.shippingCost?.amount ?? 0;
          const landed = offer.price.amount + shipping;
          const normalized = 1 / (1 + landed / 200);
          raw = normalized;
          reason =
            shipping > 0
              ? `Landed ${offer.price.currency} ${landed.toFixed(2)} (incl. ${shipping.toFixed(2)} shipping)`
              : `Listed price: ${offer.price.currency} ${offer.price.amount.toFixed(2)}`;
        } else {
          // Missing price: penalize
          raw = -0.5;
          reason = 'Price not available';
        }
        break;
      }

      case 'featureMatch': {
        // Check how many required features match
        const features = plan.hardFilters.requiredFeatures || [];
        const preferences_ = preferences?.priorities || [];
        const allFeatures = [...features, ...preferences_];
        if (allFeatures.length > 0) {
          const searchText = `${offer.title} ${offer.evidence.fieldsProvided.join(' ')}`.toLowerCase();
          const matched = allFeatures.filter(f => searchText.includes(f.toLowerCase())).length;
          raw = matched / allFeatures.length;
          reason = `Matched ${matched}/${allFeatures.length} requested features`;
        } else {
          raw = 1;
          reason = 'No specific features requested';
        }
        break;
      }

      case 'availability': {
        if (offer.availability === 'in_stock') {
          raw = 1;
          reason = 'Verified in stock';
        } else if (offer.availability === 'limited') {
          raw = 0.7;
          reason = 'Limited availability';
        } else if (offer.availability === 'out_of_stock') {
          raw = 0;
          reason = 'Out of stock';
        } else {
          raw = 0.3;
          reason = 'Availability not verified';
        }
        break;
      }

      case 'shipping': {
        if (offer.fulfillment?.shippingSupported) {
          raw = 1;
          reason = 'Shipping supported';
          // Bonus for shipping estimate
          if (offer.fulfillment.shippingEstimate) {
            raw = 1.1;
            reason = `Shipping supported (${offer.fulfillment.shippingEstimate})`;
          }
        } else if (offer.fulfillment?.shippingSupported === false) {
          raw = 0;
          reason = 'No shipping available';
        } else {
          raw = 0.3;
          reason = 'Shipping information not provided';
        }
        break;
      }

      case 'pickup': {
        if (offer.fulfillment?.pickupSupported) {
          raw = 1;
          reason = 'In-store pickup available';
        } else {
          raw = 0.3;
          reason = 'Pickup information not provided';
        }
        break;
      }

      case 'seller': {
        if (offer.seller) {
          if (offer.seller.type === 'retailer') {
            raw = 0.9;
            reason = `Direct retailer: ${offer.seller.name || 'Unknown'}`;
          } else if (offer.seller.type === 'marketplace_seller') {
            // Marketplace seller: score based on rating
            raw = offer.seller.rating ? offer.seller.rating / 100 : 0.5;
            reason = `Marketplace seller: ${offer.seller.name || 'Unknown'} (${offer.seller.rating || 'no'} rating)`;
          } else {
            raw = 0.5;
            reason = `Seller: ${offer.seller.name || 'Unknown'}`;
          }
        } else {
          raw = 0.2;
          reason = 'Seller information not available';
        }
        break;
      }

      case 'retailer': {
        // Score based on retailer preference
        const preferredProviders = preferences?.includedProviders;
        if (preferredProviders?.length) {
          raw = preferredProviders.includes(offer.providerId) ? 1 : 0.3;
          reason = `Retailer: ${offer.providerId}${preferredProviders.includes(offer.providerId) ? ' (preferred)' : ''}`;
        } else {
          raw = 0.7;
          reason = `Retailer: ${offer.providerId}`;
        }
        break;
      }

      case 'brandPreference': {
        const preferredBrands = plan.hardFilters.preferredBrands || preferences?.preferredBrands;
        const excludedBrands = plan.hardFilters.excludedBrands || preferences?.excludedBrands;

        if (excludedBrands?.length && offer.evidence.fieldsProvided.includes('seller')) {
          const sellerName = offer.seller?.name?.toLowerCase() || '';
          if (excludedBrands.some(b => sellerName.includes(b.toLowerCase()))) {
            raw = 0;
            reason = 'Brand is excluded';
            break;
          }
        }

        if (preferredBrands?.length) {
          const sellerName = offer.seller?.name?.toLowerCase() || '';
          const titleLower = offer.title.toLowerCase();
          if (preferredBrands.some(b => sellerName.includes(b.toLowerCase()) || titleLower.includes(b.toLowerCase()))) {
            raw = 1;
            reason = 'Preferred brand matched';
          } else {
            raw = 0.4;
            reason = 'Not a preferred brand';
          }
        } else {
          raw = 0.5;
          reason = 'No brand preference specified';
        }
        break;
      }

      case 'variantFit': {
        if (offer.comparableVariant?.comparability === 'equivalent') {
          raw = 1;
          reason = 'Variant matches request';
        } else if (offer.comparableVariant?.comparability === 'different_variant') {
          raw = 0.3;
          reason = 'Different variant than requested';
        } else {
          raw = 0.7;
          reason = 'Variant compatibility unknown';
        }
        break;
      }

      case 'condition': {
        if (offer.condition === 'new') {
          raw = 1;
          reason = 'New condition';
        } else if (offer.condition === 'refurbished') {
          raw = 0.7;
          reason = 'Refurbished';
        } else if (offer.condition === 'open_box') {
          raw = 0.6;
          reason = 'Open box';
        } else if (offer.condition === 'used') {
          raw = 0.4;
          reason = 'Used';
        } else {
          raw = 0.3;
          reason = 'Condition unknown';
        }

        // If user explicitly wants used/refurbished, invert scoring
        if (preferences?.allowedConditions?.includes('used') && !preferences.allowedConditions.includes('new')) {
          if (offer.condition === 'used') raw = 1;
          if (offer.condition === 'new') raw = 0.5;
        }
        break;
      }

      case 'preferenceFit': {
        // General preference fit: how well does this offer match stated priorities
        if (preferences?.priorities?.length) {
          const searchText = `${offer.title} ${offer.evidence.fieldsProvided.join(' ')}`.toLowerCase();
          const matches = preferences.priorities.filter(p => searchText.includes(p.toLowerCase())).length;
          raw = matches / preferences.priorities.length;
          reason = `Matched ${matches}/${preferences.priorities.length} user priorities`;
        } else {
          raw = 0.7;
          reason = 'No user priorities specified';
        }
        break;
      }
    }

    const contribution = raw * weight;
    totalScore += contribution;

    breakdown.push({
      criterion,
      rawValue: raw,
      weightedContribution: contribution,
      reason,
    });
  }

  return { score: totalScore, breakdown };
}

// ── Product scoring ────────────────────────────────────────────────────

function scoreProduct(
  product: CanonicalProduct,
  plan: SearchPlan,
  preferences?: ShopperPreferences
): { productScore: number; breakdown: CriterionScore[]; bestOffer?: RankedOffer; alternates: RankedOffer[] } {
  // Score each offer
  const scoredOffers: RankedOffer[] = product.offers.map(offer => {
    const { score, breakdown } = scoreOffer(offer, plan, preferences);

    const reasons: string[] = [];
    const tradeoffs: string[] = [];

    // Generate reasons
    if (offer.price && score > 0.4) {
      reasons.push(`Competitively priced at ${offer.price.currency} ${offer.price.amount.toFixed(2)}`);
    }
    if (offer.availability === 'in_stock') {
      reasons.push('Available and in stock');
    }
    if (offer.condition === 'new') {
      reasons.push('Brand new condition');
    }

    // Generate tradeoffs
    if (!offer.price) tradeoffs.push('Price not available');
    if (offer.availability === 'unknown') tradeoffs.push('Availability not verified');
    if (offer.condition === 'used') tradeoffs.push('Used condition');
    if (offer.seller?.type === 'marketplace_seller') tradeoffs.push('Sold by marketplace seller');

    return {
      offer,
      offerScore: score,
      scoreBreakdown: breakdown,
      reasonsToChoose: reasons,
      tradeoffs,
      uncertaintyFlags: offer.uncertaintyFlags,
    };
  });

  // Sort offers by score descending
  scoredOffers.sort((a, b) => b.offerScore - a.offerScore);

  // Product score = best offer score, with some product-level adjustments
  const bestOffer = scoredOffers[0];
  const productScore = bestOffer ? bestOffer.offerScore : 0;

  // Product-level score breakdown mirrors the best offer plus coverage
  const productBreakdown = bestOffer
    ? (bestOffer.scoreBreakdown ?? []).map(b => ({ ...b }))
    : [];

  // Add source coverage as a bonus
  const coverageScore = Math.min(1, product.sourceProviders.length / 6);
  productBreakdown.push({
    criterion: 'sourceCoverage',
    rawValue: product.sourceProviders.length,
    weightedContribution: coverageScore * 0.02,
    reason: `Found at ${product.sourceProviders.length} of 6 sources`,
  });

  return {
    productScore: productScore + coverageScore * 0.02,
    breakdown: productBreakdown,
    bestOffer,
    alternates: scoredOffers.slice(1),
  };
}

// ── Main ranking function ──────────────────────────────────────────────

export function rankProducts(
  products: CanonicalProduct[],
  plan: SearchPlan,
  preferences?: ShopperPreferences
): RankedProduct[] {
  const scored = products.map(product => {
    const { productScore, breakdown, bestOffer, alternates } = scoreProduct(product, plan, preferences);

    // Product-level reasons and tradeoffs
    const reasonsToChoose: string[] = [];
    const tradeoffs: string[] = [];
    const uncertaintyFlags: string[] = [];

    if (bestOffer) {
      reasonsToChoose.push(...bestOffer.reasonsToChoose.slice(0, 2));
      tradeoffs.push(...bestOffer.tradeoffs.slice(0, 2));
    }

    if (product.offers.length > 1) {
      reasonsToChoose.push(`${product.offers.length} offers to compare`);
    }

    if (product.sourceProviders.length > 1) {
      reasonsToChoose.push(`Available at ${product.sourceProviders.length} retailers`);
    } else {
      tradeoffs.push(`Only found at ${product.sourceProviders[0] || 'one retailer'}`);
    }

    if (product.warnings.length > 0) {
      uncertaintyFlags.push(...product.warnings);
    }

    return {
      product,
      rank: 0, // Set after sorting
      productScore,
      bestOffer,
      alternateOffers: alternates,
      scoreBreakdown: breakdown,
      reasonsToChoose,
      tradeoffs,
      uncertaintyFlags,
    };
  });

  // Sort by product score descending
  scored.sort((a, b) => b.productScore - a.productScore);

  // Assign ranks with stable tie-breaking
  scored.forEach((item, index) => {
    item.rank = index + 1;
  });

  return scored;
}

// ── Wire serialization ──────────────────────────────────────────────────

/**
 * Strip per-criterion score breakdowns before sending results to clients.
 *
 * The breakdowns are useful for debugging and explanation UIs, but they can
 * double the payload size for large result sets (each offer carries ~8
 * criterion entries). No client consumes them, so they are omitted from API
 * responses. The ranker itself still produces them internally.
 */
export function toWireResults(ranked: RankedProduct[]): RankedProduct[] {
  return ranked.map(r => ({
    ...r,
    scoreBreakdown: undefined,
    bestOffer: r.bestOffer
      ? { ...r.bestOffer, scoreBreakdown: undefined }
      : undefined,
    alternateOffers: r.alternateOffers.map(o => ({
      ...o,
      scoreBreakdown: undefined,
    })),
  }));
}
