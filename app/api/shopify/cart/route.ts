import { NextRequest, NextResponse } from 'next/server';
import { createShopifyCart } from '@/lib/shopify';

/**
 * POST /api/shopify/cart
 *
 * Create a cart on a Shopify merchant's store via Cart MCP.
 *
 * Single-item:
 *   Body: { variantId: string, quantity?: number, shopDomain: string, context?: {...} }
 *
 * Multi-item:
 *   Body: { lineItems: Array<{ variantId: string, quantity?: number }>, shopDomain: string, context?: {...} }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { variantId, lineItems, shopDomain, context } = body;

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
    if (hasSingleItem && !variantId.startsWith('gid://shopify/ProductVariant/')) {
      return NextResponse.json(
        { error: 'variantId must be a Shopify variant GID (gid://shopify/ProductVariant/{id})' },
        { status: 400 }
      );
    }

    // Validate GID format for multi items
    if (hasMultiItems) {
      for (const li of lineItems) {
        if (!li.variantId || !li.variantId.startsWith('gid://shopify/ProductVariant/')) {
          return NextResponse.json(
            { error: `Invalid variantId in lineItems: ${li.variantId}` },
            { status: 400 }
          );
        }
      }
    }

    const itemCount = hasMultiItems ? lineItems.length : 1;
    console.log(`Creating Shopify cart: ${itemCount} item(s), shop=${shopDomain}`);

    const cart = await createShopifyCart({
      variantId: hasSingleItem ? variantId : undefined,
      quantity: body.quantity ?? 1,
      lineItems: hasMultiItems ? lineItems : undefined,
      shopDomain,
      context: context ?? { address_country: 'US' },
    });

    if (!cart) {
      return NextResponse.json(
        { error: 'Failed to create cart — merchant may not support Cart MCP' },
        { status: 502 }
      );
    }

    // Check for business-outcome errors in the cart
    const errors = cart.messages?.filter((m) => m.type === 'error');
    const warnings = cart.messages?.filter((m) => m.type === 'warning');

    return NextResponse.json({
      success: true,
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
      errors: errors?.map((m) => ({ code: m.code, content: m.content })) || [],
      warnings: warnings?.map((m) => ({ code: m.code, content: m.content })) || [],
    });
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
