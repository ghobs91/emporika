// ── Deterministic fallback planner ──────────────────────────────────────
//
// Used when WebLLM is unavailable or its output fails validation.
// Produces a SearchPlan from a raw query string using simple heuristics.

import type { SearchPlan, ProviderId } from './types';

/**
 * Parse a natural-language query into a SearchPlan without any LLM.
 * Uses keyword heuristics to extract price limits, brands, conditions,
 * and to generate reasonable search queries.
 */
export function createFallbackPlan(
  query: string,
  availableProviders: ProviderId[],
  preferences?: {
    budget?: { max?: number; min?: number; currency?: string };
    excludedBrands?: string[];
    preferredBrands?: string[];
    excludedProviders?: ProviderId[];
    allowedConditions?: Array<'new' | 'used' | 'refurbished' | 'open_box'>;
  }
): SearchPlan {
  const lowerQuery = query.toLowerCase();

  // ── Extract price hints from the query ──────────────────────────────

  let maxPrice: number | undefined;
  let minPrice: number | undefined;

  // "under $150", "under 150 dollars", "less than $200"
  const underMatch = lowerQuery.match(/(?:under|less than|below|max|up to)\s*\$?(\d+(?:\.\d{2})?)/);
  if (underMatch) {
    maxPrice = parseFloat(underMatch[1]);
  }

  // "over $50", "above $20", "at least $30", "min $25"
  const overMatch = lowerQuery.match(/(?:over|above|at least|min|minimum)\s*\$?(\d+(?:\.\d{2})?)/);
  if (overMatch) {
    minPrice = parseFloat(overMatch[1]);
  }

  // "$50-$100"
  const rangeMatch = lowerQuery.match(/\$(\d+(?:\.\d{2})?)\s*[-–—to]+\s*\$?(\d+(?:\.\d{2})?)/);
  if (rangeMatch) {
    minPrice = parseFloat(rangeMatch[1]);
    maxPrice = parseFloat(rangeMatch[2]);
  }

  // ── Detect condition preferences ─────────────────────────────────────

  const allowedConditions: Array<'new' | 'used' | 'refurbished' | 'open_box'> = [];
  if (lowerQuery.includes('used') || lowerQuery.includes('pre-owned') || lowerQuery.includes('second' + 'hand')) {
    allowedConditions.push('used');
  }
  if (lowerQuery.includes('refurbished') || lowerQuery.includes('renewed')) {
    allowedConditions.push('refurbished');
  }
  if (lowerQuery.includes('open box')) {
    allowedConditions.push('open_box');
  }
  // Default: include 'new' unless explicitly asking only for used
  if (allowedConditions.length === 0 || !lowerQuery.includes('only used')) {
    allowedConditions.push('new');
  }

  // ── Detect feature / size hints ─────────────────────────────────────

  const requiredFeatures: string[] = [];
  const featureHints = [
    'waterproof', 'bluetooth', 'wireless', 'rechargeable', 'portable',
    'stainless steel', 'organic', 'gluten-free', 'vegan',
    'trail', 'running', 'hiking',
    '4k', '1080p', 'hdr', 'oled', 'qled',
  ];
  for (const feature of featureHints) {
    if (lowerQuery.includes(feature)) {
      requiredFeatures.push(feature);
    }
  }

  // ── Generate search queries ──────────────────────────────────────────

  // Clean up the query for search
  const searchTerms = query
    .replace(/\b(under|less than|below|max|up to)\s*\$?\d+/gi, '')
    .replace(/\b(over|above|at least|min|minimum)\s*\$?\d+/gi, '')
    .replace(/\$\d+(?:\.\d{2})?\s*[-–—to]+\s*\$?\d+(?:\.\d{2})?/gi, '')
    .replace(/\b(cheap|affordable|best|top|good|great|excellent|quality)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const searches: SearchPlan['searches'] = [
    { query: searchTerms || query, purpose: 'broad' },
  ];

  // Add a feature-focused search if we detected features
  if (requiredFeatures.length > 0) {
    searches.push({
      query: `${requiredFeatures.join(' ')} ${searchTerms || query}`,
      purpose: 'feature',
    });
  }

  // ── Build ranking criteria ───────────────────────────────────────────

  const ranking: SearchPlan['ranking'] = [
    { criterion: 'price', weight: 0.20 },
    { criterion: 'featureMatch', weight: 0.25 },
    { criterion: 'availability', weight: 0.15 },
    { criterion: 'shipping', weight: 0.10 },
    { criterion: 'condition', weight: 0.15 },
    { criterion: 'seller', weight: 0.10 },
    { criterion: 'brandPreference', weight: 0.05 },
  ];

  // If user explicitly asked for brands, upweight brand preference
  if (preferences?.preferredBrands?.length || preferences?.excludedBrands?.length) {
    ranking.forEach(r => {
      if (r.criterion === 'brandPreference') r.weight = 0.15;
      if (r.criterion === 'price') r.weight -= 0.05;
      if (r.criterion === 'featureMatch') r.weight -= 0.05;
    });
  }

  // ── Determine eligible providers ─────────────────────────────────────

  const excludedProviders = preferences?.excludedProviders || [];

  return {
    version: '1',
    canonicalIntent: query,
    searches: searches.slice(0, 5),
    sourceStrategy: {
      preferredProviders: availableProviders.filter(p => !excludedProviders.includes(p)),
      excludedProviders,
      searchMode: 'all_eligible',
    },
    hardFilters: {
      maxPrice: maxPrice ?? preferences?.budget?.max,
      minPrice: minPrice ?? preferences?.budget?.min,
      currency: preferences?.budget?.currency || 'USD',
      requiredFeatures: requiredFeatures.length > 0 ? requiredFeatures : undefined,
      excludedBrands: preferences?.excludedBrands,
      preferredBrands: preferences?.preferredBrands,
      allowedConditions: allowedConditions.length > 0 ? allowedConditions : undefined,
      availabilityRequired: true,
    },
    ranking,
    confidence: 0.7, // Fallback planner is reasonably confident but not perfect
  };
}
