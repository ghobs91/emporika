'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CartItem, CartContextType } from '@/types/cart';

const STORAGE_KEY = 'emporika-cart';

const CartContext = createContext<CartContextType | null>(null);

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as CartItem[];
    // Remove items older than 7 days
    const now = Date.now();
    const fresh = items.filter((item) => now - item.addedAt < 7 * 24 * 60 * 60 * 1000);
    if (fresh.length !== items.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setItems(loadCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      saveCart(items);
    }
  }, [items, hydrated]);

  const addItem = useCallback((item: Omit<CartItem, 'id' | 'addedAt'>) => {
    setItems((prev) => {
      const existing = prev.find(
        (i) => i.variantId === item.variantId && i.shopDomain === item.shopDomain
      );
      if (existing) {
        return prev.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + item.quantity,
                continueUrl: item.continueUrl,
                cartId: item.cartId,
              }
            : i
        );
      }
      const newItem: CartItem = {
        ...item,
        id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        addedAt: Date.now(),
      };
      return [...prev, newItem];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const removeMerchantItems = useCallback((shopDomain: string) => {
    setItems((prev) => prev.filter((i) => i.shopDomain !== shopDomain));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  const itemsByMerchant: Record<string, CartItem[]> = {};
  for (const item of items) {
    if (!itemsByMerchant[item.shopDomain]) {
      itemsByMerchant[item.shopDomain] = [];
    }
    itemsByMerchant[item.shopDomain].push(item);
  }

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        removeMerchantItems,
        clearCart,
        itemCount,
        itemsByMerchant,
        isOpen,
        setIsOpen,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
