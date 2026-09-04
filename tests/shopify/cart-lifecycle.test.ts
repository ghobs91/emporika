// ── Shopify Cart MCP lifecycle tests (mocked fetch, no live APIs) ─────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShopifyCart,
  getShopifyCart,
  updateShopifyCart,
  cancelShopifyCart,
} from '@/lib/shopify';

const SHOP = 'example.myshopify.com';
const VARIANT_A = 'gid://shopify/ProductVariant/111';
const VARIANT_B = 'gid://shopify/ProductVariant/222';
const CART_ID = 'gid://shopify/Cart/abc123';

function cartPayload(overrides = {}) {
  return {
    ucp: { version: '2026-04-08', capabilities: {} },
    id: CART_ID,
    line_items: [],
    currency: 'USD',
    totals: [],
    messages: [],
    continue_url: 'https://example.myshopify.com/cart/c/abc123',
    ...overrides,
  };
}

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: payload } }),
    text: async () => '',
  };
}

function rateLimitedResponse() {
  return {
    ok: false,
    status: 429,
    headers: new Headers({ 'Retry-After': '0' }),
    json: async () => ({}),
    text: async () => 'rate limited',
  };
}

function lastRequestBody(mock: ReturnType<typeof vi.fn>) {
  const init = mock.mock.calls[mock.mock.calls.length - 1][1] as { body: string };
  return JSON.parse(init.body) as {
    params: { name: string; arguments: Record<string, unknown> };
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('cart lifecycle tools', () => {
  it('create_cart sends profile + idempotency-key in meta', async () => {
    const fetchMock = vi.fn(async () => okResponse(cartPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const cart = await createShopifyCart({ variantId: VARIANT_A, shopDomain: SHOP });

    expect(cart?.id).toBe(CART_ID);
    const body = lastRequestBody(fetchMock);
    expect(body.params.name).toBe('create_cart');
    const meta = body.params.arguments.meta as Record<string, unknown>;
    expect((meta['ucp-agent'] as { profile: string }).profile).toContain('ucp');
    expect(typeof meta['idempotency-key']).toBe('string');
  });

  it('reuses a caller-supplied idempotency key', async () => {
    const fetchMock = vi.fn(async () => okResponse(cartPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await createShopifyCart({ variantId: VARIANT_A, shopDomain: SHOP, idempotencyKey: 'key-123' });

    const body = lastRequestBody(fetchMock);
    expect((body.params.arguments.meta as Record<string, string>)['idempotency-key']).toBe('key-123');
  });

  it('update_cart uses PUT semantics (full line_items + top-level id)', async () => {
    const fetchMock = vi.fn(async () => okResponse(cartPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await updateShopifyCart({
      shopDomain: SHOP,
      cartId: CART_ID,
      lineItems: [
        { variantId: VARIANT_A, quantity: 2 },
        { variantId: VARIANT_B },
      ],
    });

    const body = lastRequestBody(fetchMock);
    expect(body.params.name).toBe('update_cart');
    expect(body.params.arguments.id).toBe(CART_ID);
    expect((body.params.arguments.cart as { line_items: unknown }).line_items).toEqual([
      { quantity: 2, item: { id: VARIANT_A } },
      { quantity: 1, item: { id: VARIANT_B } },
    ]);
  });

  it('update_cart rejects an empty lineItems array', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      updateShopifyCart({ shopDomain: SHOP, cartId: CART_ID, lineItems: [] })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get_cart and cancel_cart pass the cart id top-level', async () => {
    const fetchMock = vi.fn(async () => okResponse(cartPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await getShopifyCart({ shopDomain: SHOP, cartId: CART_ID });
    expect(lastRequestBody(fetchMock).params.name).toBe('get_cart');
    expect(lastRequestBody(fetchMock).params.arguments.id).toBe(CART_ID);

    await cancelShopifyCart({ shopDomain: SHOP, cartId: CART_ID });
    expect(lastRequestBody(fetchMock).params.name).toBe('cancel_cart');
    expect(lastRequestBody(fetchMock).params.arguments.id).toBe(CART_ID);
  });

  it('retries once on HTTP 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimitedResponse())
      .mockResolvedValueOnce(okResponse(cartPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const cart = await getShopifyCart({ shopDomain: SHOP, cartId: CART_ID });

    expect(cart?.id).toBe(CART_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
