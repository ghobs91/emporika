// ── Trend extraction (build-time, pure) ─────────────────────────────────
//
// Turns publication headlines into gift concepts like "sculptural cuff" or
// "cast iron skillet". Deterministic, dependency-free, and unit-tested, because
// everything downstream (cohorts, categories, the client boost) trusts it.
//
// Two rules keep it honest:
//   1. a phrase only survives if its head word is in an explicit product-noun
//      vocabulary, mapped to exactly one category (no substring guessing —
//      "keyboard" must not match "board");
//   2. cohorts come from explicit demographic language when a headline has it,
//      otherwise from the publication's declared audience. The second is a feed
//      prior, not a measurement, and the manifest says so.

export const TREND_SCHEMA_VERSION = 1;

// ── Product vocabulary, grouped by category ────────────────────────────

const NOUNS_BY_CATEGORY: Record<string, string[]> = {
  jewelry: ['ring', 'necklace', 'earring', 'bracelet', 'cuff', 'pendant', 'brooch', 'charm', 'stud', 'hoop', 'bangle', 'anklet', 'locket', 'choker'],
  accessories: ['bag', 'tote', 'wallet', 'belt', 'scarf', 'sunglasses', 'eyeglasses', 'hat', 'beanie', 'cap', 'glove', 'mitten', 'backpack', 'luggage', 'suitcase', 'umbrella', 'watch', 'sock', 'sneaker', 'boot', 'shoe', 'loafer', 'sandal', 'heel', 'mule', 'sweater', 'cardigan', 'coat', 'jacket', 'blazer', 'dress', 'skirt', 'jean', 'pant', 'trouser', 'shirt', 'tee', 'polo', 'blouse', 'shorts', 'legging', 'hoodie', 'fleece', 'vest', 'parka', 'trench', 'robe', 'pajama', 'swimsuit', 'bra', 'underwear', 'undershirt', 'jumpsuit', 'romper', 'suit', 'tie', 'outfit'],
  cooking: ['pan', 'skillet', 'pot', 'knife', 'board', 'blender', 'mixer', 'kettle', 'grinder', 'toaster', 'oven', 'cooker', 'carafe', 'decanter', 'tumbler', 'thermometer', 'grill', 'smoker', 'squeezer', 'peeler', 'whisk'],
  tech: ['phone', 'laptop', 'tablet', 'headphone', 'earbud', 'speaker', 'camera', 'monitor', 'keyboard', 'mouse', 'charger', 'drone', 'console', 'controller', 'tv', 'projector', 'tracker', 'reader', 'hub', 'stand', 'case', 'strap', 'cable', 'adapter', 'mount', 'lens', 'tripod', 'microphone', 'gimbal'],
  home: ['lamp', 'rug', 'sofa', 'sectional', 'chair', 'table', 'desk', 'bed', 'mattress', 'pillow', 'blanket', 'throw', 'duvet', 'sheet', 'towel', 'mirror', 'vase', 'planter', 'shelf', 'organizer', 'bin', 'mug', 'cup', 'glass', 'plate', 'bowl', 'candle', 'diffuser', 'vacuum', 'purifier', 'fan', 'heater', 'tray', 'basket', 'ottoman', 'dresser', 'cabinet', 'fridge'],
  beauty: ['serum', 'cream', 'moisturizer', 'cleanser', 'mask', 'lipstick', 'mascara', 'eyeliner', 'foundation', 'concealer', 'blush', 'highlighter', 'perfume', 'fragrance', 'shampoo', 'conditioner', 'dryer', 'straightener', 'brush', 'palette', 'polish', 'razor', 'trimmer', 'balm', 'oil', 'spray', 'toner', 'exfoliant'],
  fitness: ['dumbbell', 'mat', 'roller', 'treadmill', 'weight', 'band', 'bike', 'helmet', 'kettlebell'],
  outdoors: ['tent', 'lantern', 'stove', 'cooler', 'daypack', 'pole', 'headlamp', 'paddleboard', 'kayak', 'ski', 'snowboard', 'wader', 'rod', 'reel', 'bottle', 'flask'],
  kids: ['lego', 'puzzle', 'doll', 'plush', 'block', 'toy', 'scooter', 'stroller', 'playset', 'crayon'],
  pets: ['leash', 'collar', 'fountain', 'carrier', 'scratcher', 'crate'],
};

