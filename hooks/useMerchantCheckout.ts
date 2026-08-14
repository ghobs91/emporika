'use client';

import { useCallback, useState } from 'react';
import { useCart } from '@/context/CartContext';

/**
 * Shared "checkout all items from a merchant" flow.
 *
 * Originally implemented inside CartDrawer; extracted so the home-page
 * "In your cart" merchant cards can reuse the exact same logic:
 * 1. POST all line items to the Shopify Cart MCP endpoint.
 * 2. Open the returned combined checkout URL in a new tab.
 * 3. Fall back to individual per-item checkout URLs on failure.
 */
export function useMerchantCheckout() {
  const { itemsByMerchant } = useCart();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const checkoutMerchant = useCallback(
    async (shopDomain: string) => {
      const merchantItems = itemsByMerchant[shopDomain];
      if (!merchantItems?.length || checkingOut) return;

      setCheckingOut(shopDomain);
      try {
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

        const data = await response.json();
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

  return { checkingOut, checkoutMerchant };
}
