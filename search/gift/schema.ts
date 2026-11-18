// ── Gift index + recipient validation ───────────────────────────────────
//
// Two boundaries are validated:
//   • anything arriving from the browser (a recipient profile, a gift
//     request) — see `./recipient-schema.ts`, re-exported here;
//   • the checked-in index itself, by `validateGiftIndex`. The index is data,
//     so these assertions are its compiler: unique ids, well-formed facets,
//     age gating, and no duplicated query inside one source.

import { z } from 'zod';
import {
  AGE_BRACKETS,
  GENDERS,
  INTEREST_IDS,
  type AgeBracket,
  type BrandProfile,
  type GiftIntent,
  type InterestProfile,
} from './types';
import {
  AGE_BRACKET_PROFILES,
  COMBO_INTENTS,
  GENDER_INTENTS,
  INTEREST_PROFILES,
} from './index-data';
import { BRANDS } from './brands';

// Recipient-boundary schemas live in a client-safe module and are re-exported
// here so callers have one entry point.
export { giftRecipientSchema, interestIdSchema } from './recipient-schema';
export type { ValidatedGiftRecipient } from './recipient-schema';

// ── Index integrity ────────────────────────────────────────────────────

const giftTierSchema = z.enum(['stocking', 'standard', 'hero']);
const intentKindSchema = z.enum(['category', 'brand', 'product']);
const ageBracketSchema = z.enum(AGE_BRACKETS);
const interestGroupSchema = z.enum([
  'food_drink',
  'home',
  'tech',
  'style',
  'outdoors',
  'fitness',
  'creative',
  'media',
  'life',
]);

/** `age:toddler`, `interest:coffee`, `brand:new-balance`, `combo:adult:man`. */
const facetSchema = z.string().regex(/^(age|gender|combo|interest|brand):[a-z0-9_:.-]+$/);
const intentIdSchema = z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_-]+)+$/);

const giftIntentSchema = z
  .object({
    id: intentIdSchema,
    query: z.string().min(2).max(80),
    kind: intentKindSchema,
    tier: giftTierSchema,
    strength: z.number().min(0).max(1),
    lean: z.enum(['neutral', 'woman', 'man']),
    facets: z.array(facetSchema).min(1).max(6),
    avoidAgeBrackets: z.array(ageBracketSchema).optional(),
    onlyAgeBrackets: z.array(ageBracketSchema).optional(),
    brands: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    productType: z.enum(['main', 'accessory', 'consumable', 'replacement_part']).optional(),
    why: z.string().min(10).max(240),
  })
  .strict();

const interestProfileSchema = z
  .object({
    id: z.enum(INTEREST_IDS),
    label: z.string().min(1).max(40),
    group: interestGroupSchema,
    giftableAgeBrackets: z.array(ageBracketSchema).min(1),
    primeAgeBrackets: z.array(ageBracketSchema).min(1).optional(),
    intents: z.array(giftIntentSchema).min(1),
  })
  .strict();

const ageBracketProfileSchema = z
  .object({
    id: ageBracketSchema,
    label: z.string().min(1).max(40),
    minAge: z.number().int().min(0),
    maxAge: z.number().int().min(0).nullable(),
    budgetCeiling: z.number().positive(),
    exclusions: z.array(z.string()),
    universalIntents: z.array(giftIntentSchema).min(1),
    ageIntents: z.array(giftIntentSchema).min(1),
  })
  .strict();

const brandProfileSchema = z
  .object({
    name: z.string().min(1).max(60),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    categories: z.array(z.string().min(2)).min(1).max(4),
    tier: giftTierSchema,
    strength: z.number().min(0).max(1),
    lean: z.enum(['neutral', 'woman', 'man']),
    ages: z.array(ageBracketSchema).min(1),
    interests: z.array(z.enum(INTEREST_IDS)),
  })
  .strict();

