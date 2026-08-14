'use client';

import { getAllCategories } from '@/types/categories';
import type { ProductCategory } from '@/types/categories';
import { Smartphone, Home, Shirt, Dumbbell, Gamepad2, type LucideIcon } from 'lucide-react';

interface CategoryPillRailProps {
  onSelect: (categoryName: string) => void;
}

type BrowseCategory = Exclude<ProductCategory, 'all'>;

const CATEGORY_STYLES: Record<BrowseCategory, { icon: LucideIcon; className: string }> = {
  electronics: {
    icon: Smartphone,
    className: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
  },
  home: {
    icon: Home,
    className: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  },
  fashion: {
    icon: Shirt,
    className: 'bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-300',
  },
  sports: {
    icon: Dumbbell,
    className: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  toys: {
    icon: Gamepad2,
    className: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300',
  },
};

/** Strip the leading emoji from category names (e.g. "📱 Electronics" → "Electronics"). */
function cleanCategoryName(name: string): string {
  return name.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}

/**
 * Horizontal, swipeable rail of category pills (shop.app-style).
 * Hidden scrollbar on all breakpoints; each pill triggers a category search.
 */
export default function CategoryPillRail({ onSelect }: CategoryPillRailProps) {
  const categories = getAllCategories().filter(
    (cat): cat is (typeof cat) & { id: BrowseCategory } => cat.id !== 'all'
  );

  return (
    <nav aria-label="Browse categories" className="mb-12">
      <div className="flex gap-5 md:gap-6 overflow-x-auto scrollbar-hide snap-x px-1 py-2">
        {categories.map((cat) => {
          const style = CATEGORY_STYLES[cat.id];
          const Icon = style.icon;
          const name = cleanCategoryName(cat.name);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(name)}
              className="group flex flex-col items-center gap-2 shrink-0 snap-start focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 rounded-2xl"
              aria-label={`Search ${name}`}
            >
              <span
                className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center shadow-sm group-hover:scale-105 group-active:scale-95 transition-transform duration-200 ${style.className}`}
              >
                <Icon size={22} strokeWidth={2} />
              </span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
