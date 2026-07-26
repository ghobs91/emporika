import { NextRequest, NextResponse } from 'next/server';
import { createShopifyCart } from '@/lib/shopify';

/**
 * POST /api/shopify/cart
 *
 * Create a cart on a Shopify merchant's store via Cart MCP.
 * Body: { variantId: string, quantity?: number, shopDomain: string, context?: { address_country?, address_region?, postal_code? } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { variantId, quantity, shopDomain, context } = body;

    if (!variantId || !shopDomain) {
      return NextResponse.json(
        { error: 'variantId and shopDomain are required' },
        { status: 400 }
      );
    }

    // Validate variantId format (should be a Shopify GID)
    if (!variantId.startsWith('gid://shopify/ProductVariant/')) {
      return NextResponse.json(
        { error: 'variantId must be a Shopify variant GID (gid://shopify/ProductVariant/{id})' },
        { status: 400 }
      );
    }

    console.log(`Creating Shopify cart: variant=${variantId}, shop=${shopDomain}`);

    const cart = await createShopifyCart({
      variantId,
      quantity: quantity ?? 1,
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
    const errors = cart.messages?.filter(
      (m) => m.type === 'error'
    );
    const warnings = cart.messages?.filter(
      (m) => m.type === 'warning'
    );

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
