'use client';

import Link from 'next/link';
import { useCart } from '@/context/CartContext';
import { Home, LayoutGrid, ShoppingCart, Heart, User, ShoppingBag } from 'lucide-react';

const buttonBase =
  'relative w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-200';

const idleClass =
  'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-[#242424] dark:hover:text-white';

const activeClass =
  'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300';

interface DockItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  href?: string;
  onClick?: () => void;
}

function CartBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 bg-green-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * Primary navigation: a persistent left icon rail on desktop (lg+) that
 * becomes a floating liquid-glass dock at the bottom on mobile.
 */
export default function Sidebar() {
  const { itemCount, setIsOpen } = useCart();

  const scrollToCategories = () => {
    document.getElementById('trending-feed')?.scrollIntoView({ behavior: 'smooth' });
  };

  const dockItems: DockItem[] = [
    { key: 'home', label: 'Home', icon: <Home size={22} />, active: true, href: '/' },
    { key: 'categories', label: 'Categories', icon: <LayoutGrid size={22} />, onClick: scrollToCategories },
    { key: 'cart', label: 'Cart', icon: <ShoppingCart size={22} />, badge: itemCount, onClick: () => setIsOpen(true) },
    { key: 'favorites', label: 'Favorites — coming soon', icon: <Heart size={22} />, disabled: true },
    { key: 'account', label: 'Account — coming soon', icon: <User size={22} />, disabled: true },
  ];

  return (
    <>
      {/* Desktop left icon rail (lg+) */}
      <aside
        className="hidden lg:flex sticky top-0 h-screen w-20 shrink-0 flex-col items-center py-5 gap-1.5 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] z-40"
        aria-label="Primary navigation"
      >
        {/* Logo */}
        <Link
          href="/"
          className="p-1 mb-5 rounded-xl hover:opacity-75 transition-opacity cursor-pointer"
          aria-label="Emporika home"
        >
          <ShoppingBag size={26} className="text-blue-500 dark:text-blue-400" />
        </Link>

        {/* Home — active */}
        <Link
          href="/"
          title="Home"
          aria-label="Home"
          aria-current="page"
          className={`${buttonBase} ${activeClass}`}
        >
          <Home size={22} />
        </Link>

        {/* Categories */}
        <button
          type="button"
          title="Categories"
          aria-label="Browse categories"
          onClick={scrollToCategories}
          className={`${buttonBase} ${idleClass}`}
        >
          <LayoutGrid size={22} />
        </button>

        {/* Cart */}
        <button
          type="button"
          title="Cart"
          aria-label={`Cart with ${itemCount} items`}
          onClick={() => setIsOpen(true)}
          className={`${buttonBase} ${idleClass}`}
        >
          <ShoppingCart size={22} />
          {itemCount > 0 && <CartBadge count={itemCount} />}
        </button>

        {/* Favorites — placeholder */}
        <button
          type="button"
          title="Favorites — coming soon"
          aria-label="Favorites (coming soon)"
          className={`${buttonBase} ${idleClass} opacity-60 cursor-not-allowed`}
          disabled
        >
          <Heart size={22} />
        </button>

        {/* Account — placeholder */}
        <button
          type="button"
          title="Account — coming soon"
          aria-label="Account (coming soon)"
          className={`${buttonBase} ${idleClass} opacity-60 cursor-not-allowed`}
          disabled
        >
          <User size={22} />
        </button>
      </aside>

      {/* Mobile floating liquid-glass dock */}
      <nav
        aria-label="Primary navigation"
        className="lg:hidden fixed z-50 left-0 right-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] flex justify-center pointer-events-none"
      >
        <div className="pointer-events-auto flex items-center gap-1 px-2 py-2 rounded-full bg-gradient-to-b from-white/80 to-white/50 dark:from-white/15 dark:to-white/[0.06] backdrop-blur-xl backdrop-saturate-150 border border-white/70 dark:border-white/10 shadow-lg shadow-black/10 dark:shadow-black/40">
          {dockItems.map((item) => {
            const classes = `${buttonBase} ${
              item.active
                ? 'bg-blue-500/15 text-blue-600 dark:bg-blue-500/25 dark:text-blue-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
            } ${item.disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

            const content = (
              <>
                {item.icon}
                {item.badge !== undefined && item.badge > 0 && <CartBadge count={item.badge} />}
              </>
            );

            return item.href ? (
              <Link
                key={item.key}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
                className={classes}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={item.label}
                onClick={item.onClick}
                disabled={item.disabled}
                className={classes}
              >
                {content}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
