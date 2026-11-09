'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import Image from 'next/image';
import {
  ProductFilters,
  FacetValue,
  RATING_OPTIONS,
  getFilterCounts,
  getCategoryFacets,
  getBrandFacets,
  getConditionFacets,
  formatPriceBucketLabel,
} from '@/lib/filters';

const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  used: 'Used',
  refurbished: 'Refurbished',
  open_box: 'Open box',
};

// Facet lists can grow with broad queries; cap rendered options so the sidebar
// stays scannable (the most common values are listed first).
const FACET_LIMIT = 15;

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
  // Bounds for the price slider, taken from the products actually in view.
  // Only finite positive prices participate; if the range collapses, the
  // section is hidden rather than rendered as 0–0.
  const priceBounds = useMemo(() => {
    const prices = products
      .map((product) => product.price)
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length === 0) return null;
    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    return max > min ? { min, max } : null;
  }, [products]);

  const priceSlider = useMemo(() => {
    if (!priceBounds) return null;
    // Clamp to the current bounds: switching retailers can shrink the range
    // below an existing filter, which would otherwise invert the handles.
    const lower = Math.min(
      Math.max(filters.minPrice ?? priceBounds.min, priceBounds.min),
      priceBounds.max
    );
    const upper = Math.max(
      Math.min(filters.maxPrice ?? priceBounds.max, priceBounds.max),
      lower
    );
    const span = priceBounds.max - priceBounds.min;
    return {
      lower,
      upper,
      span,
      // Coarser steps on wide ranges so the handles stay controllable.
      step: span > 500 ? 10 : span > 200 ? 5 : 1,
      leftPct: ((lower - priceBounds.min) / span) * 100,
      rightPct: ((upper - priceBounds.min) / span) * 100,
    };
  }, [priceBounds, filters.minPrice, filters.maxPrice]);
  const counts = useMemo(() => getFilterCounts(products), [products]);
  const categoryFacets = useMemo(() => getCategoryFacets(products), [products]);
  const brandFacets = useMemo(() => getBrandFacets(products), [products]);
  const conditionFacets = useMemo(() => getConditionFacets(products), [products]);

  const activeCount = [
    filters.minPrice !== undefined || filters.maxPrice !== undefined,
    filters.minRating !== undefined,
    filters.shippingSpeed,
    !!filters.categories?.length,
    !!filters.brands?.length,
    !!filters.conditions?.length,
  ].filter(Boolean).length;

  const allSelected =
    !!selectedSources && selectedSources.length === RETAILERS.length;

  const setPriceRange = (nextMin: number, nextMax: number) => {
    if (!priceBounds) return;
    onChange({
      ...filters,
      // Leave the filter unset while a handle rests at its bound, so the
      // active-filter chip and "clear all" behave predictably.
      minPrice: nextMin <= priceBounds.min ? undefined : nextMin,
      maxPrice: nextMax >= priceBounds.max ? undefined : nextMax,
    });
  };

  const setRating = (value: number | undefined) => {
    onChange({ ...filters, minRating: value });
  };

  const toggleFacet = (
    key: 'categories' | 'brands' | 'conditions',
    value: string
  ) => {
    const current = filters[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next.length > 0 ? next : undefined });
  };

  const renderFacetSection = (
    title: string,
    key: 'categories' | 'brands' | 'conditions',
    facets: FacetValue[],
    labelFor: (value: string) => string = (value) => value
  ) => {
    if (facets.length === 0) return null;
    const selected = filters[key] ?? [];
    return (
      <FilterSection title={title}>
        <div className="space-y-2">
          {facets.slice(0, FACET_LIMIT).map((facet) => (
            <Checkbox
              key={facet.value}
              checked={selected.includes(facet.value)}
              onChange={() => toggleFacet(key, facet.value)}
              label={labelFor(facet.value)}
              count={facet.count}
            />
          ))}
        </div>
      </FilterSection>
    );
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

      {selectedSources && onSourcesChange && (
        <FilterSection title="Retailers" defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onSourcesChange(RETAILERS.map((retailer) => retailer.source))}
              disabled={allSelected}
              aria-pressed={allSelected}
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border transition-all ${
                allSelected
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent'
                  : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              All
            </button>
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

      {renderFacetSection('Category', 'categories', categoryFacets)}

      {renderFacetSection('Brand', 'brands', brandFacets)}

      {priceSlider && priceBounds && (
        <FilterSection title="Price" defaultOpen>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400">
              <span>${priceSlider.lower.toLocaleString()}</span>
              <span>${priceSlider.upper.toLocaleString()}</span>
            </div>

            <div className="relative h-5">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-500"
                style={{
                  left: `${priceSlider.leftPct}%`,
                  right: `${100 - priceSlider.rightPct}%`,
                }}
              />
              <input
                type="range"
                aria-label="Minimum price"
                min={priceBounds.min}
                max={priceBounds.max}
                step={priceSlider.step}
                value={priceSlider.lower}
                onChange={(event) =>
                  setPriceRange(
                    Math.min(Number(event.target.value), priceSlider.upper),
                    priceSlider.upper
                  )
                }
                className="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-blue-600"
              />
              <input
                type="range"
                aria-label="Maximum price"
                min={priceBounds.min}
                max={priceBounds.max}
                step={priceSlider.step}
                value={priceSlider.upper}
                onChange={(event) =>
                  setPriceRange(
                    priceSlider.lower,
                    Math.max(Number(event.target.value), priceSlider.lower)
                  )
                }
                className="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-blue-600"
              />
            </div>
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

      {renderFacetSection('Condition', 'conditions', conditionFacets, (value) => CONDITION_LABELS[value] ?? value)}

      <FilterSection title="Shipping" defaultOpen>
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
  { source: 'backmarket', label: 'Back Market', color: 'bg-neutral-900', icon: '/backmarket-favicon.svg' },
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

  const addFacetChips = (
    key: 'categories' | 'brands' | 'conditions',
    labelFor: (value: string) => string = (value) => value
  ) => {
    for (const value of filters[key] ?? []) {
      chips.push({
        key: `${key}:${value}`,
        label: labelFor(value),
        remove: () => {
          const next = (filters[key] ?? []).filter((v) => v !== value);
          onChange({ ...filters, [key]: next.length > 0 ? next : undefined });
        },
      });
    }
  };

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

  addFacetChips('categories');
  addFacetChips('brands');
  addFacetChips('conditions', (value) => CONDITION_LABELS[value] ?? value);

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