/** Multi-word concepts, mapped to their category. */
const MULTIWORD_NOUNS: Record<string, string> = {
  'dutch oven': 'cooking',
  'air fryer': 'cooking',
  'coffee maker': 'cooking',
  'espresso machine': 'cooking',
  'cutting board': 'cooking',
  'chef knife': 'cooking',
  'cast iron skillet': 'cooking',
  'sheet pan': 'cooking',
  'baking sheet': 'cooking',
  'stand mixer': 'cooking',
  'gift set': 'accessories',
  'travel mug': 'home',
  'coffee table': 'home',
  'standing desk': 'home',
  'dining table': 'home',
  'sleeping bag': 'outdoors',
  'board game': 'kids',
  'air purifier': 'home',
  'yoga mat': 'fitness',
  'water bottle': 'outdoors',
  'hair dryer': 'beauty',
  'flat iron': 'beauty',
  'robot vacuum': 'home',
  'noise cancelling headphone': 'tech',
};

const NOUN_TO_CATEGORY = new Map<string, string>();
for (const [category, nouns] of Object.entries(NOUNS_BY_CATEGORY)) {
  for (const noun of nouns) NOUN_TO_CATEGORY.set(noun, category);
}
const PRODUCT_NOUNS = new Set(NOUN_TO_CATEGORY.keys());

// ── Phrase vocabularies ────────────────────────────────────────────────

/**
 * Modifiers that may appear in front of a head noun. A whitelist, not a
 * blacklist: without it, headlines contribute "should watch" and "herby sheet".
 */
const ATTRIBUTES = new Set([
  // materials
  'cashmere', 'wool', 'linen', 'cotton', 'silk', 'leather', 'suede', 'denim',
  'tweed', 'velvet', 'satin', 'gold', 'silver', 'platinum', 'diamond', 'pearl',
  'ceramic', 'glass', 'stainless', 'copper', 'brass', 'marble', 'oak', 'walnut',
  'bamboo', 'iron', 'nonstick', 'carbon', 'titanium', 'steel', 'mesh', 'knit',
  'crochet', 'quilted', 'padded', 'fleece', 'sherpa', 'merino', 'alpaca', 'rubber',
  // style
  'sculptural', 'chunky', 'oversized', 'cropped', 'relaxed', 'tailored',
  'vintage', 'retro', 'minimalist', 'minimal', 'classic', 'modern', 'layered',
  'stackable', 'statement', 'convertible', 'modular', 'adjustable',
  'ergonomic', 'portable', 'compact', 'foldable', 'waterproof', 'organic',
  'handmade', 'personalized', 'monogrammed', 'designer', 'luxury', 'premium',
  // tech qualifiers
  'wireless', 'cordless', 'bluetooth', 'smart', 'rechargeable', 'insulated',
  'cancelling', 'noise', 'digital', 'electric', 'manual',
  // form factors
  'mini', 'small', 'large', 'full', 'queen', 'king', 'twin', 'travel',
  'everyday', 'weekender', 'gift', 'holiday', 'two', 'tone', 'mid', 'century',
  'art', 'deco', 'flat', 'standing',
]);

/** Heads too generic to stand alone ("board", "table", "bag"). */
const GENERIC_HEADS = new Set([
  'board', 'table', 'bed', 'phone', 'bag', 'case', 'stand', 'strap', 'band',
  'oil', 'cream', 'mask', 'maker', 'mat', 'cap', 'chain', 'ring', 'pan', 'pot', 'mount',
  'plate', 'glass', 'cup', 'frame', 'brush', 'tray', 'set', 'suit', 'outfit',
]);


const LEADING_SCAFFOLDING =
  /^(?:\d{1,3}\s+|the\s+\d{1,3}\s+|our\s+\d{1,3}\s+|the\s+|these\s+|this\s+|those\s+|a\s+|an\s+)+/i;

// ── Cohort vocabulary ──────────────────────────────────────────────────