export interface GiftIndexShape {
  interests: InterestProfile[];
  brackets: typeof AGE_BRACKET_PROFILES;
  gender: Record<'woman' | 'man', GiftIntent[]>;
  combos: GiftIntent[];
  brands: BrandProfile[];
}

/** The one place that knows how the shipped index is assembled. */
export function currentGiftIndex(): GiftIndexShape {
  return {
    interests: INTEREST_PROFILES,
    brackets: AGE_BRACKET_PROFILES,
    gender: GENDER_INTENTS,
    combos: COMBO_INTENTS,
    brands: BRANDS,
  };
}

/**
 * Structural + semantic validation of the checked-in index.
 * Returns human-readable issues; an empty array means the index is usable.
 */
export function validateGiftIndex(index: GiftIndexShape): string[] {
  const issues: string[] = [];

  const parsed = z
    .object({
      interests: z.array(interestProfileSchema),
      brackets: z.array(ageBracketProfileSchema),
      gender: z.object({ woman: z.array(giftIntentSchema), man: z.array(giftIntentSchema) }),
      combos: z.array(giftIntentSchema),
      brands: z.array(brandProfileSchema),
    })
    .safeParse(index);

  if (!parsed.success) {
    // Structural problems make the semantic checks meaningless.
    return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  }

  // ── Coverage ─────────────────────────────────────────────────────────
  for (const id of INTEREST_IDS) {
    if (!index.interests.some((profile) => profile.id === id)) {
      issues.push(`interest "${id}" has no profile in the index`);
    }
  }
  for (const id of AGE_BRACKETS) {
    if (!index.brackets.some((bracket) => bracket.id === id)) {
      issues.push(`age bracket "${id}" has no profile in the index`);
    }
  }

  // ── Facet well-formedness ────────────────────────────────────────────
  const allIntents: Array<{ intent: GiftIntent; source: string }> = [
    ...index.brackets.flatMap((bracket) => bracket.universalIntents.map((intent) => ({ intent, source: `universal:${bracket.id}` }))),
    ...index.brackets.flatMap((bracket) => bracket.ageIntents.map((intent) => ({ intent, source: `age:${bracket.id}` }))),
    ...index.interests.flatMap((profile) => profile.intents.map((intent) => ({ intent, source: `interest:${profile.id}` }))),
    ...index.gender.woman.map((intent) => ({ intent, source: 'gender:woman' })),
    ...index.gender.man.map((intent) => ({ intent, source: 'gender:man' })),
    ...index.combos.map((intent) => ({ intent, source: 'combo' })),
  ];

  for (const { intent } of allIntents) {
    for (const facet of intent.facets) {
      const [family, ...rest] = facet.split(':');
      const value = rest.join(':');
      if (family === 'age' && !(AGE_BRACKETS as readonly string[]).includes(value)) {
        issues.push(`intent "${intent.id}" has an unknown age facet: ${facet}`);
      }
      if (family === 'gender' && !(GENDERS as readonly string[]).includes(value)) {
        issues.push(`intent "${intent.id}" has an unknown gender facet: ${facet}`);
      }
      if (family === 'interest' && !(INTEREST_IDS as readonly string[]).includes(value)) {
        issues.push(`intent "${intent.id}" has an unknown interest facet: ${facet}`);
      }
      if (family === 'combo') {
        const [bracket, gender] = value.split(':');
        if (!(AGE_BRACKETS as readonly string[]).includes(bracket) || !['woman', 'man'].includes(gender)) {
          issues.push(`intent "${intent.id}" has a malformed combo facet: ${facet}`);
        }
      }
      if (family === 'brand' && !index.brands.some((brand) => brand.slug === value)) {
        issues.push(`intent "${intent.id}" names an unknown brand facet: ${facet}`);
      }
    }
  }

  // ── Unique ids and per-source unique queries ─────────────────────────
  const seenIds = new Set<string>();
  for (const { intent } of allIntents) {
    if (seenIds.has(intent.id)) issues.push(`duplicate intent id: ${intent.id}`);
    seenIds.add(intent.id);
  }

  // The same query may appear in different layers on purpose (a good gift can
  // answer both "age" and "interest"); selection de-duplicates them. A repeat
  // *within one source* is a copy-paste bug.
  const bySource = new Map<string, Map<string, string>>();
  for (const { intent, source } of allIntents) {
    const queries = bySource.get(source) ?? new Map<string, string>();
    const key = intent.query.trim().toLowerCase();
    const owner = queries.get(key);
    if (owner) issues.push(`source "${source}" repeats query "${intent.query}" (${owner}, ${intent.id})`);
    else queries.set(key, intent.id);
    bySource.set(source, queries);
  }

  // ── Age gating ───────────────────────────────────────────────────────
  for (const { intent } of allIntents) {
    if (intent.onlyAgeBrackets && intent.avoidAgeBrackets) {
      const conflict = intent.onlyAgeBrackets.filter((bracket) =>
        intent.avoidAgeBrackets!.includes(bracket)
      );
      if (conflict.length > 0) {
        issues.push(`intent "${intent.id}" only-allows and avoids: ${conflict.join(', ')}`);
      }
    }
  }

  // Every bracket needs at least two neutral universal gifts, otherwise the
  // neutral-majority guarantee in `./brief.ts` can fail.
  for (const bracket of index.brackets) {
    const neutral = bracket.universalIntents.filter((intent) => intent.lean === 'neutral');
    if (neutral.length < 2) {
      issues.push(`age bracket "${bracket.id}" needs at least 2 neutral universal intents (has ${neutral.length})`);
    }
  }

  // An interest reachable at a bracket must have something offerable there.
  for (const profile of index.interests) {
    for (const bracket of profile.giftableAgeBrackets) {
      const offerable = profile.intents.filter(
        (intent) =>
          !intent.avoidAgeBrackets?.includes(bracket) &&
          (!intent.onlyAgeBrackets || intent.onlyAgeBrackets.includes(bracket))
      );
      if (offerable.length === 0) {
        issues.push(`interest "${profile.id}" is giftable to ${bracket} but has no offerable intent there`);
      }
    }
  }

  // ── Brands ───────────────────────────────────────────────────────────
  const slugs = new Set<string>();
  const names = new Set<string>();
  for (const brand of index.brands) {
    if (slugs.has(brand.slug)) issues.push(`duplicate brand slug: ${brand.slug}`);
    slugs.add(brand.slug);
    if (names.has(brand.name.toLowerCase())) issues.push(`duplicate brand name: ${brand.name}`);
    names.add(brand.name.toLowerCase());
    if (brand.categories.length === 0) issues.push(`brand "${brand.slug}" has no product nouns`);
  }

  // Every interest that a brand serves must be reachable at some age, or the
  // brand can never be promoted for that interest.
  for (const brand of index.brands) {
    for (const interest of brand.interests) {
      const profile = index.interests.find((entry) => entry.id === interest);
      if (!profile) {
        issues.push(`brand "${brand.slug}" references unknown interest "${interest}"`);
        continue;
      }
      if (!brand.ages.some((age) => profile.giftableAgeBrackets.includes(age))) {
        issues.push(
          `brand "${brand.slug}" serves "${interest}" but none of its ages overlap that interest's brackets`
        );
      }
    }
  }

  // Age layer must be present for every bracket (the "age alone" promise).
  for (const bracket of index.brackets) {
    if (bracket.ageIntents.length < 5) {
      issues.push(`age bracket "${bracket.id}" needs at least 5 age-alone intents (has ${bracket.ageIntents.length})`);
    }
  }

  return issues;
}

export function assertGiftIndexValid(): void {
  const issues = validateGiftIndex(currentGiftIndex());
  if (issues.length > 0) {
    throw new Error(`Gift index is invalid:\n- ${issues.join('\n- ')}`);
  }
}

/** Re-exported for tests that probe the index's age gating directly. */
export type { AgeBracket };
