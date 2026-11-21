'use client';

import { RetailerSource } from '@/types/unified';
import { isProviderDisabled } from '@/search/providers/availability';
import Image from 'next/image';

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
  { source: 'backmarket', label: 'Back Market', color: 'bg-neutral-900', icon: '/backmarket-favicon.svg' },
];

/** Retailers offered in the picker — disabled ones are not selectable. */
const ENABLED_RETAILERS = RETAILERS.filter(({ source }) => !isProviderDisabled(source));
const ENABLED_IDS = ENABLED_RETAILERS.map(({ source }) => source);

export default function RetailerToggle({ selected, onChange }: RetailerToggleProps) {
  // A stale link or previous state can still name a disabled retailer; drop it
  // so it never inflates the counts or survives a toggle.
  const selectedEnabled = selected.filter((source) => ENABLED_IDS.includes(source));
  const allSelected =
    ENABLED_RETAILERS.length > 0 &&
    ENABLED_RETAILERS.every(({ source }) => selectedEnabled.includes(source));

  const toggle = (source: RetailerSource) => {
    // If all retailers are currently selected, first tap narrows to just that one
    if (allSelected) {
      onChange([source]);
      return;
    }
    if (selectedEnabled.includes(source)) {
      // Don't allow deselecting the last retailer
      if (selectedEnabled.length <= 1) return;
      onChange(selectedEnabled.filter((s) => s !== source));
    } else {
      onChange([...selectedEnabled, source]);
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      // Keep at least one (first)
      onChange([ENABLED_IDS[0]]);
    } else {
      onChange(ENABLED_IDS);
    }
  };

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
        {allSelected ? 'All' : `${selectedEnabled.length}/${ENABLED_RETAILERS.length}`}
      </button>

      {ENABLED_RETAILERS.map(({ source, label, color, icon }) => {
        const active = selectedEnabled.includes(source);
        return (
          <button
            key={source}
            type="button"
            onClick={() => toggle(source)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-all duration-150 border ${
              active
                ? `${color} text-white border-transparent shadow-sm`
                : 'bg-transparent text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            <Image
              src={icon}
              alt={label}
              width={14}
              height={14}
              className={`rounded-sm ${!active ? 'opacity-50' : ''}`}
              unoptimized
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