const DECADES: Array<{ decade: string; pattern: RegExp }> = [
  { decade: '20s', pattern: /\b(20s|twenties|in their 20s)\b/i },
  { decade: '30s', pattern: /\b(30s|thirties|in their 30s)\b/i },
  { decade: '40s', pattern: /\b(40s|forties|in their 40s)\b/i },
  { decade: '50s', pattern: /\b(50s|fifties|in their 50s)\b/i },
  { decade: '60plus', pattern: /\b(60s|70s|sixties|seventies|over 60|over 65|retiree|retirees|senior|seniors)\b/i },
];

const WOMEN_PATTERN = /\b(women|woman|her|she|moms?|mothers?|grandmothers?|girls?|female|ladies)\b/i;
const MEN_PATTERN = /\b(men|man|him|he|dads?|fathers?|grandfathers?|boys?|male|gents)\b/i;
const TEEN_PATTERN = /\b(teens?|teenagers?|gen z|high school)\b/i;
const KIDS_PATTERN = /\b(kids?|children|toddlers?|babies|baby|preschool)\b/i;

/** Age-agnostic cohorts, used when a headline names a gender but no decade. */
export const AGE_AGNOSTIC_COHORTS = ['women', 'men', 'unisex', 'teens', 'kids'] as const;

// ── Text helpers ───────────────────────────────────────────────────────

