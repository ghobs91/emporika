// ── Product-type tagging (client-side, title-based) ─────────────────────
//
// Gift searches surface accessories, refills and $6 replacement gaskets next
// to the actual gift. The gift index carries an *authoring hint*
// (`productType`) for intents whose results are inherently consumable, but the
// pollution is a property of the individual listing, so the decisive
// classification runs on the title.
//
// Deterministic, no model: a keyword scorer with explicit precedence. When a
// title is ambiguous the safer type wins (accessory over main), because showing
// a gasket as "the gift" is worse than hiding a legitimate gadget.

import type { ProductType } from '@/search/gift/types';

export type { ProductType };

export interface ProductTypeSignal {
  type: ProductType;
  /** Which rule fired, for the UI explainer. */
  reason: string;
}

/**
 * Replacement/repair language. Checked first: "replacement filter for X" must
 * not be read as the consumable "filter".
 */
const REPLACEMENT_PATTERNS: RegExp[] = [
  /\breplacement\b/,
  /\bspare (part|blade|filter|kit)s?\b/,
  /\brepair kit\b/,
  /\bservice kit\b/,
  /\bgasket\b/,
  /\bo[- ]?ring\b/,
  /\bcompatible (with|for)\b/,
  /\bfits? (for|all)\b/,
  /\bscreen protector\b/,
  /\blens cap\b/,
  /\bdrive belt\b/,
  /\bheating element\b/,
  /\bcharcoal filter\b/,
  /\bwater filter\b/,
  /\bvacuum (filter|bag)s?\b/,
];

/** Things that run out and are re-bought. */
const CONSUMABLE_PATTERNS: RegExp[] = [
  /\brefill\b/,
  /\bpods?\b/,
  /\bcapsules?\b/,
  /\bcoffee (beans|grounds)\b/,
  /\btea bags?\b/,
  /\b(yarn|thread|floss)\b/,
  /\bbatter(y|ies) (pack|set)\b/,
  /\brub\b/,
  /\bseasoning\b/,
  /\brubs?\b/,
  /\bsauce\b/,
  /\bchocolate\b/,
  /\bcandy\b/,
  /\bsnack\b/,
  /\bfilm\b/,
  /\bpaper\b/,
  /\bsheets?\b/,
  /\bwipes\b/,
  /\bcleanser\b/,
  /\bshampoo\b/,
  /\bconditioner\b/,
  /\blotion\b/,
  /\bserum\b/,
  /\bmascara\b/,
  /\blipstick\b/,
  /\bpet (treats?|food)\b/,
  /\bflour\b/,
  /\bsugar\b/,
  /\bspices?\b/,
  /\bseeds?\b/,
  /\bbeans\b/,
  /\bvanilla extract\b/,
];

/** Things that only make sense attached to a main product. */
const ACCESSORY_PATTERNS: RegExp[] = [
  /\bcase\b/,
  /\bcover\b/,
  /\bsleeve\b/,
  /\b(strap|band)\b/,
  /\bstand\b/,
  /\bmount\b/,
  /\bcharger\b/,
  /\bcable\b/,
  /\badapter\b/,
  /\bholder\b/,
  /\bwallet case\b/,
  /\b(carry|travel) bag\b/,
  /\bcleaning kit\b/,
  /\bstylus\b/,
  /\bscreen\b/,
  /\bprotector\b/,
  /\bskin\b/,
  /\blid\b/,
  /\bbrush head\b/,
  /\bblade guard\b/,
];

function firstMatch(patterns: RegExp[], haystack: string): RegExp | null {
  for (const pattern of patterns) if (pattern.test(haystack)) return pattern;
  return null;
}

/**
 * Classify a listing title. `hint` is the index's authoring hint for the
 * intent, used only when the title itself is uninformative.
 */
export function classifyProductType(title: string, hint?: ProductType): ProductTypeSignal {
  const haystack = ` ${title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;

  const replacement = firstMatch(REPLACEMENT_PATTERNS, haystack);
  if (replacement) {
    return { type: 'replacement_part', reason: `title matches /${replacement.source}/` };
  }

  const consumable = firstMatch(CONSUMABLE_PATTERNS, haystack);
  if (consumable) {
    return { type: 'consumable', reason: `title matches /${consumable.source}/` };
  }

  const accessory = firstMatch(ACCESSORY_PATTERNS, haystack);
  if (accessory) {
    return { type: 'accessory', reason: `title matches /${accessory.source}/` };
  }

  if (hint) return { type: hint, reason: 'index hint (title uninformative)' };
  return { type: 'main', reason: 'no accessory/consumable/part language' };
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  main: 'Gift',
  accessory: 'Accessory',
  consumable: 'Consumable',
  replacement_part: 'Replacement part',
};

/**
 * Whether a type should be hidden from the main grid.
 *
 * `diyOrRepair` is the escape hatch the spec asks for: a recipient whose
 * interests are tools/cycling/cars genuinely wants parts and accessories, so
 * the default filter relaxes for them.
 */
export function isHiddenByDefault(type: ProductType, diyOrRepair: boolean): boolean {
  if (type === 'replacement_part') return !diyOrRepair;
  if (type === 'accessory') return diyOrRepair ? false : false; // accessories stay, ranked lower
  return false;
}

/** Interests where parts/accessories are plausible gifts. */
const DIY_INTERESTS = new Set(['tools_diy', 'cycling', 'fishing', 'camping', 'gaming', 'photography']);

export function isDiyOrRepairProfile(interests: readonly string[]): boolean {
  return interests.some((interest) => DIY_INTERESTS.has(interest));
}
