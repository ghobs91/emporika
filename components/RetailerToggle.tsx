'use client';

import { RetailerSource } from '@/types/unified';

interface RetailerToggleProps {
  selected: RetailerSource[];
  onChange: (selected: RetailerSource[]) => void;
}

const RETAILERS: { source: RetailerSource; label: string; color: string; icon: string }[] = [
  { source: 'walmart', label: 'Walmart', color: 'bg-blue-600', icon: '/walmart-favicon.png' },
  { source: 'bestbuy', label: 'Best Buy', color: 'bg-yellow-500', icon: '/bestbuy-favicon.png' },
  { source: 'target', label: 'Target', color: 'bg-red-600', icon: '/target-favicon.png' },
  { source: 'ebay', label: 'eBay', color: 'bg-purple-600', icon: '/favicon-ebay.png' },
  { source: 'costco', label: 'Costco', color: 'bg-gray-600', icon: '/costco-favicon.png' },
  { source: 'shopify', label: 'Shopify', color: 'bg-green-600', icon: '/shopify-logo.svg' },
];

export default function RetailerToggle({ selected, onChange }: RetailerToggleProps) {
  const toggle = (source: RetailerSource) => {
    if (selected.includes(source)) {
      // Don't allow deselecting the last retailer
      if (selected.length <= 1) return;
      onChange(selected.filter((s) => s !== source));
    } else {
      onChange([...selected, source]);
    }
  };

  const toggleAll = () => {
    if (selected.length === RETAILERS.length) {
      // Keep at least one (first)
      onChange([RETAILERS[0].source]);
    } else {
      onChange(RETAILERS.map((r) => r.source));
    }
  };

  const allSelected = selected.length === RETAILERS.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={toggleAll}
        className={`px-2 py-1 text-xs font-medium rounded-full transition-all duration-150 border ${
          allSelected
            ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
            : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-500'
        }`}
      >
        {allSelected ? 'All' : `${selected.length}/${RETAILERS.length}`}
      </button>

      {RETAILERS.map(({ source, label, color }) => {
        const active = selected.includes(source);
        return (
          <button
            key={source}
            type="button"
            onClick={() => toggle(source)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full transition-all duration-150 border ${
              active
                ? `${color} text-white border-transparent shadow-sm`
                : 'bg-transparent text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-current opacity-60" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