export function cleanText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Crude but predictable singularization; the vocabulary is hand-curated. */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ses') && !word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return cleanText(text)
    .toLowerCase()
    .replace(LEADING_SCAFFOLDING, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

// ── Extraction ─────────────────────────────────────────────────────────

/** Extract gift concepts from a headline (canonical, singular, lowercase). */
export function extractProductPhrases(title: string): string[] {
  const tokens = tokenize(title);
  const found = new Set<string>();

  // Multi-word heads first, so "cast iron skillet" beats "iron skillet".
  for (let i = 0; i < tokens.length; i += 1) {
    for (let span = 3; span >= 2; span -= 1) {
      const slice = tokens.slice(i, i + span);
      if (slice.length < span) continue;
      const canonical = slice
        .map((token, index) => (index === slice.length - 1 ? singular(token) : token))
        .join(' ');
      if (canonical in MULTIWORD_NOUNS) {
        found.add(canonical);
        i += span - 1;
        break;
      }
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const head = singular(tokens[i]);
    if (!PRODUCT_NOUNS.has(head)) continue;

    // Walk backwards over *whitelisted* modifiers only.
    const modifiers: string[] = [];
    for (let back = i - 1; back >= 0 && modifiers.length < 2; back -= 1) {
      const token = tokens[back];
      if (!ATTRIBUTES.has(token)) break;
      modifiers.unshift(token);
    }

    if (modifiers.length === 0 && GENERIC_HEADS.has(head)) continue;

    // Drop a bare head that a multi-word phrase already covers better.
    const phrase = [...modifiers, head].join(' ');
    if (Object.keys(MULTIWORD_NOUNS).some((multi) => multi.endsWith(` ${phrase}`))) continue;

    found.add(phrase);
  }

  return [...found];
}

// ── Categorisation ─────────────────────────────────────────────────────

/**
 * Category for a phrase or headline.
 *
 * Multi-word concepts and exact nouns decide it; there is no substring
 * matching, so "keyboard" can never be read as "board" (cooking).
 */
export function categorize(text: string): string | null {
  const cleaned = cleanText(text).toLowerCase().replace(/-/g, ' ');

  for (const [phrase, category] of Object.entries(MULTIWORD_NOUNS)) {
    if (cleaned.includes(` ${phrase} `) || cleaned === phrase) return category;
  }

  const counts = new Map<string, number>();
  for (const token of cleaned.split(/[^a-z]+/)) {
    if (!token) continue;
    const category = NOUN_TO_CATEGORY.get(singular(token));
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let best: { category: string; hits: number } | null = null;
  for (const [category, hits] of counts) {
    if (!best || hits > best.hits) best = { category, hits };
  }
  return best?.category ?? null;
}

// ── Cohort detection ───────────────────────────────────────────────────

/**
 * Cohorts implied by explicit demographic language.
 * Returns [] when the text names no audience — the caller then applies the
 * feed's declared cohorts.
 */
export function detectExplicitCohorts(text: string): string[] {
  const haystack = cleanText(text);
  const cohorts = new Set<string>();

  const decades = DECADES.filter((entry) => entry.pattern.test(haystack)).map((entry) => entry.decade);

  if (TEEN_PATTERN.test(haystack)) cohorts.add('teens');
  if (KIDS_PATTERN.test(haystack)) cohorts.add('kids');

  const gendered = WOMEN_PATTERN.test(haystack)
    ? 'women'
    : MEN_PATTERN.test(haystack)
      ? 'men'
      : null;

  if (gendered) {
    if (decades.length > 0) {
      for (const decade of decades) cohorts.add(`${gendered}-${decade}`);
    } else {
      // Do NOT spray this across decades — that would invent an age split the
      // headline never made.
      cohorts.add(gendered);
    }
  } else if (decades.length > 0) {
    for (const decade of decades) cohorts.add(`unisex-${decade}`);
  }

  return [...cohorts];
}

// ── Aggregation ────────────────────────────────────────────────────────

export interface Headline {
  title: string;
  summary?: string;
  publishedAt?: string;
  /** Cohorts this feed serves by default. */
  feedCohorts: string[];
}

/**
 * Aggregate headlines into cohort → category → terms.
 *
 * Attribution, in order:
 *  1. explicit demographic language in the headline ("gifts for women in
 *     their 30s");
 *  2. otherwise the feed's declared cohorts (a style feed serves women, a tech
 *     feed serves `unisex`).
 *
 * The second is a *feed prior*, counted in the manifest so nobody mistakes it
 * for survey data.
 */
export function aggregateTrends(
  headlines: Headline[],
  options: { maxTermsPerBucket?: number; minScore?: number } = {}
): {
  cohorts: Record<string, Record<string, string[]>>;
  attribution: { explicit: number; feedPrior: number };
} {
  const maxTerms = options.maxTermsPerBucket ?? 14;
  const minScore = options.minScore ?? 1;

  type TermStats = { count: number; score: number };
  const buckets = new Map<string, Map<string, Map<string, TermStats>>>();
  let explicit = 0;
  let feedPrior = 0;

  for (const headline of headlines) {
    const phrases = extractProductPhrases(headline.title);
    if (phrases.length === 0) continue;

    const explicitCohorts = detectExplicitCohorts(`${headline.title} ${headline.summary ?? ''}`);
    const cohorts = explicitCohorts.length > 0 ? explicitCohorts : headline.feedCohorts;
    if (cohorts.length === 0) continue;
    if (explicitCohorts.length > 0) explicit += 1;
    else feedPrior += 1;

    for (const phrase of phrases) {
      // The phrase is the signal; the headline only breaks ties.
      const category = categorize(phrase) ?? categorize(headline.title);
      if (!category) continue;

      const position = headline.title.toLowerCase().indexOf(phrase);
      const positionBonus = position >= 0 && position < headline.title.length / 3 ? 0.5 : 0;

      for (const cohort of cohorts) {
        const byCategory = buckets.get(cohort) ?? new Map<string, Map<string, TermStats>>();
        const byTerm = byCategory.get(category) ?? new Map<string, TermStats>();
        const existing = byTerm.get(phrase) ?? { count: 0, score: 0 };
        byTerm.set(phrase, {
          count: existing.count + 1,
          score: existing.score + 1 + positionBonus,
        });
        byCategory.set(category, byTerm);
        buckets.set(cohort, byCategory);
      }
    }
  }

  const cohorts: Record<string, Record<string, string[]>> = {};
  for (const [cohort, byCategory] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const categories: Record<string, string[]> = {};
    for (const [category, byTerm] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ranked = [...byTerm.entries()]
        .filter(([, stats]) => stats.score >= minScore)
        .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));

      // Keep the strongest phrasing: drop a term contained in a better one
      // ("iron skillet" when "cast iron skillet" is present) and vice versa.
      const terms: string[] = [];
      for (const [term] of ranked) {
        if (terms.some((kept) => kept !== term && (kept.includes(term) || term.includes(kept)))) {
          continue;
        }
        terms.push(term);
        if (terms.length >= maxTerms) break;
      }

      if (terms.length > 0) categories[category] = terms;
    }
    if (Object.keys(categories).length > 0) cohorts[cohort] = categories;
  }

  return { cohorts, attribution: { explicit, feedPrior } };
}
