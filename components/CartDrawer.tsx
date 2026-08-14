'use client';

import { useCart } from '@/context/CartContext';
import { useMerchantCheckout } from '@/hooks/useMerchantCheckout';
import { X, Trash2, ExternalLink, ShoppingCart, Package, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect } from 'react';

export default function CartDrawer() {
  const { items, isOpen, setIsOpen, removeItem, removeMerchantItems, clearCart, itemsByMerchant } = useCart();
  const { checkingOut, checkoutMerchant } = useMerchantCheckout();

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  const merchantNames: Record<string, string> = {};
  for (const item of items) {
    if (!merchantNames[item.shopDomain]) {
      merchantNames[item.shopDomain] = item.merchantName;
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-[#1a1a1a] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <ShoppingCart size={20} className="text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Your Cart
            </h2>
            {items.length > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                ({items.reduce((s, i) => s + i.quantity, 0)} items)
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close cart"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3 px-6">
              <Package size={48} strokeWidth={1.5} />
              <p className="text-sm">Your cart is empty</p>
              <p className="text-xs text-center">
                Search for products and add them to your cart to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {Object.entries(itemsByMerchant).map(([shopDomain, merchantItems]) => (
                <div key={shopDomain} className="py-3">
                  {/* Merchant header */}
                  <div className="flex items-center justify-between px-5 mb-2">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {merchantNames[shopDomain] || shopDomain}
                    </h3>
                    <button
                      onClick={() => removeMerchantItems(shopDomain)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      Remove all
                    </button>
                  </div>

                  {/* Items */}
                  {merchantItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-[#242424] transition-colors"
                    >
                      {/* Product image */}
                      <div className="relative w-16 h-16 rounded-lg bg-gray-100 dark:bg-[#242424] overflow-hidden shrink-0">
                        {item.image && (
                          <Image
                            src={item.image}
                            alt={item.title}
                            fill
                            className="object-contain p-2"
                            sizes="64px"
                            unoptimized
                          />
                        )}
                      </div>

                      {/* Product info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {formatPrice(item.price)}
                          </span>
                          {item.quantity > 1 && (
                            <span className="text-xs text-gray-500">
                              × {item.quantity}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {/* Checkout single item */}
                        <a
                          href={item.continueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1"
                        >
                          Checkout
                          <ExternalLink size={10} />
                        </a>
                        {/* Remove */}
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Multi-item checkout button */}
                  {merchantItems.length > 1 && (
                    <div className="px-5 mt-2">
                      <button
                        onClick={() => checkoutMerchant(shopDomain)}
                        disabled={checkingOut === shopDomain}
                        className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {checkingOut === shopDomain ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            Creating combined cart…
                          </>
                        ) : (
                          <>
                            <ShoppingCart size={16} />
                            Checkout all from {merchantNames[shopDomain] || shopDomain}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 px-5 py-4 space-y-3">
            {/* Total */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Estimated total</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {formatPrice(
                  items.reduce((sum, item) => sum + item.price * item.quantity, 0)
                )}
              </span>
            </div>
            {/* Clear cart */}
            <button
              onClick={clearCart}
              className="w-full text-sm text-gray-500 hover:text-red-500 py-2 transition-colors"
            >
              Clear cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}
