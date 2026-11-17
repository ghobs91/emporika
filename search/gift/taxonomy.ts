// ── Client-safe gift taxonomy ───────────────────────────────────────────
//
// Small, dependency-free metadata the recipient picker renders: interest
// ids + labels, age brackets, gender options. The heavy per-interest intent
// data stays server-side in `./index-data.ts` so the browser bundle never
// carries ~120 search intents it cannot execute.

import {
  AGE_BRACKETS,
  GENDERS,
  INTEREST_IDS,
  type AgeBracket,
  type Gender,
  type InterestId,
  type InterestSummary,
} from './types';

export { AGE_BRACKETS, GENDERS, INTEREST_IDS };
export type { AgeBracket, Gender, InterestId };

/** Picker-facing interest list. Order is the order shoppers see. */
export const INTERESTS: InterestSummary[] = [
  { id: 'coffee', label: 'Coffee', group: 'food_drink', teaser: 'Espresso, brewers, mugs' },
  { id: 'tea', label: 'Tea', group: 'food_drink', teaser: 'Kettles, infusers, loose leaf' },
  { id: 'cooking', label: 'Cooking', group: 'food_drink', teaser: 'Knives, cookware, gadgets' },
  { id: 'baking', label: 'Baking', group: 'food_drink', teaser: 'Mixers, pans, decorating' },
  { id: 'grilling', label: 'Grilling & BBQ', group: 'food_drink', teaser: 'Grills, thermometers, rubs' },
  { id: 'wine_spirits', label: 'Wine & spirits', group: 'food_drink', teaser: 'Glassware, accessories' },
  { id: 'home_decor', label: 'Home decor', group: 'home', teaser: 'Lighting, frames, textiles' },
  { id: 'candles_scents', label: 'Candles & scents', group: 'home', teaser: 'Candles, diffusers, sprays' },
  { id: 'gardening', label: 'Gardening', group: 'home', teaser: 'Planters, tools, seeds' },
  { id: 'organization', label: 'Organization', group: 'home', teaser: 'Storage, labels, planners' },
  { id: 'tech_gadgets', label: 'Tech gadgets', group: 'tech', teaser: 'Chargers, trackers, accessories' },
  { id: 'audio', label: 'Audio', group: 'tech', teaser: 'Headphones, speakers, turntables' },
  { id: 'gaming', label: 'Gaming', group: 'tech', teaser: 'Controllers, headsets, accessories' },
  { id: 'photography', label: 'Photography', group: 'tech', teaser: 'Instant cameras, lenses, prints' },
  { id: 'smart_home', label: 'Smart home', group: 'tech', teaser: 'Plugs, sensors, assistants' },
  { id: 'beauty_skincare', label: 'Beauty & skincare', group: 'style', teaser: 'Skincare, hair, fragrance' },
  { id: 'fashion_accessories', label: 'Fashion accessories', group: 'style', teaser: 'Bags, scarves, sunglasses' },
  { id: 'jewelry', label: 'Jewelry', group: 'style', teaser: 'Necklaces, earrings, rings' },
  { id: 'watches', label: 'Watches', group: 'style', teaser: 'Watches, straps, winders' },
  { id: 'camping', label: 'Camping', group: 'outdoors', teaser: 'Lanterns, stoves, sleeping gear' },
  { id: 'hiking', label: 'Hiking', group: 'outdoors', teaser: 'Daypacks, poles, bottles' },
  { id: 'cycling', label: 'Cycling', group: 'outdoors', teaser: 'Lights, tools, helmets' },
  { id: 'fishing', label: 'Fishing', group: 'outdoors', teaser: 'Tackle, boxes, tools' },
  { id: 'fitness', label: 'Fitness', group: 'fitness', teaser: 'Weights, bands, trackers' },
  { id: 'running', label: 'Running', group: 'fitness', teaser: 'Socks, vests, watches' },
  { id: 'yoga', label: 'Yoga', group: 'fitness', teaser: 'Mats, blocks, bolsters' },
  { id: 'crafts_diy', label: 'Crafts & DIY', group: 'creative', teaser: 'Kits, tools, supplies' },
  { id: 'art_supplies', label: 'Art supplies', group: 'creative', teaser: 'Sketchbooks, pens, markers' },
  { id: 'reading', label: 'Reading', group: 'media', teaser: 'Books, lights, bookmarks' },
  { id: 'music', label: 'Music', group: 'media', teaser: 'Vinyl, instruments, accessories' },
  { id: 'board_games', label: 'Board games', group: 'media', teaser: 'Party, strategy, puzzles' },
  { id: 'pets', label: 'Pets', group: 'life', teaser: 'Toys, beds, treat makers' },
  { id: 'toys_play', label: 'Toys & play', group: 'life', teaser: 'Building sets, plush, play kits' },
  { id: 'travel', label: 'Travel', group: 'life', teaser: 'Packing, luggage, comfort' },
  { id: 'tools_diy', label: 'Tools & DIY', group: 'life', teaser: 'Drills, kits, organizers' },
];

/** Picker groups, in display order. */
export const INTEREST_GROUP_LABELS: Record<string, string> = {
  food_drink: 'Food & drink',
  home: 'Home',
  tech: 'Tech',
  style: 'Style',
  outdoors: 'Outdoors',
  fitness: 'Fitness',
  creative: 'Creative',
  media: 'Media',
  life: 'Life',
};

/** Age bracket metadata the picker needs (labels + ranges only). */
export const AGE_BRACKET_LABELS: Record<AgeBracket, string> = {
  infant: 'Infant (0–1)',
  toddler: 'Toddler (1–3)',
  child: 'Child (4–8)',
  tween: 'Tween (9–12)',
  teen: 'Teen (13–17)',
  young_adult: 'Young adult (18–25)',
  adult: 'Adult (26–40)',
  mature_adult: 'Adult (41–60)',
  senior: 'Senior (60+)',
};

export const GENDER_LABELS: Record<Gender, string> = {
  woman: 'Woman',
  man: 'Man',
  nonbinary: 'Non-binary',
  unspecified: 'Prefer not to say',
};

/** Upper bound (inclusive) of each bracket; the last one is open-ended. */
const BRACKET_RANGES: Array<{ id: AgeBracket; min: number; max: number | null }> = [
  { id: 'infant', min: 0, max: 1 },
  { id: 'toddler', min: 2, max: 3 },
  { id: 'child', min: 4, max: 8 },
  { id: 'tween', min: 9, max: 12 },
  { id: 'teen', min: 13, max: 17 },
  { id: 'young_adult', min: 18, max: 25 },
  { id: 'adult', min: 26, max: 40 },
  { id: 'mature_adult', min: 41, max: 60 },
  { id: 'senior', min: 61, max: null },
];

/**
 * Map an age in years to its bracket. Out-of-range ages clamp to the
 * nearest end, so a bad input still produces a usable brief rather than a
 * crash or an empty recipient profile.
 */
export function ageBracketForAge(age: number): AgeBracket {
  const safe = Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0;
  for (const range of BRACKET_RANGES) {
    if (range.max === null || safe <= range.max) return range.id;
  }
  return 'senior';
}

/** True when `bracket` is listed in `allowed`. */
export function bracketIn(bracket: AgeBracket, allowed: readonly AgeBracket[]): boolean {
  return allowed.includes(bracket);
}

/** Look up a picker interest by id (undefined for unknown ids). */
export function getInterest(id: string): InterestSummary | undefined {
  return INTERESTS.find((entry) => entry.id === id);
}
