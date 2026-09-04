// ── Deterministic fallback planner ──────────────────────────────────────
//
// Used when WebLLM is unavailable or its output fails validation.
// Produces a SearchPlan from a raw query string using simple heuristics.

import type { SearchPlan, ProviderId, ShopperPreferences } from './types';

// ── Vocabulary tables (deterministic, no model needed) ─────────────────

/** Common e-commerce misspellings → correction (token-level, lowercase). */
const TYPO_CORRECTIONS: Record<string, string> = {
  iphnoe: 'iphone', ipone: 'iphone', phnoe: 'phone', pone: 'phone',
  labtop: 'laptop', laptpo: 'laptop', labtops: 'laptops',
  headphoens: 'headphones', headpones: 'headphones', hedphones: 'headphones',
  speakr: 'speaker', speeker: 'speaker', chargr: 'charger', chargre: 'charger',
  keybord: 'keyboard', keybaord: 'keyboard', moues: 'mouse', mosue: 'mouse',
  moniter: 'monitor', montior: 'monitor', camrea: 'camera', camara: 'camera',
  wacth: 'watch', watche: 'watch', tablett: 'tablet', tabel: 'table',
  sneekers: 'sneakers', runing: 'running', shose: 'shoes', shoos: 'shoes',
  jaket: 'jacket', jeket: 'jacket', shrit: 'shirt', sirt: 'shirt',
  pantes: 'pants', pents: 'pants', dres: 'dress', drss: 'dress',
  chiar: 'chair', chari: 'chair', sopha: 'sofa', soffa: 'sofa',
  lampe: 'lamp', lmap: 'lamp', bik: 'bike', byke: 'bike',
  gril: 'grill', blander: 'blender', bleneder: 'blender',
  tenet: 'tent', micowave: 'microwave', refridgerator: 'refrigerator',
};

/** Synonym groups — first match produces one 'alternative' variant. */
const SYNONYM_GROUPS: string[][] = [
  ['sneakers', 'trainers', 'running shoes'],
  ['tv', 'television'],
  ['laptop', 'notebook'],
  ['headphones', 'headset'],
  ['earbuds', 'earphones'],
  ['sofa', 'couch'],
  ['cell phone', 'mobile phone'],
  ['sweater', 'jumper', 'pullover'],
  ['purse', 'handbag'],
  ['sunglasses', 'shades'],
];

/** Extra feature tokens beyond the base list (colors, materials). */
const EXTENDED_FEATURE_HINTS = [
  'black', 'white', 'red', 'blue', 'green', 'gray', 'grey', 'silver',
  'gold', 'pink', 'purple', 'brown', 'beige', 'navy', 'natural',
  'leather', 'cotton', 'wood', 'wooden', 'silk', 'wool', 'denim',
  'plastic', 'glass', 'metal', 'ceramic', 'cast iron', 'memory foam',
];

/** Well-known brands detected for brand-scoped variants + preferences. */
const KNOWN_BRANDS = [
  'apple', 'samsung', 'sony', 'lg', 'dell', 'hp', 'lenovo', 'asus', 'acer',
  'microsoft', 'google', 'pixel', 'nike', 'adidas', 'puma', 'reebok',
  'new balance', 'skechers', 'vans', 'converse', 'under armour', 'levis',
  "levi's", 'uniqlo', 'dyson', 'shark', 'bissell', 'keurig', 'ninja',
  'nutribullet', 'kitchenaid', 'cuisinart', 'lego', 'mattel', 'hasbro',
  'fisher-price', 'nerf', 'bose', 'jbl', 'beats', 'sennheiser', 'logitech',
  'razer', 'corsair', 'canon', 'nikon', 'gopro', 'fitbit', 'garmin',
  'fossil', 'casio', 'timex', 'ikea', 'toyota', 'honda', 'ford', 'tesla',
  'maybelline', "l'oreal", 'clarks', 'salomon', 'patagonia', 'north face',
  'columbia', 'coach', 'michael kors',
];

