'use client';

// ── Gift corpus for client-side semantic search ─────────────────────────
//
// A flattened, embeddable description of everything the gift engine can search
// for: every age / gender / combo / interest intent plus every brand. The
// browser embeds these once per session and matches free text against them, so
// "cozy baking afternoon" can reach the baking and coffee intents even when
// the shopper never picked those interests.
//
// This runs entirely on-device. The corpus is derived from the checked-in index
// (no network), and only the *matched queries* are ever sent to the server.

import { AGE_BRACKET_PROFILES, COMBO_INTENTS, GENDER_INTENTS, INTEREST_PROFILES } from '@/search/gift/index-data';
import { BRANDS, brandProductQuery } from '@/search/gift/brands';
import type { GiftIntent } from '@/search/gift/types';

export interface CorpusEntry {
  /** Intent id (also the dedupe key against already-selected intents). */
  id: string;
  /** Text that gets embedded. */
  text: string;
  query: string;
  label: string;
  why: string;
  families: string[];
}

function fromIntent(intent: GiftIntent, label: string, families: string[]): CorpusEntry {
  return {
    id: intent.id,
    // The "why" carries the gift rationale, which is what makes semantic
    // matching feel intelligent ("cozy" matches "comfort", not just "baking").
    text: `${label}: ${intent.query}. ${intent.why}`,
    query: intent.query,
    label,
    why: intent.why,
    families,
  };
}

let cached: CorpusEntry[] | null = null;

/** Every searchable gift idea, flattened. Memoized per session. */
export function giftCorpus(): CorpusEntry[] {
  if (cached) return cached;

  const entries: CorpusEntry[] = [];

  for (const profile of INTEREST_PROFILES) {
    for (const intent of profile.intents) {
      entries.push(fromIntent(intent, profile.label, ['interest']));
    }
  }

  for (const bracket of AGE_BRACKET_PROFILES) {
    for (const intent of bracket.ageIntents) {
      entries.push(fromIntent(intent, bracket.label, ['age']));
    }
    for (const intent of bracket.universalIntents) {
      entries.push(fromIntent(intent, 'Everyone', ['age']));
    }
  }

  for (const gender of ['woman', 'man'] as const) {
    const label = gender === 'woman' ? 'Women’s gifting' : 'Men’s gifting';
    for (const intent of GENDER_INTENTS[gender]) {
      entries.push(fromIntent(intent, label, ['gender']));
    }
  }

  for (const intent of COMBO_INTENTS) {
    const combo = intent.facets.find((facet) => facet.startsWith('combo:'));
    const [, bracket, gender] = (combo ?? '').split(':');
    entries.push(fromIntent(intent, `${bracket ?? 'age'} · ${gender ?? 'any'}`, ['age', 'gender', 'combo']));
  }

  for (const brand of BRANDS) {
    const query = brandProductQuery(brand);
    entries.push({
      id: `brand/${brand.slug}`,
      text: `${brand.name}: ${query}. A ${brand.name} gift.`,
      query,
      label: brand.name,
      why: `${brand.name} is a well-known brand in this category.`,
      families: ['brand'],
    });
  }

  cached = entries;
  return entries;
}
