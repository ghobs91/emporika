'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import Image from 'next/image';
import {
  ProductFilters,
  PRICE_BUCKETS,
  RATING_OPTIONS,
  getAvailablePriceBuckets,
  getFilterCounts,
  formatPriceBucketLabel,
} from '@/lib/filters';

interface SearchFiltersProps {
  products: UnifiedProduct[];
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
  selectedSources?: RetailerSource[];
  onSourcesChange?: (sources: RetailerSource[]) => void;
}

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: FilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 py-4 last:border-b-0 first:pt-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between text-sm font-semibold text-gray-900 dark:text-white"
      >
        {title}
        {isOpen ? (
          <ChevronUp size={16} className="text-gray-500 dark:text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-500 dark:text-gray-400" />
        )}
      </button>
      {isOpen && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
}

function Checkbox({ checked, onChange, label, count }: CheckboxProps) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer group">
      <span className="flex items-center gap-2 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500/50 bg-white dark:bg-[#1a1a1a] shrink-0"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white truncate">
          {label}
        </span>
      </span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          {count.toLocaleString()}
        </span>
      )}
    </label>
  );
}

export default function SearchFilters({
  products,
  filters,
  onChange,
  selectedSources,
  onSourcesChange,
}: SearchFiltersProps) {
  const availableBuckets = useMemo(
    () => getAvailablePriceBuckets(products),
    [products]
  );
  const counts = useMemo(() => getFilterCounts(products), [products]);

  const activeCount = [
    filters.minPrice !== undefined || filters.maxPrice !== undefined,
    filters.minRating !== undefined,
    filters.onSale,
    filters.freeShipping,
    filters.availableOnline,
    filters.hasReviews,
    filters.shippingSpeed,
  ].filter(Boolean).length;

  const togglePriceBucket = (bucket: (typeof PRICE_BUCKETS)[number]) => {
    const isActive =
      filters.minPrice === bucket.min && filters.maxPrice === bucket.max;
    onChange({
      ...filters,
      minPrice: isActive ? undefined : bucket.min,
      maxPrice: isActive ? undefined : bucket.max,
    });
  };

  const setRating = (value: number | undefined) => {
    onChange({ ...filters, minRating: value });
  };

  const toggleBoolean = (key: keyof ProductFilters) => {
    onChange({ ...filters, [key]: !filters[key] });
  };

  const clearAll = () => {
    onChange({});
  };

  return (
    <div className="bg-white dark:bg-[#242424] rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <SlidersHorizontal size={16} />
          Filters
        </h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Clear all
          </button>
        )}
      </div>

      {availableBuckets.length > 0 && (
        <FilterSection title="Price" defaultOpen>
          <div className="space-y-2">
            {availableBuckets.map((bucket) => (
              <Checkbox
                key={bucket.label}
                checked={
                  filters.minPrice === bucket.min &&
                  filters.maxPrice === bucket.max
                }
                onChange={() => togglePriceBucket(bucket)}
                label={bucket.label}
              />
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title="Customer Rating" defaultOpen>
        <div className="space-y-2">
          {RATING_OPTIONS.map((option) => (
            <label
              key={option.label}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="radio"
                name="rating"
                checked={filters.minRating === option.value}
                onChange={() => setRating(option.value)}
                className="border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500/50 bg-white dark:bg-[#1a1a1a]"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Deals & Shipping" defaultOpen>
        <div className="space-y-2">
          <Checkbox
            checked={!!filters.onSale}
            onChange={() => toggleBoolean('onSale')}
            label="On sale"
            count={counts.onSale}
          />
          <Checkbox
            checked={!!filters.freeShipping}
            onChange={() => toggleBoolean('freeShipping')}
            label="Free shipping"
            count={counts.freeShipping}
          />
          <Checkbox
            checked={!!filters.availableOnline}
            onChange={() => toggleBoolean('availableOnline')}
            label="Available online"
            count={counts.availableOnline}
          />
          <Checkbox
            checked={!!filters.hasReviews}
            onChange={() => toggleBoolean('hasReviews')}
            label="Has reviews"
            count={counts.hasReviews}
          />
        </div>
      </FilterSection>

      <FilterSection title="Shipping Speed" defaultOpen>
        <div className="space-y-2">
          {[
            { value: undefined, label: 'Any speed' as const },
            { value: 'free' as const, label: 'Free shipping', count: counts.freeShipping },
            { value: 'twoDay' as const, label: '2-day shipping', count: counts.twoDay },
            { value: 'twoThreeDay' as const, label: '2-3 day shipping', count: counts.twoThreeDay },
          ].map((option) => (
            <label
              key={option.label}
              className="flex items-center justify-between gap-2 cursor-pointer group"
            >
              <span className="flex items-center gap-2 min-w-0">
                <input
                  type="radio"
                  name="shippingSpeed"
                  checked={filters.shippingSpeed === option.value}
                  onChange={() => onChange({ ...filters, shippingSpeed: option.value })}
                  className="border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500/50 bg-white dark:bg-[#1a1a1a]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white">
                  {option.label}
                </span>
              </span>
              {option.count !== undefined && option.count > 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {option.count.toLocaleString()}
                </span>
              )}
            </label>
          ))}
        </div>
      </FilterSection>

      {selectedSources && onSourcesChange && (
        <FilterSection title="Retailers" defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            {RETAILERS.map((retailer) => {
              const active = selectedSources.includes(retailer.source);
              return (
                <button
                  key={retailer.source}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? selectedSources.filter((s) => s !== retailer.source)
                      : [...selectedSources, retailer.source];
                    onSourcesChange(next.length > 0 ? next : [retailer.source]);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? `${retailer.color} text-white border-transparent`
                      : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <Image
                    src={retailer.icon}
                    alt={retailer.label}
                    width={12}
                    height={12}
                    className={`rounded-sm ${active ? '' : 'opacity-60'}`}
                    unoptimized
                  />
                  {retailer.label}
                </button>
              );
            })}
          </div>
        </FilterSection>
      )}
    </div>
  );
}

const RETAILERS: { source: RetailerSource; label: string; color: string; icon: string }[] = [
  { source: 'walmart', label: 'Walmart', color: 'bg-blue-600', icon: '/walmart-favicon.png' },
  { source: 'bestbuy', label: 'Best Buy', color: 'bg-yellow-500', icon: '/bestbuy-favicon.png' },
  { source: 'target', label: 'Target', color: 'bg-red-600', icon: '/target-favicon.png' },
  { source: 'ebay', label: 'eBay', color: 'bg-purple-600', icon: '/favicon-ebay.png' },
  { source: 'costco', label: 'Costco', color: 'bg-gray-600', icon: '/costco-favicon.png' },
  { source: 'shopify', label: 'Shopify', color: 'bg-green-600', icon: '/shopify-logo.svg' },
];

interface ActiveFilterChipProps {
  label: string;
  onRemove: () => void;
}

export function ActiveFilterChip({ label, onRemove }: ActiveFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
    >
      {label}
      <X size={12} />
    </button>
  );
}

interface ActiveFiltersProps {
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
}

export function ActiveFilters({ filters, onChange }: ActiveFiltersProps) {
  const chips: { key: string; label: string; remove: () => void }[] = [];

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    chips.push({
      key: 'price',
      label: formatPriceBucketLabel(filters.minPrice, filters.maxPrice),
      remove: () =>
        onChange({ ...filters, minPrice: undefined, maxPrice: undefined }),
    });
  }

  if (filters.minRating !== undefined) {
    const option = RATING_OPTIONS.find((o) => o.value === filters.minRating);
    chips.push({
      key: 'rating',
      label: option?.label || `${filters.minRating}★ & up`,
      remove: () => onChange({ ...filters, minRating: undefined }),
    });
  }

  if (filters.onSale) {
    chips.push({
      key: 'onSale',
      label: 'On sale',
      remove: () => onChange({ ...filters, onSale: false }),
    });
  }

  if (filters.freeShipping) {
    chips.push({
      key: 'freeShipping',
      label: 'Free shipping',
      remove: () => onChange({ ...filters, freeShipping: false }),
    });
  }

  if (filters.availableOnline) {
    chips.push({
      key: 'availableOnline',
      label: 'Available online',
      remove: () => onChange({ ...filters, availableOnline: false }),
    });
  }

  if (filters.hasReviews) {
    chips.push({
      key: 'hasReviews',
      label: 'Has reviews',
      remove: () => onChange({ ...filters, hasReviews: false }),
    });
  }

  if (filters.shippingSpeed) {
    const labels: Record<string, string> = {
      free: 'Free shipping',
      twoDay: '2-day shipping',
      twoThreeDay: '2-3 day shipping',
    };
    chips.push({
      key: 'shippingSpeed',
      label: labels[filters.shippingSpeed] || filters.shippingSpeed,
      remove: () => onChange({ ...filters, shippingSpeed: undefined }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {chips.map((chip) => (
        <ActiveFilterChip key={chip.key} label={chip.label} onRemove={chip.remove} />
      ))}
      <button
        type="button"
        onClick={() => onChange({})}
        className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
      >
        Clear all
      </button>
    </div>
  );
}
