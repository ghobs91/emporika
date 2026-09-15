'use client';

import { useCallback, useState } from 'react';
import { useCart } from '@/context/CartContext';
import type { CartItem } from '@/types/cart';

interface MerchantCartEnvelope {
  success: boolean;
  action?: 'proceed' | 'buyer_input_required' | 'retry_or_fallback';
  cart?: {
    id: string;
    continueUrl: string;
    currency?: string;
  };
  error?: string;
}

interface MerchantCheckoutEnvelope {
  success: boolean;
  action?: 'completed' | 'canceled' | 'handoff' | 'retry_or_fallback';
  status?: string;
  checkout?: {
    id: string;
    status: string;
    continueUrl?: string | null;
    currency?: string;
    order?: { id: string; permalinkUrl?: string | null } | null;
  };
  error?: string;
}

async function postCombinedCart(
  shopDomain: string,
  merchantItems: CartItem[]
): Promise<MerchantCartEnvelope> {
  const response = await fetch('/api/shopify/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lineItems: merchantItems
        .filter((item): item is CartItem & { variantId: string } => !!item.variantId)
        .map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      shopDomain,
      context: { address_country: 'US' },
    }),
  });
  return (await response.json()) as MerchantCartEnvelope;
}

/**
 * Convert an existing Cart MCP cart into a Checkout MCP session. The merchant
 * inherits the cart's line items, context, and attribution; we only need the
 * cart id. Checkout MCP returns a `continue_url` (and, once completed, an
 * `order.permalink_url`) that we hand the buyer off to.
 */
async function postCheckoutFromCart(
  shopDomain: string,
  cartId: string
): Promise<MerchantCheckoutEnvelope> {
  const response = await fetch('/api/shopify/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopDomain, cartId }),
  });
  return (await response.json()) as MerchantCheckoutEnvelope;
}

/**
 * Shared merchant-cart + checkout flows (all scoped to one shopDomain):
 * - startCheckout: convert a Cart MCP cart into a Checkout MCP session and
 *   open its continue_url, falling back to the cart's continue_url.
 * - checkoutMerchant: create combined cart + start checkout (fallback: per-item links).
 * - refreshMerchantCart: re-create combined cart WITHOUT opening a tab and
 *   patch local refs (continueUrl/cartId). Used after quantity edits and as
 *   the recoverable-error retry path.
 * - removeMerchantCart: best-effort remote cancel per stored cartId, then
 *   drop local items regardless of upstream outcome.
 */
export function useMerchantCheckout() {
  const { itemsByMerchant, updateItem, removeMerchantItems } = useCart();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  /**
   * Hand off to Checkout MCP. Opens the checkout continue_url (or order
   * permalink when already completed); falls back to the cart continue_url if
   * Checkout MCP is unavailable for this merchant.
   */
  const startCheckout = useCallback(
    async (shopDomain: string, cartId: string, cartContinueUrl?: string) => {
      try {
        const data = await postCheckoutFromCart(shopDomain, cartId);
        const url = data.checkout?.order?.permalinkUrl || data.checkout?.continueUrl;
        if (data.success && url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return true;
        }
        console.warn(
          'Checkout MCP handoff failed, falling back to cart continue_url:',
          data.error
        );
      } catch (err) {
        console.error('Checkout MCP request failed:', err);
      }
      if (cartContinueUrl) {
        window.open(cartContinueUrl, '_blank', 'noopener,noreferrer');
      }
      return false;
    },
    []
  );

  const checkoutMerchant = useCallback(
    async (shopDomain: string) => {
      const merchantItems = itemsByMerchant[shopDomain];
      if (!merchantItems?.length || checkingOut) return;

      // Non-Shopify retailers have no Cart MCP — hand off to each product
      // page directly (the universal-cart fallback).
      const isShopify = merchantItems.every(
        (item) => (item.source ?? 'shopify') === 'shopify'
      );
      if (!isShopify) {
        for (const item of merchantItems) {
          window.open(item.continueUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      setCheckingOut(shopDomain);
      try {
        const data = await postCombinedCart(shopDomain, merchantItems);
        if (data.success && data.cart) {
          // Convert the cart into a checkout session and hand off to the
          // merchant's prefilled checkout (falls back to the cart URL).
          await startCheckout(shopDomain, data.cart.id, data.cart.continueUrl);
        } else {
          // Fallback: open each item's individual checkout
          console.warn('Combined cart failed, opening items individually:', data.error);
          for (const item of merchantItems) {
            window.open(item.continueUrl, '_blank', 'noopener,noreferrer');
          }
        }
      } catch (err) {
        console.error('Checkout all failed:', err);
        for (const item of merchantItems) {
          window.open(item.continueUrl, '_blank', 'noopener,noreferrer');
        }
      } finally {
        setCheckingOut(null);
      }
    },
    [itemsByMerchant, checkingOut, startCheckout]
  );

  const refreshMerchantCart = useCallback(
    async (shopDomain: string, items?: CartItem[]) => {
      const merchantItems = items ?? itemsByMerchant[shopDomain];
      if (!merchantItems?.length || checkingOut) return null;

      // Only Shopify merchants have a remote cart to re-sync.
      const isShopify = merchantItems.every(
        (item) => (item.source ?? 'shopify') === 'shopify'
      );
      if (!isShopify) return null;

      setCheckingOut(shopDomain);
      try {
        const data = await postCombinedCart(shopDomain, merchantItems);
        if (data.success && data.cart) {
          for (const item of merchantItems) {
            const local = itemsByMerchant[shopDomain]?.find((i) => i.variantId === item.variantId);
            if (local) {
              updateItem(local.id, {
                continueUrl: data.cart.continueUrl,
                cartId: data.cart.id,
                ...(data.cart.currency ? { currency: data.cart.currency } : {}),
              });
            }
          }
        }
        return data;
      } catch (err) {
        console.error('Cart refresh failed:', err);
        return null;
      } finally {
        setCheckingOut(null);
      }
    },
    [itemsByMerchant, checkingOut, updateItem]
  );

  const removeMerchantCart = useCallback(
    async (shopDomain: string) => {
      const merchantItems = itemsByMerchant[shopDomain];
      // Best-effort remote cancel for Shopify carts — local removal happens
      // regardless and non-Shopify items have no server cart.
      const cancellable = (merchantItems ?? []).filter(
        (item) => (item.source ?? 'shopify') === 'shopify' && item.cartId
      );
      if (cancellable.length > 0) {
        await Promise.allSettled(
          cancellable.map((item) =>
            fetch(
              `/api/shopify/cart?shopDomain=${encodeURIComponent(shopDomain)}&cartId=${encodeURIComponent(item.cartId!)}`,
              { method: 'DELETE' }
            )
          )
        );
      }
      removeMerchantItems(shopDomain);
    },
    [itemsByMerchant, removeMerchantItems]
  );

  return {
    checkingOut,
    startCheckout,
    checkoutMerchant,
    refreshMerchantCart,
    removeMerchantCart,
  };
}
