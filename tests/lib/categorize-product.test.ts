// ── Product categorization tests ───────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { categorizeProduct } from '@/lib/categorize-product';
import type { UnifiedProduct } from '@/types/unified';

function makeProduct(overrides: Partial<UnifiedProduct> = {}): UnifiedProduct {
  return {
    id: 'p1',
    name: 'Test Product',
    price: 10,
    image: '',
    productUrl: '#',
    source: 'walmart',
    ...overrides,
  };
}

describe('categorizeProduct', () => {
  it('classifies a kids tablet by name even when the copy is full of home words', () => {
    // Real onn copy: "carry from room to room" / "64 GB of storage". Those
    // generic words used to outvote the name's "tablet" and bucket it home.
    const product = makeProduct({
      name: 'onn 8" Kids Tablet, 64 GB, Android 16, Blue (2026 Model)',
      shortDescription:
        'The onn 8 in Kids Tablet is built for learning, games, videos, and everyday fun. Its compact size and 1 lb design make it easy to carry from room to room or take along on the go. With 64 GB of storage and Android 16, it gives you room for favorite downloads and apps.',
    });
    expect(categorizeProduct(product)).toBe('electronics');
  });

  it('classifies the 11-inch kids tablet as electronics', () => {
    const product = makeProduct({
      name: 'onn 11" Kids Tablet, 64 GB, Android 16, Blue (2026 Model)',
      shortDescription:
        'This onn kids tablet is ready for learning and play, and is designed for simple use at home or on the go.',
    });
    expect(categorizeProduct(product)).toBe('electronics');
  });

  it('prefers a sports brand in the name over home words in the description', () => {
    const product = makeProduct({
      name: 'T-2 Series Power Rack — Titan Fitness',
      shortDescription: 'A sturdy rack for your home gym.',
    });
    expect(categorizeProduct(product)).toBe('sports');
  });

  it('prefers the name signal for footwear', () => {
    const product = makeProduct({
      name: 'Lorax Pro - Healthy & non-slip barefoot shoes (Unisex) — PeakFootwear',
      shortDescription: 'Comfortable enough for the home or the trail.',
    });
    expect(categorizeProduct(product)).toBe('fashion');
  });

  it('still classifies from the description when the name has no signal', () => {
    const product = makeProduct({
      name: 'Widget 3000',
      shortDescription: 'A stylish addition to your kitchen and home.',
    });
    expect(categorizeProduct(product)).toBe('home');
  });

  it('returns all when neither name nor description matches', () => {
    const product = makeProduct({ name: 'Mystery Item 9000' });
    expect(categorizeProduct(product)).toBe('all');
  });
});
