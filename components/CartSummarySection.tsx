'use client';

import { useCart } from '@/context/CartContext';
import { useMerchantCheckout } from '@/hooks/useMerchantCheckout';
import { Loader2, ShoppingCart } from 'lucide-react';

/**
 * Merchant-level "In your cart" summary cards for the home page.
 * Groups cart items by merchant; each card shows the merchant, estimated
 * subtotal, and a combined-checkout button (same flow as the cart drawer).
 */
export default function CartSummarySection() {
  const { itemsByMerchant, itemCount, setIsOpen } = useCart();
  const { checkingOut, checkoutMerchant } = useMerchantCheckout();

  const merchants = Object.entries(itemsByMerchant);
  if (merchants.length === 0) return null;

  return (
    <section aria-label="In your cart" className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white">
            In your cart
          </h2>
          <ShoppingCart size={20} className="text-blue-500 dark:text-blue-400" />
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          View cart ({itemCount})
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {merchants.map(([shopDomain, items]) => {
          const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
          const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
          const merchantName = items[0]?.merchantName || shopDomain;

          return (
            <div
              key={shopDomain}
              className="bg-white dark:bg-[#242424] rounded-3xl border border-gray-200 dark:border-gray-800 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              {/* Merchant logo placeholder */}
              <div
                className="w-12 h-12 rounded-2xl shrink-0 bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center font-bold text-lg"
                aria-hidden="true"
              >
                {merchantName.charAt(0).toUpperCase()}
              </div>

              {/* Merchant info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {merchantName}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {quantity} {quantity === 1 ? 'item' : 'items'} · estimated $
                  {subtotal.toFixed(2)}
                </p>
              </div>

              {/* Combined checkout */}
              <button
                type="button"
                onClick={() => checkoutMerchant(shopDomain)}
                disabled={checkingOut === shopDomain}
                className="shrink-0 w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition-colors flex items-center justify-center gap-2"
              >
                {checkingOut === shopDomain ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Opening…
                  </>
                ) : (
                  <>Continue to checkout</>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
