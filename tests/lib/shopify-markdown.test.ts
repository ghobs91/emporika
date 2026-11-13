// ── Shopify markdown derivation (pure, no live APIs) ─────────────────────
//
// The Global Catalog exposes no "on sale" filter, and product-level
// `list_price_range` is not returned (verified against the live endpoint, UCP
// 2026-08-25). Per-variant `list_price` is therefore the only honest discount
// signal, and a discount must never be derived from the price_range spread:
// that spread is different offers across merchants, not a markdown.

import { describe, it, expect } from 'vitest';
import { convertShopifyToUnified } from '@/lib/shopify';
import type { ShopifyProduct, ShopifyVariant } from '@/types/shopify';

const SELLER = { id: 'gid://shopify/Shop/1', name: 'Acme Goods' };

function variant(overrides: Partial<ShopifyVariant> = {}): ShopifyVariant {
  return {
    id: 'gid://shopify/ProductVariant/1',
    title: 'Default',
    description: { plain: '' },
    options: [],
    seller: SELLER,
    availability: { available: true, status: 'in_stock' },
    ...overrides,
  };
}

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 'gid://shopify/p/UPID1',
    title: 'Test Product',
    description: { plain: 'A product' },
    price_range: {
      min: { amount: 1000, currency: 'USD' },
      max: { amount: 1000, currency: 'USD' },
    },
    variants: [variant({ price: { amount: 1000, currency: 'USD' } })],
    ...overrides,
  };
}

describe('convertShopifyToUnified markdowns', () => {
  it('uses list_price as the original price when it exceeds price', () => {
    const [unified] = convertShopifyToUnified([
      product({
        variants: [
          variant({
            price: { amount: 10999, currency: 'USD' },
            list_price: { amount: 16499, currency: 'USD' },
          }),
        ],
      }),
    ]);

    expect(unified.price).toBe(109.99);
    expect(unified.originalPrice).toBe(164.99);
  });

  it('reports no original price when list_price equals price', () => {
    const [unified] = convertShopifyToUnified([
      product({
        variants: [
          variant({
            price: { amount: 5000, currency: 'USD' },
            list_price: { amount: 5000, currency: 'USD' },
          }),
        ],
      }),
    ]);

    expect(unified.originalPrice).toBeUndefined();
  });

  it('does not treat a price_range spread across merchants as a discount', () => {
    const [unified] = convertShopifyToUnified([
      product({
        // Same product offered at $39 and $65 by different merchants.
        price_range: {
          min: { amount: 3900, currency: 'USD' },
          max: { amount: 6500, currency: 'USD' },
        },
        variants: [variant({ price: { amount: 3900, currency: 'USD' } })],
      }),
    ]);

    expect(unified.price).toBe(39);
    expect(unified.originalPrice).toBeUndefined();
  });

  it('describes the deepest in-stock markdown when the deals feed opts in', () => {
    const [unified] = convertShopifyToUnified(
      [
        product({
          variants: [
            variant({
              id: 'gid://shopify/ProductVariant/featured',
              price: { amount: 10000, currency: 'USD' },
              url: 'https://acme.example/featured',
            }),
            variant({
              id: 'gid://shopify/ProductVariant/sale',
              price: { amount: 4000, currency: 'USD' },
              list_price: { amount: 9000, currency: 'USD' }, // $50 off
              url: 'https://acme.example/sale',
            }),
            variant({
              id: 'gid://shopify/ProductVariant/shallow',
              price: { amount: 7000, currency: 'USD' },
              list_price: { amount: 8000, currency: 'USD' }, // $10 off
            }),
          ],
        }),
      ],
      { preferMarkdown: true }
    );

    expect(unified.price).toBe(40);
    expect(unified.originalPrice).toBe(90);
    // The variant id and URL must describe the same offer as the price.
    expect(unified.variantId).toBe('gid://shopify/ProductVariant/sale');
    expect(unified.productUrl).toBe('https://acme.example/sale');
  });

  it('keeps the featured variant for search and trending (the default)', () => {
    const [unified] = convertShopifyToUnified([
      product({
        variants: [
          variant({
            id: 'gid://shopify/ProductVariant/featured',
            price: { amount: 10000, currency: 'USD' },
          }),
          variant({
            id: 'gid://shopify/ProductVariant/sale',
            price: { amount: 4000, currency: 'USD' },
            list_price: { amount: 9000, currency: 'USD' },
          }),
        ],
      }),
    ]);

    expect(unified.price).toBe(100);
    expect(unified.variantId).toBe('gid://shopify/ProductVariant/featured');
    expect(unified.originalPrice).toBeUndefined();
  });

  it('ignores a markdown on an out-of-stock variant', () => {
    const [unified] = convertShopifyToUnified(
      [
        product({
          variants: [
            variant({
              id: 'gid://shopify/ProductVariant/out',
              price: { amount: 2000, currency: 'USD' },
              list_price: { amount: 9000, currency: 'USD' },
              availability: { available: false, status: 'out_of_stock' },
            }),
            variant({
              id: 'gid://shopify/ProductVariant/in',
              price: { amount: 6000, currency: 'USD' },
              availability: { available: true, status: 'in_stock' },
            }),
          ],
        }),
      ],
      { preferMarkdown: true }
    );

    expect(unified.variantId).toBe('gid://shopify/ProductVariant/in');
    expect(unified.price).toBe(60);
    expect(unified.originalPrice).toBeUndefined();
  });

  it('falls back to the price range minimum when no variants are returned', () => {
    const [unified] = convertShopifyToUnified([
      product({
        variants: [],
        price_range: {
          min: { amount: 2599, currency: 'USD' },
          max: { amount: 2599, currency: 'USD' },
        },
      }),
    ]);

    expect(unified.price).toBe(25.99);
    expect(unified.originalPrice).toBeUndefined();
    expect(unified.availableOnline).toBe(false);
  });
});
