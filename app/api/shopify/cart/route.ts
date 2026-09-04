import { NextRequest, NextResponse } from 'next/server';
import {
  createShopifyCart,
  getShopifyCart,
  updateShopifyCart,
  cancelShopifyCart,
} from '@/lib/shopify';
import type { ShopifyCart } from '@/types/shopify';

/**
 * /api/shopify/cart — Shopify Cart MCP lifecycle.
 *
 * POST   Create a cart (single variantId or lineItems array).
 * GET    Refresh a cart: ?shopDomain=…&cartId=…
 * PUT    Replace a cart's contents (PUT semantics — full lineItems array).
 * DELETE Cancel a cart (shopDomain + cartId via query or JSON body).
 *
 * UCP notes:
 * - Every upstream tools/call carries meta `idempotency-key` (client key
 *   reused on retry, else minted here and echoed back).
 * - Business-outcome messages are classified into an `action` hint following
 *   the UCP error-processing model: recoverable → retry, requires_buyer_*
 *   → surface to the buyer. `requestConstraints` (ucp.request_constraints)
 *   is passed through opaque for preflight of the next request.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function mintKey(provided: unknown): string {
  if (typeof provided === 'string' && provided.length > 0) return provided;
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isVariantGid(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('gid://shopify/ProductVariant/');
}

function classifyCart(cart: ShopifyCart) {
  const errors = cart.messages?.filter((m) => m.type === 'error') ?? [];
  const warnings = cart.messages?.filter((m) => m.type === 'warning') ?? [];
  const needsBuyer = errors.some(
    (m) => m.severity === 'requires_buyer_input' || m.severity === 'requires_buyer_review'
  );
  const action =
    errors.length === 0
      ? ('proceed' as const)
      : needsBuyer
        ? ('buyer_input_required' as const)
        : ('retry_or_fallback' as const);
  return { errors, warnings, needsBuyer, action };
}

function cartEnvelope(cart: ShopifyCart, key: string, refreshed = false) {
  const { errors, warnings, action } = classifyCart(cart);
  return {
    success: errors.length === 0,
    action,
    idempotencyKey: key,
    refreshed,
    cart: {
      id: cart.id,
      lineItems: cart.line_items.map((li) => ({
        title: li.item.title,
        price: li.item.price ? li.item.price / 100 : undefined,
        quantity: li.quantity,
        totals: li.totals?.map((t) => ({
          type: t.type,
          amount: t.amount / 100,
          label: t.display_text,
        })),
      })),
      totals: cart.totals.map((t) => ({
        type: t.type,
        amount: t.amount / 100,
        label: t.display_text,
      })),
      currency: cart.currency,
      continueUrl: cart.continue_url,
      expiresAt: cart.expires_at,
    },
    errors: errors.map((m) => ({ code: m.code, content: m.content, severity: m.severity })),
    warnings: warnings.map((m) => ({ code: m.code, content: m.content })),
    // Opaque UCP Request Constraints for preflight of the next request.
    requestConstraints: cart.ucp?.request_constraints ?? null,
  };
}

function validateLineItems(lineItems: unknown): lineItems is Array<{ variantId: string; quantity?: number }> {
  return (
    Array.isArray(lineItems) &&
    lineItems.length > 0 &&
    lineItems.every(
      (li) =>
        li &&
        typeof li === 'object' &&
        isVariantGid((li as { variantId: unknown }).variantId)
    )
  );
}

// ── POST: create ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { variantId, lineItems, shopDomain, context, idempotencyKey } = body;

    if (!shopDomain) {
      return NextResponse.json(
        { error: 'shopDomain is required' },
        { status: 400 }
      );
    }

    // Validate that we have items
    const hasSingleItem = variantId && typeof variantId === 'string';
    const hasMultiItems = Array.isArray(lineItems) && lineItems.length > 0;

    if (!hasSingleItem && !hasMultiItems) {
      return NextResponse.json(
        { error: 'Either variantId (single item) or lineItems (multi-item array) is required' },
        { status: 400 }
      );
    }

    // Validate GID format for single item
    if (hasSingleItem && !isVariantGid(variantId)) {
      return NextResponse.json(
        { error: 'variantId must be a Shopify variant GID (gid://shopify/ProductVariant/{id})' },
        { status: 400 }
      );
    }

    // Validate GID format for multi items
    if (hasMultiItems && !validateLineItems(lineItems)) {
      return NextResponse.json(
        { error: 'Every lineItems entry needs a valid variantId (gid://shopify/ProductVariant/{id})' },
        { status: 400 }
      );
    }

    const itemCount = hasMultiItems ? lineItems.length : 1;
    console.log(`Creating Shopify cart: ${itemCount} item(s), shop=${shopDomain}`);

    // Idempotency: reuse the client's key on retry, else mint one and echo it.
    const key = mintKey(idempotencyKey);

    const cart = await createShopifyCart({
      variantId: hasSingleItem ? variantId : undefined,
      quantity: body.quantity ?? 1,
      lineItems: hasMultiItems ? lineItems : undefined,
      shopDomain,
      context: context ?? { address_country: 'US' },
      idempotencyKey: key,
    });

    if (!cart) {
      return NextResponse.json(
        { error: 'Failed to create cart — merchant may not support Cart MCP' },
        { status: 502 }
      );
    }

    // Recoverable-error retry: re-read the merchant-validated cart once so
    // callers see current totals instead of the pre-validation state.
    // Buyer-input errors are surfaced as-is (no retry can fix them).
    // Unknown severities fall back to `retry_or_fallback` so callers never
    // silently treat errors as success.
    let resultCart = cart;
    let refreshed = false;
    const initial = classifyCart(cart);
    if (initial.errors.length > 0 && !initial.needsBuyer) {
      try {
        const fresh = await getShopifyCart({ shopDomain, cartId: cart.id });
        if (fresh) {
          resultCart = fresh;
          refreshed = true;
        }
      } catch (e) {
        console.warn('Cart refresh after recoverable errors failed, returning original:', e);
      }
    }

    return NextResponse.json(cartEnvelope(resultCart, key, refreshed));
  } catch (error) {
    console.error('Cart creation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create cart',
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
    const cartId = params.get('cartId');

    if (!shopDomain || !cartId) {
      return NextResponse.json(
        { error: 'shopDomain and cartId query parameters are required' },
        { status: 400 }
      );
    }

    const cart = await getShopifyCart({ shopDomain, cartId });
    if (!cart) {
      return NextResponse.json(
        { error: 'Failed to fetch cart — merchant may not support Cart MCP' },
        { status: 502 }
      );
    }

    return NextResponse.json(cartEnvelope(cart, mintKey(null), true));
  } catch (error) {
    console.error('Cart fetch error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch cart',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ── PUT: replace (full lineItems array) ─────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopDomain, cartId, lineItems, context, idempotencyKey } = body;

    if (!shopDomain || !cartId) {
      return NextResponse.json(
        { error: 'shopDomain and cartId are required' },
        { status: 400 }
      );
    }
    if (!validateLineItems(lineItems)) {
      return NextResponse.json(
        { error: 'lineItems must be a non-empty array with valid variantIds (update uses PUT semantics: send the complete desired state)' },
        { status: 400 }
      );
    }

    const key = mintKey(idempotencyKey);
    const cart = await updateShopifyCart({
      shopDomain,
      cartId,
      lineItems,
      context,
      idempotencyKey: key,
    });

    if (!cart) {
      return NextResponse.json(
        { error: 'Failed to update cart — merchant may not support Cart MCP' },
        { status: 502 }
      );
    }

    return NextResponse.json(cartEnvelope(cart, key));
  } catch (error) {
    console.error('Cart update error:', error);
    return NextResponse.json(
      {
        error: 'Failed to update cart',
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
    let cartId = params.get('cartId');
    let idempotencyKey: unknown = params.get('idempotencyKey');

    if (!shopDomain || !cartId) {
      try {
        const body = await request.json();
        shopDomain = shopDomain || body.shopDomain;
        cartId = cartId || body.cartId;
        idempotencyKey = idempotencyKey || body.idempotencyKey;
      } catch {
        // No JSON body — fall through to validation error below.
      }
    }

    if (!shopDomain || !cartId) {
      return NextResponse.json(
        { error: 'shopDomain and cartId are required (query parameters or JSON body)' },
        { status: 400 }
      );
    }

    const key = mintKey(idempotencyKey);
    await cancelShopifyCart({ shopDomain, cartId, idempotencyKey: key });

    return NextResponse.json({ success: true, cartId, idempotencyKey: key });
  } catch (error) {
    console.error('Cart cancel error:', error);
    return NextResponse.json(
      {
        error: 'Failed to cancel cart',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
