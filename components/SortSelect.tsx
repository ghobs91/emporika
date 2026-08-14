'use client';

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

export default function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <label className="flex items-center gap-2 mb-4">
      <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
        Sort by:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#242424] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer transition-all"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
