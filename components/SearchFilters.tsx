'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Star, Check } from 'lucide-react';
import Image from 'next/image';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import {
  ProductFilters,
  FacetValue,
  RATING_OPTIONS,
  RATING_PILLS,
  countActiveFilters,
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

// Facet lists grow with broad queries; show the most common values first and
// let the user expand, so the panel stays scannable.
const FACET_LIMIT = 8;

interface SearchFiltersProps {
  products: UnifiedProduct[];
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
  selectedSources?: RetailerSource[];
  onSourcesChange?: (sources: RetailerSource[]) => void;
  /** Provided by the mobile drawer; renders the sticky Reset / Done footer. */
  onClose?: () => void;
}

// ── Shared chip styles ────────────────────────────────────────────────
// Inactive chips are outlined; the active state inverts (solid, high
// contrast) so the selected set reads at a glance without a checkbox.

const PILL_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap';

const PILL_ON =
  'border-transparent bg-gray-900 text-white dark:bg-white dark:text-gray-900';

const PILL_OFF =
  'border-gray-200 bg-transparent text-gray-600 hover:border-gray-400 dark:border-[#4a4a4a] dark:text-gray-200 dark:hover:border-gray-400 dark:hover:bg-[#2c2c2c]';

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  label?: string;
}

function Pill({ active, onClick, children, count, label }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`${PILL_BASE} ${active ? PILL_ON : PILL_OFF}`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={`text-[11px] tabular-nums ${
            active
              ? 'text-white/70 dark:text-gray-900/70'
              : 'text-gray-400 dark:text-gray-400'
          }`}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

/** Flat, divider-free section: whitespace separates groups (shop.app style). */
function Section({ title, children, action }: SectionProps) {
  return (
    <section className="py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-gray-50">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

interface QuickFilter {
  key: 'onSale' | 'freeShipping' | 'availableOnline' | 'hasReviews';
  label: string;
}

const QUICK_FILTERS: QuickFilter[] = [
  { key: 'onSale', label: 'On sale' },
  { key: 'freeShipping', label: 'Free shipping' },
  { key: 'availableOnline', label: 'In stock' },
  { key: 'hasReviews', label: 'Has reviews' },
];

export default function SearchFilters({
  products,
  filters,
  onChange,
  selectedSources,
  onSourcesChange,
  onClose,
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
      // Coarser steps on wide ranges so the handles stay controllable.
      step: span > 500 ? 10 : span > 200 ? 5 : 1,
    };
  }, [priceBounds, filters.minPrice, filters.maxPrice]);

  const counts = useMemo(() => getFilterCounts(products), [products]);
  const categoryFacets = useMemo(() => getCategoryFacets(products), [products]);
  const brandFacets = useMemo(() => getBrandFacets(products), [products]);
  const conditionFacets = useMemo(() => getConditionFacets(products), [products]);

  const activeCount = countActiveFilters(filters);

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

  const resetAll = () => {
    onChange({});
    // "Reset" clears the whole panel, retailer selection included.
    if (selectedSources && onSourcesChange) {
      onSourcesChange(RETAILERS.map((retailer) => retailer.source));
    }
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-gray-200/80 bg-white dark:border-[#434343] dark:bg-[#232323] ${
        onClose ? 'shadow-2xl' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
          Filters
          {activeCount > 0 && (
            <span className="ml-2 align-middle text-xs font-medium text-gray-400 dark:text-gray-400">
              {activeCount} active
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {!onClose && activeCount > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
            >
              Reset
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-[#2a2a2a] transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
        {/* Quick toggles — the fastest way to cut a result set down */}
        <section className="pt-3 pb-4">
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map((quick) => {
              const active = !!filters[quick.key];
              const count =
                quick.key === 'onSale'
                  ? counts.onSale
                  : quick.key === 'freeShipping'
                    ? counts.freeShipping
                    : quick.key === 'availableOnline'
                      ? counts.availableOnline
                      : counts.hasReviews;
              return (
                <Pill
                  key={quick.key}
                  active={active}
                  count={count}
                  onClick={() =>
                    onChange({ ...filters, [quick.key]: active ? undefined : true })
                  }
                >
                  {quick.label}
                </Pill>
              );
            })}
          </div>
        </section>

        {/* Category — dense two-column text list for high-cardinality facets */}
        {categoryFacets.length > 0 && (
          <FacetTextList
            title="Category"
            facets={categoryFacets}
            selected={filters.categories ?? []}
            onToggle={(value) => toggleFacet('categories', value)}
          />
        )}

        {brandFacets.length > 0 && (
          <FacetTextList
            title="Brand"
            facets={brandFacets}
            selected={filters.brands ?? []}
            onToggle={(value) => toggleFacet('brands', value)}
          />
        )}

        {conditionFacets.length > 0 && (
          <Section title="Condition">
            <div className="flex flex-wrap gap-2">
              {conditionFacets.map((facet) => (
                <Pill
                  key={facet.value}
                  active={(filters.conditions ?? []).includes(facet.value)}
                  count={facet.count}
                  onClick={() => toggleFacet('conditions', facet.value)}
                >
                  {CONDITION_LABELS[facet.value] ?? facet.value}
                </Pill>
              ))}
            </div>
          </Section>
        )}

        {/* Price — range slider with editable bounds, shop.app style */}
        {priceSlider && priceBounds && (
          <Section title="Price">
            <PriceRangeSlider
              bounds={priceBounds}
              lower={priceSlider.lower}
              upper={priceSlider.upper}
              step={priceSlider.step}
              onCommit={setPriceRange}
            />
          </Section>
        )}

        {/* Ratings — single-select pills */}
        <Section title="Ratings">
          <div className="flex flex-wrap gap-2">
            {RATING_PILLS.map((option) => (
              <Pill
                key={option.label}
                active={filters.minRating === option.value}
                label={
                  option.value === undefined
                    ? 'All ratings'
                    : `${option.value} stars and up`
                }
                onClick={() => onChange({ ...filters, minRating: option.value })}
              >
                {option.value !== undefined && (
                  <Star size={11} className="fill-current" aria-hidden="true" />
                )}
                {option.label}
              </Pill>
            ))}
          </div>
        </Section>

        {/* Shipping */}
        <Section title="Shipping">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: undefined, label: 'Any' },
                { value: 'free' as const, label: 'Free' },
                { value: 'twoDay' as const, label: '2-day' },
                { value: 'twoThreeDay' as const, label: '2-3 day' },
              ] as const
            ).map((option) => {
              const count =
                option.value === 'free'
                  ? counts.freeShipping
                  : option.value === 'twoDay'
                    ? counts.twoDay
                    : option.value === 'twoThreeDay'
                      ? counts.twoThreeDay
                      : undefined;
              return (
                <Pill
                  key={option.label}
                  active={filters.shippingSpeed === option.value}
                  count={count}
                  onClick={() =>
                    onChange({ ...filters, shippingSpeed: option.value })
                  }
                >
                  {option.label}
                </Pill>
              );
            })}
          </div>
        </Section>

        {selectedSources && onSourcesChange && (
          <Section title="Stores">
            <div className="flex flex-wrap gap-2">
              <Pill
                active={allSelected}
                onClick={() =>
                  onSourcesChange(RETAILERS.map((retailer) => retailer.source))
                }
              >
                All stores
              </Pill>
              {RETAILERS.map((retailer) => {
                const active = selectedSources.includes(retailer.source);
                return (
                  <Pill
                    key={retailer.source}
                    active={active}
                    onClick={() => {
                      const next = active
                        ? selectedSources.filter((s) => s !== retailer.source)
                        : [...selectedSources, retailer.source];
                      // Never leave the result set with zero stores.
                      onSourcesChange(next.length > 0 ? next : [retailer.source]);
                    }}
                  >
                    <Image
                      src={retailer.icon}
                      alt=""
                      width={13}
                      height={13}
                      className={`rounded-sm shrink-0 ${active ? '' : 'opacity-70'}`}
                      unoptimized
                    />
                    {retailer.label}
                  </Pill>
                );
              })}
            </div>
          </Section>
        )}
      </div>

      {/* Sticky footer — mobile drawer only */}
      {onClose && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-gray-200/80 dark:border-[#434343] bg-white/95 dark:bg-[#232323]/95 backdrop-blur px-5 py-4">
          <button
            type="button"
            onClick={resetAll}
            className="flex-1 rounded-full border border-gray-200 dark:border-[#4a4a4a] px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-400 transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-gray-900 dark:bg-white px-4 py-2.5 text-sm font-semibold text-white dark:text-gray-900 hover:bg-black dark:hover:bg-gray-100 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

// ── Two-column facet text list ─────────────────────────────────────────

interface FacetTextListProps {
  title: string;
  facets: FacetValue[];
  selected: string[];
  onToggle: (value: string) => void;
}

function FacetTextList({ title, facets, selected, onToggle }: FacetTextListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? facets : facets.slice(0, FACET_LIMIT);
  const hiddenCount = facets.length - visible.length;

  return (
    <Section
      title={title}
      action={
        (hiddenCount > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
          >
            {expanded ? 'Show less' : `View ${hiddenCount} more`}
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {visible.map((facet) => {
          const active = selected.includes(facet.value);
          return (
            <button
              key={facet.value}
              type="button"
              onClick={() => onToggle(facet.value)}
              aria-pressed={active}
              title={`${facet.value} (${facet.count})`}
              className={`flex items-start gap-1 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors ${
                active
                  ? 'font-semibold text-gray-900 dark:text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-[#2c2c2c]'
              }`}
            >
              {active && <Check size={12} className="mt-[3px] shrink-0" aria-hidden="true" />}
              <span className="min-w-0 flex-1 break-words">{facet.value}</span>
              <span className="shrink-0 pt-[1px] text-[11px] tabular-nums text-gray-400 dark:text-gray-400">
                {facet.count}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ── Price range slider ────────────────────────────────────────────────

interface PriceRangeSliderProps {
  bounds: { min: number; max: number };
  lower: number;
  upper: number;
  step: number;
  onCommit: (lower: number, upper: number) => void;
}

function PriceRangeSlider({
  bounds,
  lower,
  upper,
  step,
  onCommit,
}: PriceRangeSliderProps) {
  // Dragging follows the pointer immediately in local draft state while the
  // commit (a URL write) is coalesced, so a drag doesn't push one navigation
  // per pixel. The draft re-syncs whenever the committed range changes.
  const [draft, setDraft] = useState({ lower, upper });
  const [synced, setSynced] = useState({ lower, upper });
  if (synced.lower !== lower || synced.upper !== upper) {
    setSynced({ lower, upper });
    setDraft({ lower, upper });
  }

  const pendingRef = useRef<{ lower: number; upper: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) onCommit(pending.lower, pending.upper);
  }, [onCommit]);

  const scheduleCommit = useCallback(
    (next: { lower: number; upper: number }) => {
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 160);
    },
    [flush]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const clampMin = (value: number) =>
    Math.min(Math.max(value, bounds.min), draft.upper);
  const clampMax = (value: number) =>
    Math.max(Math.min(value, bounds.max), draft.lower);

  const span = bounds.max - bounds.min;
  const leftPct = span > 0 ? ((draft.lower - bounds.min) / span) * 100 : 0;
  const rightPct = span > 0 ? ((draft.upper - bounds.min) / span) * 100 : 100;

  // Editing a bound then committing keeps the typed value honest: anything
  // outside the range snaps back to the nearest draggable value.
  const commitInput = (raw: string, kind: 'min' | 'max') => {
    const parsed = Number(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || raw.trim() === '') {
      onCommit(draft.lower, draft.upper);
      return;
    }
    if (kind === 'min') onCommit(clampMin(parsed), draft.upper);
    else onCommit(draft.lower, clampMax(parsed));
  };

  const inputClass =
    'w-full rounded-xl border border-gray-200 dark:border-[#4a4a4a] bg-transparent pl-6 pr-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:border-gray-400 dark:focus:border-gray-400 tabular-nums';

  return (
    <div className="space-y-3">
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-500"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <input
          type="range"
          aria-label="Minimum price"
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={draft.lower}
          onChange={(event) => {
            const next = {
              lower: Math.min(Number(event.target.value), draft.upper),
              upper: draft.upper,
            };
            setDraft(next);
            scheduleCommit(next);
          }}
          onPointerUp={flush}
          onKeyUp={flush}
          onBlur={flush}
          className="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-blue-600"
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={draft.upper}
          onChange={(event) => {
            const next = {
              lower: draft.lower,
              upper: Math.max(Number(event.target.value), draft.lower),
            };
            setDraft(next);
            scheduleCommit(next);
          }}
          onPointerUp={flush}
          onKeyUp={flush}
          onBlur={flush}
          className="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-blue-600"
        />
      </div>

      <div className="flex items-center gap-2">
        {(
          [
            { kind: 'min' as const, value: draft.lower },
            { kind: 'max' as const, value: draft.upper },
          ] as const
        ).map((field) => (
          <div key={field.kind} className="relative flex-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 dark:text-gray-500">
              $
            </span>
            <input
              type="text"
              inputMode="numeric"
              aria-label={
                field.kind === 'min' ? 'Minimum price value' : 'Maximum price value'
              }
              key={`${field.kind}-${field.value}-${bounds.min}-${bounds.max}`}
              defaultValue={field.value.toLocaleString()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              onBlur={(event) => commitInput(event.target.value, field.kind)}
              className={inputClass}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Active filter chips ───────────────────────────────────────────────

const RETAILERS: {
  source: RetailerSource;
  label: string;
  icon: string;
}[] = [
  { source: 'walmart', label: 'Walmart', icon: '/walmart-favicon.png' },
  { source: 'bestbuy', label: 'Best Buy', icon: '/bestbuy-favicon.png' },
  { source: 'target', label: 'Target', icon: '/target-favicon.png' },
  { source: 'ebay', label: 'eBay', icon: '/favicon-ebay.png' },
  { source: 'costco', label: 'Costco', icon: '/costco-favicon.png' },
  { source: 'shopify', label: 'Shopify', icon: '/shopify-logo.svg' },
  { source: 'backmarket', label: 'Back Market', icon: '/backmarket-favicon.svg' },
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
      className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80 dark:bg-white dark:text-gray-900"
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

  for (const quick of QUICK_FILTERS) {
    if (!filters[quick.key]) continue;
    chips.push({
      key: quick.key,
      label: quick.label,
      remove: () => onChange({ ...filters, [quick.key]: undefined }),
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
        className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}
