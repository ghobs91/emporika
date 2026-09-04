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

async function postCombinedCart(
  shopDomain: string,
  merchantItems: CartItem[]
): Promise<MerchantCartEnvelope> {
  const response = await fetch('/api/shopify/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lineItems: merchantItems.map((item) => ({
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
 * Shared merchant-cart flows (all scoped to one shopDomain):
 * - checkoutMerchant: create combined cart + open checkout (fallback: per-item links).
 * - refreshMerchantCart: re-create combined cart WITHOUT opening a tab and
 *   patch local refs (continueUrl/cartId). Used after quantity edits and as
 *   the recoverable-error retry path.
 * - removeMerchantCart: best-effort remote cancel per stored cartId, then
 *   drop local items regardless of upstream outcome.
 */
export function useMerchantCheckout() {
  const { itemsByMerchant, updateItem, removeMerchantItems } = useCart();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const checkoutMerchant = useCallback(
    async (shopDomain: string) => {
      const merchantItems = itemsByMerchant[shopDomain];
      if (!merchantItems?.length || checkingOut) return;

      setCheckingOut(shopDomain);
      try {
        const data = await postCombinedCart(shopDomain, merchantItems);
        if (data.success && data.cart?.continueUrl) {
          window.open(data.cart.continueUrl, '_blank', 'noopener,noreferrer');
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
    [itemsByMerchant, checkingOut]
  );

  const refreshMerchantCart = useCallback(
    async (shopDomain: string, items?: CartItem[]) => {
      const merchantItems = items ?? itemsByMerchant[shopDomain];
      if (!merchantItems?.length || checkingOut) return null;

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
      // Best-effort remote cancel — local removal happens regardless.
      if (merchantItems?.length) {
        await Promise.allSettled(
          merchantItems.map((item) =>
            fetch(
              `/api/shopify/cart?shopDomain=${encodeURIComponent(shopDomain)}&cartId=${encodeURIComponent(item.cartId)}`,
              { method: 'DELETE' }
            )
          )
        );
      }
      removeMerchantItems(shopDomain);
    },
    [itemsByMerchant, removeMerchantItems]
  );

  return { checkingOut, checkoutMerchant, refreshMerchantCart, removeMerchantCart };
}