const APPAREL_KEYWORDS = [
  'shirt', 't-shirt', 'jacket', 'dress', 'pants', 'hoodie', 'sweater',
  'coat', 'shorts', 'skirt', 'blouse', 'polo', 'jeans', 'suit', 'vest',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Token-level typo correction. Returns the corrected text and whether
 * anything changed (used to trim planner confidence).
 */
function correctTypos(query: string): { text: string; corrected: boolean } {
  let corrected = false;
  const text = query
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      const lower = part.toLowerCase().replace(/[.,!?;:()"']+$/g, '');
      const fix = TYPO_CORRECTIONS[lower];
      if (fix) {
        corrected = true;
        return part.replace(new RegExp(escapeRegExp(lower) + '$', 'i'), fix);
      }
      return part;
    })
    .join('');
  return { text, corrected };
}

/**
 * Find one synonym alternative: first group with a member present in the
 * query produces a variant with that member swapped for another.
 */
function synonymAlternative(query: string): string | undefined {
  const lower = query.toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    for (const member of group) {
      const pattern = new RegExp(`\\b${escapeRegExp(member)}\\b`, 'i');
      if (pattern.test(lower)) {
        const replacement = group.find((m) => m !== member) ?? member;
        if (replacement !== member) {
          return query.replace(pattern, replacement);
        }
      }
    }
  }
  return undefined;
}

interface SizeExtraction {
  features: string[];
  strip: string[];
}

