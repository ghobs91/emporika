import { NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { costcoAPI } from '@/lib/costco';
import {
  normalizeWalmartProduct,
  normalizeBestBuyTrendingProduct,
  normalizeTargetProduct,
  normalizeEbayProduct,
  normalizeCostcoProduct,
  UnifiedProduct,
} from '@/types/unified';
import { categorizeProduct } from '@/lib/categorize-product';

/**
 * Deals feed for the "Deals for you" carousel.
 *
 * Unlike /api/trending (which fetches one random query per retailer), this
 * fans out across several Walmart/Target/eBay/Costco categories so a single
 * category can't dominate, keeps only genuine markdowns (list price above the
 * current price), dedupes near-identical titles, and enforces per-source and
 * per-category caps before interleaving. The result is a mixed, page-wide set
 * of deals rather than a wall of one retailer's toys.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// A deal must clear both a dollar floor and a percentage floor. This filters
// out tiny cosmetics-aisle markdowns and list-price noise.
const MIN_SAVINGS = 5;
const MIN_DISCOUNT_PCT = 0.15;
const TARGET_COUNT = 24;
const MAX_PER_SOURCE = 6;
const MAX_PER_CATEGORY = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Broad, category-spanning query sets. Rotated by hour so the feed varies
// between visits without ever depending on a single category.
const WALMART_QUERIES = [
  'electronics', 'kitchen', 'home decor', 'toys', 'fashion',
  'fitness', 'beauty', 'patio & garden', 'office', 'auto',
];
const TARGET_QUERIES = ['home decor', 'electronics', 'clothing', 'sports', 'toys', 'kitchen'];
const EBAY_QUERIES = ['electronics', 'home', 'fashion', 'sporting goods', 'toys'];
const COSTCO_QUERIES = ['electronics', 'home', 'appliances', 'furniture', 'outdoor'];

interface Deal {
  product: UnifiedProduct;
  savings: number;
  pct: number;
}

let cache: { at: number; deals: UnifiedProduct[] } | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function rotate<T>(items: T[], start: number): T[] {
  if (items.length === 0) return items;
  const offset = ((start % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/** Normalized title key so near-identical listings collapse to one deal. */
function titleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 5)
    .join(' ');
}

function interleaveBySource(deals: Deal[]): Deal[] {
  const buckets = new Map<string, Deal[]>();
  for (const deal of deals) {
    const bucket = buckets.get(deal.product.source) ?? [];
    bucket.push(deal);
    buckets.set(deal.product.source, bucket);
  }

  const keys = [...buckets.keys()];
  const out: Deal[] = [];
  for (let i = 0; out.length < deals.length; i++) {
    let pushed = false;
    for (const key of keys) {
      const bucket = buckets.get(key)!;
      if (i < bucket.length) {
        out.push(bucket[i]);
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return out;
}

async function fetchCandidates(): Promise<UnifiedProduct[]> {
  const hour = new Date().getHours();
  const walmartQueries = rotate(WALMART_QUERIES, hour).slice(0, 4);
  const targetQueries = rotate(TARGET_QUERIES, hour).slice(0, 2);
  const ebayQueries = rotate(EBAY_QUERIES, hour).slice(0, 2);
  const costcoQueries = rotate(COSTCO_QUERIES, hour).slice(0, 2);

  const jobs: Array<Promise<UnifiedProduct[]>> = [
    ...walmartQueries.map((query) =>
      withTimeout(walmartAPI.searchProducts({ query, numItems: 25, sort: 'bestseller' }), 15000).then(
        (response) => (response.items || []).map(normalizeWalmartProduct)
      )
    ),
    withTimeout(bestBuyAPI.getTrendingProducts(), 15000).then((response) =>
      (response.results || []).map(normalizeBestBuyTrendingProduct)
    ),
    ...targetQueries.map((query) =>
      withTimeout(targetAPI.searchProducts({ query, count: 24 }), 15000).then((response) =>
        (response.data?.search?.products || []).map((product, index) =>
          normalizeTargetProduct(product, index)
        )
      )
    ),
    ...ebayQueries.map((query) =>
      withTimeout(
        ebayAPI.searchProducts({ q: query, limit: 24, fieldgroups: 'EXTENDED' }),
        15000
      ).then((response) => (response.itemSummaries || []).map(normalizeEbayProduct))
    ),
    ...costcoQueries.map((query) =>
      withTimeout(costcoAPI.searchProducts({ query, rows: 24 }), 15000).then((response) =>
        (response.response?.docs || []).map(normalizeCostcoProduct)
      )
    ),
  ];

  const settled = await Promise.allSettled(jobs);
  const products: UnifiedProduct[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') products.push(...result.value);
    else console.error('Deals source failed:', result.reason);
  }
  return products;
}

function selectDeals(products: UnifiedProduct[]): UnifiedProduct[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const deals: Deal[] = [];

  for (const product of products) {
    if (seenIds.has(product.id) || !product.image) continue;
    seenIds.add(product.id);

    if (!product.price || product.price <= 0) continue;
    if (!product.originalPrice || product.originalPrice <= product.price) continue;

    const savings = product.originalPrice - product.price;
    const pct = savings / product.originalPrice;
    if (savings < MIN_SAVINGS || pct < MIN_DISCOUNT_PCT) continue;

    const key = titleKey(product.name);
    if (key && seenTitles.has(key)) continue;
    if (key) seenTitles.add(key);

    deals.push({ product, savings, pct });
  }

  deals.sort((a, b) => b.savings - a.savings || b.pct - a.pct);

  const selected: Deal[] = [];
  const perSource: Record<string, number> = {};
  const perCategory: Record<string, number> = {};

  for (const deal of deals) {
    if (selected.length >= TARGET_COUNT) break;
    const source = deal.product.source;
    const category = categorizeProduct(deal.product);
    if ((perSource[source] ?? 0) >= MAX_PER_SOURCE) continue;
    if ((perCategory[category] ?? 0) >= MAX_PER_CATEGORY) continue;
    selected.push(deal);
    perSource[source] = (perSource[source] ?? 0) + 1;
    perCategory[category] = (perCategory[category] ?? 0) + 1;
  }

  // Second pass: if strict category caps left us short, fill the rest,
  // keeping the per-source cap generous but still bounded.
  if (selected.length < TARGET_COUNT) {
    const chosen = new Set(selected.map((deal) => deal.product.id));
    for (const deal of deals) {
      if (selected.length >= TARGET_COUNT) break;
      if (chosen.has(deal.product.id)) continue;
      const source = deal.product.source;
      if ((perSource[source] ?? 0) >= MAX_PER_SOURCE + 2) continue;
      selected.push(deal);
      chosen.add(deal.product.id);
      perSource[source] = (perSource[source] ?? 0) + 1;
    }
  }

  return interleaveBySource(selected).map((deal) => deal.product);
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ deals: cache.deals, count: cache.deals.length, cached: true });
  }

  try {
    const candidates = await fetchCandidates();
    const deals = selectDeals(candidates);
    cache = { at: Date.now(), deals };
    return NextResponse.json({ deals, count: deals.length });
  } catch (error) {
    console.error('Deals API error:', error);
    return NextResponse.json(
      { deals: [], count: 0, error: 'Failed to load deals' },
      { status: 200 }
    );
  }
}
