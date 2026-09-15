// ── Deterministic interaction-learning tests (pure functions) ────────────

import { describe, it, expect } from 'vitest';
import {
  emptyProfile,
  recordSignal,
  derivePreferences,
  mergePreferences,
  KIND_WEIGHT,
} from '@/lib/learning';

describe('recordSignal', () => {
  it('accumulates brand weight by interaction kind', () => {
    let profile = emptyProfile();
    profile = recordSignal(profile, { kind: 'click', brand: 'Nike' });
    profile = recordSignal(profile, { kind: 'click', brand: 'nike' });
    profile = recordSignal(profile, { kind: 'add_to_cart', brand: 'NIKE' });

    // Normalized to one key; weights = click + click + add_to_cart.
    expect(Object.keys(profile.brands)).toEqual(['nike']);
    expect(profile.brands.nike).toBe(KIND_WEIGHT.click * 2 + KIND_WEIGHT.add_to_cart);
  });

  it('tracks provider affinity separately', () => {
    const profile = recordSignal(emptyProfile(), { kind: 'purchase', providerId: 'target' });
    expect(profile.providers.target).toBe(KIND_WEIGHT.purchase);
  });

  it('ignores blank brands', () => {
    const profile = recordSignal(emptyProfile(), { kind: 'click', brand: '   ' });
    expect(Object.keys(profile.brands)).toHaveLength(0);
  });
});

describe('derivePreferences', () => {
  it('emits nothing below the minimum weight threshold', () => {
    const profile = recordSignal(emptyProfile(), { kind: 'click', brand: 'Sony' });
    expect(derivePreferences(profile)).toEqual({});
  });

  it('emits brands that clear the threshold, strongest first', () => {
    let profile = emptyProfile();
    profile = recordSignal(profile, { kind: 'purchase', brand: 'Sony' }); // 3
    profile = recordSignal(profile, { kind: 'add_to_cart', brand: 'Bose' }); // 2
    profile = recordSignal(profile, { kind: 'click', brand: 'JBL' }); // 1

    expect(derivePreferences(profile).preferredBrands).toEqual(['sony', 'bose']);
  });

  it('honors a custom maxBrands', () => {
    let profile = emptyProfile();
    for (const brand of ['a', 'b', 'c', 'd']) {
      profile = recordSignal(profile, { kind: 'add_to_cart', brand });
    }
    expect(derivePreferences(profile, { maxBrands: 2 }).preferredBrands).toHaveLength(2);
  });
});

describe('mergePreferences', () => {
  it('keeps explicit preferences and appends learned brands (deduped)', () => {
    const merged = mergePreferences(
      { preferredBrands: ['Sony'], maxResults: 50 },
      { preferredBrands: ['sony', 'Bose'] }
    );
    expect(merged.preferredBrands).toEqual(['Sony', 'Bose']);
    expect(merged.maxResults).toBe(50);
  });

  it('returns explicit preferences untouched when nothing was learned', () => {
    const explicit = { priorities: ['waterproof'] };
    expect(mergePreferences(explicit, {})).toEqual(explicit);
  });
});
