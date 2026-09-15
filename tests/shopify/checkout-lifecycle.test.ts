// ── Shopify Checkout MCP lifecycle tests (mocked fetch, no live APIs) ─────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShopifyCheckout,
  getShopifyCheckout,
  updateShopifyCheckout,
  cancelShopifyCheckout,
  classifyShopifyCheckout,
} from '@/lib/shopify';
import type { ShopifyCheckout } from '@/types/shopify';

const SHOP = 'example.myshopify.com';
const VARIANT_A = 'gid://shopify/ProductVariant/111';
const CART_ID = 'gid://shopify/Cart/abc123';
const CHECKOUT_ID = 'gid://shopify/Checkout/xyz789?key=secret';

function checkoutPayload(overrides: Partial<ShopifyCheckout> = {}): ShopifyCheckout {
  return {
    ucp: { version: '2026-08-25', capabilities: {} },
    id: CHECKOUT_ID,
    status: 'requires_escalation',
    currency: 'USD',
    line_items: [],
    totals: [],
    messages: [],
    continue_url: 'https://example.myshopify.com/cart/c/abc123?key=secret',
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

function lastRequestBody(mock: ReturnType<typeof vi.fn>) {
  const init = mock.mock.calls[mock.mock.calls.length - 1][1] as { body: string };
  return JSON.parse(init.body) as {
    params: { name: string; arguments: Record<string, unknown> };
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('checkout lifecycle tools', () => {
  it('create_checkout converts a cart via top-level cart_id', async () => {
    const fetchMock = vi.fn(async () => okResponse(checkoutPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const checkout = await createShopifyCheckout({ shopDomain: SHOP, cartId: CART_ID });

    expect(checkout?.id).toBe(CHECKOUT_ID);
    expect(checkout?.status).toBe('requires_escalation');
    const body = lastRequestBody(fetchMock);
    expect(body.params.name).toBe('create_checkout');
    expect(body.params.arguments.cart_id).toBe(CART_ID);
    const meta = body.params.arguments.meta as Record<string, unknown>;
    expect((meta['ucp-agent'] as { profile: string }).profile).toContain('2026-08-25');
    expect(typeof meta['idempotency-key']).toBe('string');
  });

  it('create_checkout without a cart sends a normalized checkout payload', async () => {
    const fetchMock = vi.fn(async () => okResponse(checkoutPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await createShopifyCheckout({
      shopDomain: SHOP,
      checkout: {
        currency: 'USD',
        line_items: [{ variantId: VARIANT_A, quantity: 2 }],
        buyer: { email: 'buyer@example.com' },
      },
    });

    const body = lastRequestBody(fetchMock);
    expect(body.params.arguments.cart_id).toBeUndefined();
    const checkout = body.params.arguments.checkout as Record<string, unknown>;
    expect(checkout.line_items).toEqual([{ quantity: 2, item: { id: VARIANT_A } }]);
    expect(checkout.buyer).toEqual({ email: 'buyer@example.com' });
    // Default agentic attribution is attached.
    expect((checkout.attribution as { utm_source: string }).utm_source).toBe('emporika');
  });

  it('create_checkout requires cartId or a checkout payload', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createShopifyCheckout({ shopDomain: SHOP })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get_checkout and cancel_checkout pass the checkout id top-level', async () => {
    const fetchMock = vi.fn(async () => okResponse(checkoutPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await getShopifyCheckout({ shopDomain: SHOP, checkoutId: CHECKOUT_ID });
    expect(lastRequestBody(fetchMock).params.name).toBe('get_checkout');
    expect(lastRequestBody(fetchMock).params.arguments.id).toBe(CHECKOUT_ID);

    await cancelShopifyCheckout({ shopDomain: SHOP, checkoutId: CHECKOUT_ID });
    expect(lastRequestBody(fetchMock).params.name).toBe('cancel_checkout');
    expect(lastRequestBody(fetchMock).params.arguments.id).toBe(CHECKOUT_ID);
  });

  it('update_checkout uses PUT semantics (full checkout + top-level id)', async () => {
    const fetchMock = vi.fn(async () => okResponse(checkoutPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await updateShopifyCheckout({
      shopDomain: SHOP,
      checkoutId: CHECKOUT_ID,
      checkout: { line_items: [{ variantId: VARIANT_A }], currency: 'USD' },
    });

    const body = lastRequestBody(fetchMock);
    expect(body.params.name).toBe('update_checkout');
    expect(body.params.arguments.id).toBe(CHECKOUT_ID);
    expect(
      (body.params.arguments.checkout as { line_items: unknown }).line_items
    ).toEqual([{ quantity: 1, item: { id: VARIANT_A } }]);
  });

  it('reuses a caller-supplied idempotency key', async () => {
    const fetchMock = vi.fn(async () => okResponse(checkoutPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await createShopifyCheckout({ shopDomain: SHOP, cartId: CART_ID, idempotencyKey: 'key-9' });

    const body = lastRequestBody(fetchMock);
    expect((body.params.arguments.meta as Record<string, string>)['idempotency-key']).toBe('key-9');
  });
});

describe('classifyShopifyCheckout', () => {
  it('maps non-terminal states to handoff when a continue_url exists', () => {
    for (const status of ['incomplete', 'requires_escalation', 'ready_for_complete']) {
      expect(classifyShopifyCheckout(checkoutPayload({ status })).action).toBe('handoff');
    }
  });

  it('maps completed and canceled to terminal actions', () => {
    expect(classifyShopifyCheckout(checkoutPayload({ status: 'completed' })).action).toBe(
      'completed'
    );
    expect(classifyShopifyCheckout(checkoutPayload({ status: 'canceled' })).action).toBe(
      'canceled'
    );
  });

  it('falls back when there is no continue_url', () => {
    const result = classifyShopifyCheckout(
      checkoutPayload({ status: 'incomplete', continue_url: undefined })
    );
    expect(result.action).toBe('retry_or_fallback');
  });

  it('flags messages that require buyer input', () => {
    const result = classifyShopifyCheckout(
      checkoutPayload({
        status: 'requires_escalation',
        messages: [
          { type: 'error', code: 'missing_email', content: 'Email required', severity: 'requires_buyer_input' },
        ],
      })
    );
    expect(result.needsBuyer).toBe(true);
    expect(result.errors).toHaveLength(1);
  });
});
