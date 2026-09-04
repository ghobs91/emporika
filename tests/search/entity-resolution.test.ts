// ── Entity resolution tests ────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { resolveEntities } from '@/search/entity-resolution';
import type { NormalizedOffer } from '@/search/types';

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    offerId: `offer-${Math.random().toString(36).slice(2, 8)}`,
    providerId: 'walmart',
    providerProductId: `prod-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Sony WH-1000XM5 Wireless Headphones',
    condition: 'new',
    availability: 'in_stock',
    price: { amount: 299.99, currency: 'USD' },
    evidence: {
      fieldsProvided: ['title', 'price', 'availability'],
      sourceSearches: ['test headphones'],
    },
    uncertaintyFlags: [],
    ...overrides,
  };
}

describe('Entity resolution', () => {
  it('keeps single offer as its own canonical product', () => {
    const offers = [makeOffer()];
    const products = resolveEntities(offers);
    expect(products).toHaveLength(1);
    expect(products[0].offers).toHaveLength(1);
  });

  it('matches offers with highly similar titles', () => {
    const offerA = makeOffer({
      title: 'Waterproof Trail Running Shoes Size 10',
      providerId: 'walmart',
    });
    const offerB = makeOffer({
      title: 'Waterproof Trail Running Shoes - Size 10',
      providerId: 'bestbuy',
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(1);
    expect(products[0].offers).toHaveLength(2);
  });

  it('does NOT merge completely different products', () => {
    const offerA = makeOffer({ title: 'Wireless Headphones Black' });
    const offerB = makeOffer({ title: 'Running Shoes Waterproof Size 12' });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(2);
  });

  it('does NOT merge different model years/generations', () => {
    const offerA = makeOffer({ title: 'Sony WH-1000XM4 Headphones' });
    const offerB = makeOffer({ title: 'Sony WH-1000XM5 Headphones' });

    const products = resolveEntities([offerA, offerB]);

    // XM4 and XM5 carry disjoint model tokens — different generations stay separate
    expect(products).toHaveLength(2);
  });

  it('keeps weak matches separate', () => {
    const offerA = makeOffer({ title: 'Sony Headphones Black' });
    const offerB = makeOffer({ title: 'Sony Earbuds White' });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(2);
  });

  it('handles empty input', () => {
    const products = resolveEntities([]);
    expect(products).toHaveLength(0);
  });

  it('merges cross-retailer offers on exact GTIN with high confidence', () => {
    const offerA = makeOffer({
      providerId: 'walmart',
      providerProductId: 'w1',
      title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      identityHints: { gtin: '027242923012', brand: 'Sony' },
    });
    const offerB = makeOffer({
      providerId: 'bestbuy',
      providerProductId: 'b1',
      title: 'Sony - WH1000XM5 Wireless Noise-Canceling Headphones - Black',
      identityHints: { gtin: '027242923012', brand: 'Sony' },
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(1);
    expect(products[0].identity.matchMethod).toBe('gtin');
    expect(products[0].identity.confidence).toBe('high');
    expect(products[0].brand).toBe('Sony');
  });

  it('merges on exact UPC across retailers', () => {
    const offerA = makeOffer({
      providerId: 'walmart',
      providerProductId: 'w1',
      title: 'Logitech MX Master 3S Mouse',
      identityHints: { upc: '097855176300' },
    });
    const offerB = makeOffer({
      providerId: 'bestbuy',
      providerProductId: 'b1',
      title: 'Logitech - MX Master 3S Wireless Mouse',
      identityHints: { upc: '097855176300' },
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(1);
    expect(products[0].identity.matchMethod).toBe('upc');
  });

  it('does NOT merge when both brands are known and differ', () => {
    const offerA = makeOffer({
      title: 'Wireless Noise Canceling Headphones Black',
      identityHints: { brand: 'Sony' },
    });
    const offerB = makeOffer({
      title: 'Wireless Noise Canceling Headphones Black',
      providerId: 'bestbuy',
      identityHints: { brand: 'Bose' },
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(2);
  });

  it('still merges when only one side reports a brand', () => {
    const offerA = makeOffer({
      title: 'Waterproof Trail Running Shoes Size 10',
      identityHints: { brand: 'Salomon' },
    });
    const offerB = makeOffer({
      title: 'Waterproof Trail Running Shoes - Size 10',
      providerId: 'bestbuy',
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(1);
    expect(products[0].brand).toBe('Salomon');
  });

  it('treats dash-variant model tokens as agreeing', () => {
    const offerA = makeOffer({ title: 'Sony WH-1000XM5 Headphones' });
    const offerB = makeOffer({
      title: 'Sony WH1000XM5 Headphones',
      providerId: 'bestbuy',
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(1);
  });

  it('does NOT merge different storage variants', () => {
    const offerA = makeOffer({ title: 'Apple iPhone 15 Pro 128GB Natural Titanium' });
    const offerB = makeOffer({
      title: 'Apple iPhone 15 Pro 256GB Natural Titanium',
      providerId: 'bestbuy',
    });

    const products = resolveEntities([offerA, offerB]);
    expect(products).toHaveLength(2);
  });
});
