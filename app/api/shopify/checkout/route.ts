import { NextRequest, NextResponse } from 'next/server';
import {
  createShopifyCheckout,
  getShopifyCheckout,
  updateShopifyCheckout,
  cancelShopifyCheckout,
  classifyShopifyCheckout,
} from '@/lib/shopify';
import type { ShopifyCheckout } from '@/types/shopify';

/**
 * /api/shopify/checkout — Shopify Checkout MCP lifecycle.
 *
 * POST   Create a checkout, optionally converting a Cart MCP cart (`cartId`).
 * GET    Refresh a checkout: ?shopDomain=…&checkoutId=…
 * PUT    Replace a checkout (PUT semantics — full checkout payload).
 * DELETE Cancel a checkout (shopDomain + checkoutId via query or JSON body).
 *
 * Deployment model: build + handoff. Emporika starts/refreshes a checkout and
 * opens its `continue_url` so the buyer completes payment on the merchant's
 * storefront. `complete_checkout` is intentionally not exposed (requires a
 * token permitted to complete purchases).
 *
 * UCP notes:
 * - Every upstream tools/call carries meta `idempotency-key` (client key
 *   reused on retry, else minted here and echoed back).
 * - Checkout `messages` are classified into an `action` hint following the
 *   checkout lifecycle: completed → show order; canceled → start over;
 *   handoff → open continue_url; retry_or_fallback → fall back to the cart.
 * - `requestConstraints` (ucp.request_constraints) is passed through opaque.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function mintKey(provided: unknown): string {
  if (typeof provided === 'string' && provided.length > 0) return provided;
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function checkoutEnvelope(checkout: ShopifyCheckout, key: string) {
  const { action, errors, warnings } = classifyShopifyCheckout(checkout);
  return {
    // A checkout resource was returned and isn't canceled. `requires_escalation`
    // is a normal, actionable state for build + handoff — not a failure.
    success: checkout.status !== 'canceled',
    action,
    status: checkout.status,
    idempotencyKey: key,
    checkout: {
      id: checkout.id,
      status: checkout.status,
      currency: checkout.currency,
      buyer: checkout.buyer,
      lineItems: (checkout.line_items ?? []).map((li) => ({
        title: li.item?.title,
        price: li.item?.price ? li.item.price / 100 : undefined,
        quantity: li.quantity,
        totals: li.totals?.map((t) => ({
          type: t.type,
          amount: t.amount / 100,
          label: t.display_text,
        })),
      })),
      totals: (checkout.totals ?? []).map((t) => ({
        type: t.type,
        amount: t.amount / 100,
        label: t.display_text,
      })),
      continueUrl: checkout.continue_url ?? null,
      expiresAt: checkout.expires_at ?? null,
      order: checkout.order
        ? { id: checkout.order.id, permalinkUrl: checkout.order.permalink_url ?? null }
        : null,
      links: checkout.links ?? [],
    },
    errors: errors.map((m) => ({ code: m.code, content: m.content, severity: m.severity })),
    warnings: warnings.map((m) => ({ code: m.code, content: m.content })),
    // Opaque UCP Request Constraints for preflight of the next request.
    requestConstraints: checkout.ucp?.request_constraints ?? null,
  };
}

// ── POST: create (optionally from a cart) ───────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopDomain, cartId, checkout, idempotencyKey } = body;

    if (!shopDomain) {
      return NextResponse.json({ error: 'shopDomain is required' }, { status: 400 });
    }
    if (!cartId && !checkout) {
      return NextResponse.json(
        { error: 'Provide cartId (convert a Cart MCP cart) or a checkout payload' },
        { status: 400 }
      );
    }

    const key = mintKey(idempotencyKey);
    const result = await createShopifyCheckout({
      shopDomain,
      cartId,
      checkout,
      idempotencyKey: key,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to create checkout — merchant may not support Checkout MCP' },
        { status: 502 }
      );
    }

    return NextResponse.json(checkoutEnvelope(result, key));
  } catch (error) {
    console.error('Checkout creation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create checkout',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ── GET: refresh ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const shopDomain = params.get('shopDomain');
    const checkoutId = params.get('checkoutId');

    if (!shopDomain || !checkoutId) {
      return NextResponse.json(
        { error: 'shopDomain and checkoutId query parameters are required' },
        { status: 400 }
      );
    }

    const result = await getShopifyCheckout({ shopDomain, checkoutId });
    if (!result) {
      return NextResponse.json(
        { error: 'Failed to fetch checkout — merchant may not support Checkout MCP' },
        { status: 502 }
      );
    }

    return NextResponse.json(checkoutEnvelope(result, mintKey(null)));
  } catch (error) {
    console.error('Checkout fetch error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch checkout',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ── PUT: replace (full checkout payload) ────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopDomain, checkoutId, checkout, idempotencyKey } = body;

    if (!shopDomain || !checkoutId) {
      return NextResponse.json(
        { error: 'shopDomain and checkoutId are required' },
        { status: 400 }
      );
    }
    if (!checkout || typeof checkout !== 'object') {
      return NextResponse.json(
        { error: 'checkout is required (update uses PUT semantics: send the complete desired state)' },
        { status: 400 }
      );
    }

    const key = mintKey(idempotencyKey);
    const result = await updateShopifyCheckout({
      shopDomain,
      checkoutId,
      checkout,
      idempotencyKey: key,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to update checkout — merchant may not support Checkout MCP' },
        { status: 502 }
      );
    }

    return NextResponse.json(checkoutEnvelope(result, key));
  } catch (error) {
    console.error('Checkout update error:', error);
    return NextResponse.json(
      {
        error: 'Failed to update checkout',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ── DELETE: cancel ──────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    let shopDomain = params.get('shopDomain');
    let checkoutId = params.get('checkoutId');
    let idempotencyKey: unknown = params.get('idempotencyKey');

    if (!shopDomain || !checkoutId) {
      try {
        const body = await request.json();
        shopDomain = shopDomain || body.shopDomain;
        checkoutId = checkoutId || body.checkoutId;
        idempotencyKey = idempotencyKey || body.idempotencyKey;
      } catch {
        // No JSON body — fall through to validation error below.
      }
    }

    if (!shopDomain || !checkoutId) {
      return NextResponse.json(
        { error: 'shopDomain and checkoutId are required (query parameters or JSON body)' },
        { status: 400 }
      );
    }

    const key = mintKey(idempotencyKey);
    await cancelShopifyCheckout({ shopDomain, checkoutId, idempotencyKey: key });

    return NextResponse.json({ success: true, checkoutId, idempotencyKey: key });
  } catch (error) {
    console.error('Checkout cancel error:', error);
    return NextResponse.json(
      {
        error: 'Failed to cancel checkout',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
