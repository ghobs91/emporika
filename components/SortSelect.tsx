'use client';

import { ChevronDown } from 'lucide-react';

export type SortOption = 'most-popular' | 'price-asc' | 'price-desc' | 'rating-desc';

const OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'most-popular', label: 'Most Popular' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'rating-desc', label: 'Rating: High to Low' },
];

interface SortSelectProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

/**
 * Compact sort chip for the results toolbar. Sort lives next to the results
 * rather than inside the filter panel, matching how shopping feeds expose it.
 */
export default function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="appearance-none rounded-full border border-gray-200 dark:border-[#4a4a4a] bg-white dark:bg-[#232323] py-1.5 pl-3.5 pr-8 text-[13px] font-medium text-gray-700 dark:text-gray-100 hover:border-gray-400 dark:hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer transition-colors"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 text-gray-500 dark:text-gray-400"
        aria-hidden="true"
      />
    </label>
  );
}
