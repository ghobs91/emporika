'use client';

import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/context/CartContext';

export default function CartIcon() {
  const { itemCount, setIsOpen } = useCart();

  return (
    <button
      onClick={() => setIsOpen(true)}
      className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label={`Cart with ${itemCount} items`}
    >
      <ShoppingCart size={20} className="text-gray-700 dark:text-gray-300" />
      {itemCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-green-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center leading-none">
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      )}
    </button>
  );
}
