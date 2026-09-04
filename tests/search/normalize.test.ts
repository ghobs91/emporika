// ── Candidate normalization tests ─────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { normalizeCandidate } from '@/search/normalize';
import type { ProviderProductCandidate } from '@/search/types';

function makeCandidate(overrides: Partial<ProviderProductCandidate> = {}): ProviderProductCandidate {
  return {
    providerId: 'walmart',
    providerProductId: 'w-123',
    title: 'Test Product',
    price: { amount: 49.99, currency: 'USD' },
    rawFieldAvailability: { name: true, price: true },
    sourceSearches: ['test'],
    ...overrides,
  };
}

describe('normalizeCandidate identity hints', () => {
  it('carries first GTIN/UPC/EAN/MPN values and brand/model forward', () => {
    const offer = normalizeCandidate(
      makeCandidate({
        brand: 'Sony',
        canonicalProductHints: {
          gtin: ['027242923012'],
          upc: ['027242923012'],
          mpn: ['WH1000XM5'],
          brand: 'Sony',
          model: 'WH-1000XM5',
        },
      }),
      'test'
    );

    expect(offer.identityHints).toEqual({
      gtin: '027242923012',
      upc: '027242923012',
      mpn: 'WH1000XM5',
      brand: 'Sony',
      model: 'WH-1000XM5',
    });
  });

  it('falls back to the candidate brand when hints carry none', () => {
    const offer = normalizeCandidate(makeCandidate({ brand: 'Salomon' }), 'test');
    expect(offer.identityHints).toEqual({ brand: 'Salomon' });
  });

  it('omits identityHints when there is nothing to carry', () => {
    const offer = normalizeCandidate(makeCandidate(), 'test');
    expect(offer.identityHints).toBeUndefined();
  });
});