/** Extract size / pack / dimension signals into feature tokens. */
function extractSizes(query: string): SizeExtraction {
  const features: string[] = [];
  const strip: string[] = [];
  const lower = query.toLowerCase();

  const take = (match: RegExpMatchArray | null, feature: (m: RegExpMatchArray) => string) => {
    if (match?.[0]) {
      features.push(feature(match));
      strip.push(match[0]);
    }
  };

  // Shoe sizes: "mens size 10", "size 10", "size men 11", "womens 9".
  // Gender-first patterns come first so "mens size 10" keeps its context.
  take(
    lower.match(/\b(men'?s|women'?s|kid'?s)\s*size\s*(\d+(?:\.\d+)?)\b/) ||
      lower.match(/\bsize\s*(men'?s|women'?s|kid'?s|youth)?\s*(\d+(?:\.\d+)?)\b/) ||
      lower.match(/\b(men'?s|women'?s|kid'?s)\s*(\d+(?:\.\d+)?)\b/),
    (m) => {
      const who = m[1] ? `${m[1].replace(/'?s$/, '')} ` : '';
      return `${who}size ${m[2]}`;
    }
  );

  // Clothing sizes: "size XL" always; bare S/M/L only with apparel context
  const sizeLetter = lower.match(/\bsize\s*(xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|onesize|one size|plus size|petite|tall)\b/);
  if (sizeLetter?.[1]) {
    take(sizeLetter, (m) => `size ${m[1].toUpperCase()}`);
  } else {
    const bare =
      lower.match(/\b(xxxs|xxs|xs|xl|xxl|xxxl|[2-5]xl)\b/) ||
      (APPAREL_KEYWORDS.some((k) => lower.includes(k)) ? lower.match(/\b(s|m|l)\b/) : null);
    if (bare?.[0]) take(bare, (m) => `size ${m[0].toUpperCase()}`);
  }

  // Screen sizes: '55 inch', '55-inch', '55"'
  take(lower.match(/\b(\d{2,3})\s*(?:-|‐)?\s*(?:inch|inches|in\b|")/), (m) => `${m[1]} inch`);

  // Packs: "pack of 12", "2-pack", "3 pack"
  take(lower.match(/\bpack of (\d+)\b/) || lower.match(/\b(\d+)\s*[- ]pack\b/), (m) => {
    const n = m[1] ?? m[2];
    return `pack of ${n}`;
  });

  return { features, strip };
}

interface CompatExtraction {
  features: string[];
  strip: string[];
}

/** Extract "for / fits / compatible with X" device-compatibility signals. */
function extractCompatibility(query: string): CompatExtraction {
  const features: string[] = [];
  const strip: string[] = [];
  const match = query.match(/(?:\bfor\b|\bfits\b|compatible with|works with)\s+([a-z0-9][a-z0-9 .\-+]{1,36})/i);
  if (match?.[1]) {
    const model = match[1]
      .split(/\s+(?:under|over|less than|above|at least|cheap|best|with|and|in)\b/i)[0]
      .replace(/[.,!?;:]+$/g, '')
      .trim();
    if (model.length >= 2) {
      features.push(model.toLowerCase());
      strip.push(match[0]);
    }
  }
  return { features, strip };
}

/** Detect known brands mentioned in the query. */
function detectBrands(query: string): string[] {
  const lower = ` ${query.toLowerCase()} `;
  const found: string[] = [];
  for (const brand of KNOWN_BRANDS) {
    const pattern = new RegExp(`\\b${escapeRegExp(brand)}\\b`);
    if (pattern.test(lower) && !found.includes(brand)) {
      found.push(brand);
    }
  }
  return found;
}

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
    includedProviders?: ProviderId[];
    excludedProviders?: ProviderId[];
    allowedConditions?: Array<'new' | 'used' | 'refurbished' | 'open_box'>;
  }
): SearchPlan {
  const { text: correctedQuery, corrected: typoCorrected } = correctTypos(query);
  const lowerQuery = correctedQuery.toLowerCase();

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

  // ── Detect feature / size / compatibility hints ─────────────────────

  const requiredFeatures: string[] = [];
  const featureHints = [
    'waterproof', 'bluetooth', 'wireless', 'rechargeable', 'portable',
    'stainless steel', 'organic', 'gluten-free', 'vegan',
    'trail', 'running', 'hiking',
    '4k', '1080p', 'hdr', 'oled', 'qled',
    ...EXTENDED_FEATURE_HINTS,
  ];
  for (const feature of featureHints) {
    if (lowerQuery.includes(feature)) {
      requiredFeatures.push(feature);
    }
  }

  // Structured signals: sizes ("size 10", "55 inch", "pack of 12") and
  // device compatibility ("for iPhone 15") become feature tokens.
  const sizes = extractSizes(correctedQuery);
  const compat = extractCompatibility(correctedQuery);
  for (const f of [...sizes.features, ...compat.features]) {
    if (!requiredFeatures.includes(f)) {
      requiredFeatures.push(f);
    }
  }

  // Known brands mentioned in the query join user-selected preferences.
  const detectedBrands = detectBrands(correctedQuery);
  const preferredBrands = [...(preferences?.preferredBrands ?? [])];
  for (const b of detectedBrands) {
    if (!preferredBrands.some((p) => p.toLowerCase() === b)) {
      preferredBrands.push(b);
    }
  }

  // ── Generate search queries ──────────────────────────────────────────

  // Clean up the query for search. Extracted size/compatibility phrases
  // move to the feature variant (retailers match them poorly as keywords).
  let searchTerms = correctedQuery
    .replace(/\b(under|less than|below|max|up to)\s*\$?\d+/gi, '')
    .replace(/\b(over|above|at least|min|minimum)\s*\$?\d+/gi, '')
    .replace(/\$\d+(?:\.\d{2})?\s*[-–—to]+\s*\$?\d+(?:\.\d{2})?/gi, '')
    .replace(/\b(cheap|affordable|best|top|good|great|excellent|quality)\b/gi, '');
  for (const phrase of [...sizes.strip, ...compat.strip]) {
    searchTerms = searchTerms.replace(new RegExp(escapeRegExp(phrase), 'gi'), '');
  }
  searchTerms = searchTerms.replace(/\s{2,}/g, ' ').trim();

  const fallbackTerms = searchTerms || correctedQuery || query;
  const searches: SearchPlan['searches'] = [
    { query: fallbackTerms, purpose: 'broad' },
  ];

  // Add a feature-focused search for detected features not already in the
  // query (prepending a present term only duplicates it: "ceramic ceramic…").
  const missingFeatures = requiredFeatures
    .slice(0, 3)
    .filter((f) => !fallbackTerms.toLowerCase().includes(f.toLowerCase()));
  if (missingFeatures.length > 0) {
    searches.push({
      query: `${missingFeatures.join(' ')} ${fallbackTerms}`,
      purpose: 'feature',
    });
  }

  // Add a synonym alternative ("tv" → "television") for recall.
  // (No brand variant: the broad query already contains the brand, so
  // prepending it again would only duplicate terms. Brand scoping flows
  // through preferredBrands into provider filters and ranking instead.)
  const synonymAlt = synonymAlternative(fallbackTerms);
  if (synonymAlt && synonymAlt.toLowerCase() !== fallbackTerms.toLowerCase()) {
    searches.push({ query: synonymAlt, purpose: 'alternative' });
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

  // If brands are in play (mentioned or preferred), upweight brand preference
  if (preferredBrands.length > 0 || preferences?.excludedBrands?.length) {
    ranking.forEach(r => {
      if (r.criterion === 'brandPreference') r.weight = 0.15;
      if (r.criterion === 'price') r.weight -= 0.05;
      if (r.criterion === 'featureMatch') r.weight -= 0.05;
    });
  }

  // ── Determine eligible providers ─────────────────────────────────────

  const excludedProviders = preferences?.excludedProviders || [];
  const includedProviders = preferences?.includedProviders;

  return {
    version: '1',
    canonicalIntent: query,
    searches: searches.slice(0, 5),
    sourceStrategy: {
      // When the user has explicitly selected retailers, only those are
      // eligible; otherwise everything except explicitly excluded ones.
      preferredProviders: availableProviders.filter(p =>
        includedProviders?.length
          ? includedProviders.includes(p)
          : !excludedProviders.includes(p)
      ),
      excludedProviders,
      searchMode: 'all_eligible',
    },
    hardFilters: {
      maxPrice: maxPrice ?? preferences?.budget?.max,
      minPrice: minPrice ?? preferences?.budget?.min,
      currency: preferences?.budget?.currency || 'USD',
      requiredFeatures: requiredFeatures.length > 0 ? requiredFeatures : undefined,
      excludedBrands: preferences?.excludedBrands,
      preferredBrands: preferredBrands.length > 0 ? preferredBrands : undefined,
      allowedConditions: allowedConditions.length > 0 ? allowedConditions : undefined,
      availabilityRequired: true,
    },
    ranking,
    confidence: Math.max(0.5, 0.7 - (typoCorrected ? 0.05 : 0)),
  };
}

/**
 * Resolve the final list of providers to search for a plan.
 *
 * Hard constraints, applied in order:
 *  1. The plan's preferred providers (or everything available).
 *  2. Exclusions from the plan and/or user preferences.
 *  3. User-selected retailers (`preferences.includedProviders`) — when
 *     present, this is authoritative: de-selected retailers are searched
 *     NEVER, and retailers the user selected but the plan did not prefer
 *     are re-included.
 *  4. `preferred_only` search mode caps at 3, unless the user pinned
 *     specific retailers (explicit selection wins over planner heuristics).
 *  5. Providers without credentials are dropped.
 */
export function resolveEligibleProviders(
  plan: Pick<SearchPlan, 'sourceStrategy'>,
  preferences:
    | Pick<ShopperPreferences, 'includedProviders' | 'excludedProviders'>
    | undefined,
  availableProviders: ProviderId[]
): ProviderId[] {
  const included = preferences?.includedProviders;

  // Explicit user selection is authoritative over the plan's preferences
  let eligible: ProviderId[] = included?.length
    ? included
    : (plan.sourceStrategy.preferredProviders ?? availableProviders);

  // Explicit exclusions (plan-level and user-level)
  const excluded = new Set<ProviderId>([
    ...(plan.sourceStrategy.excludedProviders || []),
    ...(preferences?.excludedProviders || []),
  ]);
  eligible = eligible.filter(p => !excluded.has(p));

  // Narrow to top picks only when the user hasn't pinned retailers
  if (plan.sourceStrategy.searchMode === 'preferred_only' && !included?.length) {
    eligible = eligible.slice(0, 3);
  }

  // Drop providers without credentials
  return eligible.filter(p => availableProviders.includes(p));
}
