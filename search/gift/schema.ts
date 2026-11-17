// ── Gift recipient + index validation ───────────────────────────────────
//
// Two boundaries are validated:
//   • anything arriving from the browser (a recipient profile, a gift
//     request) — see `giftRecipientSchema`;
//   • the checked-in index itself, at module load in tests and on every
//     `buildGiftBrief` call in development — see `validateGiftIndex`.

import { z } from 'zod';
import {
  AGE_BRACKETS,
  INTEREST_IDS,
  type AgeBracket,
  type GiftIntent,
  type InterestProfile,
} from './types';
import { AGE_BRACKET_PROFILES, INTEREST_PROFILES } from './index-data';

// Recipient-boundary schemas live in a client-safe module and are re-exported
// here so callers have one entry point.
export {
  giftRecipientSchema,
  giftIdeasRequestSchema,
  interestIdSchema,
} from './recipient-schema';
export type {
  ValidatedGiftRecipient,
  ValidatedGiftIdeasRequest,
} from './recipient-schema';

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

const giftIntentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_-]+)+$/, 'id must look like "interest/slug"'),
    query: z.string().min(2).max(80),
    kind: intentKindSchema,
    tier: giftTierSchema,
    strength: z.number().min(0).max(1),
    lean: z.enum(['woman', 'man', 'neutral']),
    avoidAgeBrackets: z.array(ageBracketSchema).optional(),
    onlyAgeBrackets: z.array(ageBracketSchema).optional(),
    brands: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    why: z.string().min(10).max(240),
  })
  .strict();

const interestProfileSchema = z
  .object({
    id: z.enum(INTEREST_IDS),
    label: z.string().min(1).max(40),
    group: interestGroupSchema,
    giftableAgeBrackets: z.array(ageBracketSchema).min(1),
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
  })
  .strict();

const giftIndexSchema = z
  .object({
    interests: z.array(interestProfileSchema),
    brackets: z.array(ageBracketProfileSchema),
  })
  .strict();

/**
 * Structural + semantic validation of the checked-in index.
 * Returns human-readable issues; an empty array means the index is usable.
 *
 * Structural issues come from Zod. Semantic ones are the invariants that
 * make selection predictable: unique ids, no query duplicated across
 * intents, and every bracket reachable by at least one universal gift.
 */
export function validateGiftIndex(index: {
  interests: InterestProfile[];
  brackets: typeof AGE_BRACKET_PROFILES;
}): string[] {
  const parsed = giftIndexSchema.safeParse(index);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  }

  const issues: string[] = [];

  // Every interest id has exactly one profile.
  const seenInterests = new Set<string>();
  for (const profile of index.interests) {
    if (seenInterests.has(profile.id)) issues.push(`duplicate interest profile: ${profile.id}`);
    seenInterests.add(profile.id);
  }
  for (const id of INTEREST_IDS) {
    if (!seenInterests.has(id)) issues.push(`interest "${id}" has no profile in the index`);
  }

  // Every bracket has exactly one profile.
  const seenBrackets = new Set<AgeBracket>();
  for (const bracket of index.brackets) {
    if (seenBrackets.has(bracket.id)) issues.push(`duplicate age bracket: ${bracket.id}`);
    seenBrackets.add(bracket.id);
  }
  for (const id of AGE_BRACKETS) {
    if (!seenBrackets.has(id)) issues.push(`age bracket "${id}" has no profile in the index`);
  }

  // Intent ids are globally unique. Queries may repeat *only* between a
  // bracket-universal fallback and an interest intent — that overlap is
  // intentional (the same great gift, justified differently per age). Two
  // interest intents sharing a query would just waste a provider request.
  const intentIds = new Set<string>();
  const queries = new Map<string, { id: string; universal: boolean }[]>();
  const allIntents: Array<{ intent: GiftIntent; universal: boolean }> = [
    ...index.interests.flatMap((profile) =>
      profile.intents.map((intent) => ({ intent, universal: false }))
    ),
    ...index.brackets.flatMap((bracket) =>
      bracket.universalIntents.map((intent) => ({ intent, universal: true }))
    ),
  ];
  for (const { intent, universal } of allIntents) {
    if (intentIds.has(intent.id)) issues.push(`duplicate intent id: ${intent.id}`);
    intentIds.add(intent.id);

    const key = intent.query.trim().toLowerCase();
    const owners = queries.get(key) ?? [];
    owners.push({ id: intent.id, universal });
    queries.set(key, owners);

    // An intent that is both required-only and forbidden for a bracket can
    // never be selected — almost always a data-entry mistake.
    if (intent.onlyAgeBrackets && intent.avoidAgeBrackets) {
      const conflict = intent.onlyAgeBrackets.filter((b) => intent.avoidAgeBrackets!.includes(b));
      if (conflict.length > 0) {
        issues.push(`intent "${intent.id}" only-allows and avoids: ${conflict.join(', ')}`);
      }
    }
  }

  for (const [query, owners] of queries) {
    const nonUniversal = owners.filter((owner) => !owner.universal);
    if (nonUniversal.length > 1) {
      issues.push(
        `interest intents share the query "${query}": ${nonUniversal.map((o) => o.id).join(', ')}`
      );
    }
  }

  // Every bracket must offer at least two neutral universal gifts, otherwise
  // the neutral-majority guarantee in `./brief.ts` can fail.
  for (const bracket of index.brackets) {
    const neutral = bracket.universalIntents.filter((i) => i.lean === 'neutral');
    if (neutral.length < 2) {
      issues.push(`age bracket "${bracket.id}" needs at least 2 neutral universal intents (has ${neutral.length})`);
    }
  }

  // An interest reachable at a bracket must have at least one intent that is
  // actually offerable there.
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

  return issues;
}

/**
 * Throwing wrapper used at module load in development and in tests.
 * In production the data file is trusted (it is checked in and tested), so
 * this is not run per request.
 */
export function assertGiftIndexValid(): void {
  const issues = validateGiftIndex({
    interests: INTEREST_PROFILES,
    brackets: AGE_BRACKET_PROFILES,
  });
  if (issues.length > 0) {
    throw new Error(`Gift index is invalid:\n- ${issues.join('\n- ')}`);
  }
}
