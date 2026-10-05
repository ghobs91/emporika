import { NextRequest, NextResponse } from 'next/server';
import { walmartAPI } from '@/lib/walmart';
import { bestBuyAPI } from '@/lib/bestbuy';
import { targetAPI } from '@/lib/target';
import { ebayAPI } from '@/lib/ebay';
import { costcoAPI } from '@/lib/costco';
import { searchShopifyProducts, convertShopifyToUnified } from '@/lib/shopify';
import {
  normalizeWalmartProduct,
  normalizeBestBuyProduct,
  normalizeTargetProduct,
  normalizeEbayProduct,
  normalizeCostcoProduct,
  UnifiedProduct,
  RetailerSource,
} from '@/types/unified';
import type { ProductCategory } from '@/types/categories';
import { categorizeProduct } from '@/lib/categorize-product';

/**
 * Curated browse feed behind the /explore page.
 *
 * Unlike /api/search (which needs a shopper query), this fans out a small set
 * of category queries to the requested retailer(s), so a retailer-only or
 * category-only explore page has something meaningful to show. If `source` is
 * omitted every retailer is queried; if `merchant`/`merchantDomain` are given
 * the results are narrowed to that Shopify storefront.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALL_SOURCES: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];
const VALID_CATEGORIES: ProductCategory[] = ['electronics', 'home', 'fashion', 'sports', 'toys', 'all'];
const MAX_RESULTS = 60;
const QUERIES_PER_SOURCE = 2;

const CATEGORY_QUERIES: Record<ProductCategory, string[]> = {
  electronics: ['headphones', 'laptop', 'smart tv', 'tablet', 'gaming console'],
  home: ['kitchen', 'home decor', 'furniture', 'vacuum', 'coffee maker'],
  fashion: ['shoes', 'sneakers', 'jacket', 'handbag', 'sunglasses'],
  sports: ['fitness', 'running shoes', 'yoga mat', 'bike', 'camping gear'],
  toys: ['toys', 'lego', 'board games', 'action figures', 'puzzles'],
  all: ['headphones', 'kitchen', 'shoes', 'fitness', 'toys', 'home decor'],
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function parseSource(param: string | null): RetailerSource | undefined {
  if (!param) return undefined;
  const normalized = param.trim().toLowerCase();
  return ALL_SOURCES.includes(normalized as RetailerSource)
    ? (normalized as RetailerSource)
    : undefined;
}

function parseCategory(param: string | null): ProductCategory | undefined {
  if (!param) return undefined;
  const normalized = param.trim().toLowerCase();
  return VALID_CATEGORIES.includes(normalized as ProductCategory)
    ? (normalized as ProductCategory)
    : undefined;
}

interface SourceParams {
  source: RetailerSource;
  queries: string[];
  merchantDomain?: string;
}

async function fetchFromSource({ source, queries, merchantDomain }: SourceParams): Promise<UnifiedProduct[]> {
  switch (source) {
    case 'walmart': {
      const results = await Promise.allSettled(
        queries.map((query) =>
          withTimeout(walmartAPI.searchProducts({ query, numItems: 24, sort: 'bestseller' }), 15000)
        )
      );
      return results.flatMap((result) =>
        result.status === 'fulfilled'
          ? (result.value.items || []).map(normalizeWalmartProduct)
          : []
      );
    }
    case 'bestbuy': {
      const results = await Promise.allSettled(
        queries.map((query) => withTimeout(bestBuyAPI.searchProducts({ query, pageSize: 24 }), 15000))
      );
      return results.flatMap((result) =>
        result.status === 'fulfilled'
          ? (result.value.products || []).map(normalizeBestBuyProduct)
          : []
      );
    }
    case 'target': {
      const results = await Promise.allSettled(
        queries.map((query) => withTimeout(targetAPI.searchProducts({ query, count: 24 }), 15000))
      );
      return results.flatMap((result) =>
        result.status === 'fulfilled'
          ? (result.value.data?.search?.products || []).map((product, index) =>
              normalizeTargetProduct(product, index)
            )
          : []
      );
    }
    case 'ebay': {
      const results = await Promise.allSettled(
        queries.map((query) =>
          withTimeout(ebayAPI.searchProducts({ q: query, limit: 24, fieldgroups: 'EXTENDED' }), 15000)
        )
      );
      return results.flatMap((result) =>
        result.status === 'fulfilled'
          ? (result.value.itemSummaries || []).map(normalizeEbayProduct)
          : []
      );
    }
    case 'costco': {
      const results = await Promise.allSettled(
        queries.map((query) => withTimeout(costcoAPI.searchProducts({ query, rows: 24 }), 15000))
      );
      return results.flatMap((result) =>
        result.status === 'fulfilled'
          ? (result.value.response?.docs || []).map(normalizeCostcoProduct)
          : []
      );
    }
    case 'shopify': {
      const runSearch = (query: string, shops?: string[]) =>
        searchShopifyProducts({
          query,
          filters: {
            ships_to: { country: 'US' },
            available: true,
            ...(shops ? { shops } : {}),
          },
          pagination: { limit: 50 },
          context: { address_country: 'US' },
        });

      const results = await Promise.allSettled(
        queries.map(async (query) => {
          if (merchantDomain) {
            try {
              const scoped = await withTimeout(runSearch(query, [merchantDomain]), 15000);
              if (scoped?.products?.length) return convertShopifyToUnified(scoped.products);
            } catch {
              // Fall through to the unscoped search below.
            }
          }
          try {
            const global = await withTimeout(runSearch(query), 15000);
            return convertShopifyToUnified(global?.products ?? []);
          } catch {
            return [] as UnifiedProduct[];
          }
        })
      );
      return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    }
    default:
      return [];
  }
}

function titleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 5)
    .join(' ');
}

function dedupe(products: UnifiedProduct[]): UnifiedProduct[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const out: UnifiedProduct[] = [];
  for (const product of products) {
    if (seenIds.has(product.id)) continue;
    const key = titleKey(product.name);
    if (key && seenTitles.has(key)) continue;
    seenIds.add(product.id);
    if (key) seenTitles.add(key);
    out.push(product);
  }
  return out;
}

function interleaveBySource(products: UnifiedProduct[]): UnifiedProduct[] {
  const buckets = new Map<string, UnifiedProduct[]>();
  for (const product of products) {
    const bucket = buckets.get(product.source) ?? [];
    bucket.push(product);
    buckets.set(product.source, bucket);
  }
  const keys = [...buckets.keys()];
  const out: UnifiedProduct[] = [];
  for (let i = 0; out.length < products.length; i++) {
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

/**
 * Round-robin across inferred product categories. A retailer-only browse
 * otherwise front-loads whichever category query happened to return first
 * (e.g. a wall of earbuds), so this mixes product types while preserving the
 * relative order within each category.
 */
function diversifyByCategory(products: UnifiedProduct[]): UnifiedProduct[] {
  const buckets = new Map<string, UnifiedProduct[]>();
  for (const product of products) {
    const category = categorizeProduct(product);
    const bucket = buckets.get(category) ?? [];
    bucket.push(product);
    buckets.set(category, bucket);
  }
  const keys = [...buckets.keys()];
  const out: UnifiedProduct[] = [];
  for (let i = 0; out.length < products.length; i++) {
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const source = parseSource(searchParams.get('source'));
  const category = parseCategory(searchParams.get('category'));
  const merchant = searchParams.get('merchant')?.trim() || undefined;
  const merchantDomain = searchParams.get('merchantDomain')?.trim() || undefined;
  const query = searchParams.get('q')?.trim() || undefined;

  const queries = (
    query ? [query] : CATEGORY_QUERIES[category ?? 'all']
  ).slice(0, source ? 3 : QUERIES_PER_SOURCE);
  const sources = source ? [source] : ALL_SOURCES;

  try {
    const results = await Promise.all(
      sources.map((s) =>
        fetchFromSource({ source: s, queries, merchantDomain: s === 'shopify' ? merchantDomain : undefined })
      )
    );

    let products = results.flat();
    if (source) products = products.filter((product) => product.source === source);

    if (merchant || merchantDomain) {
      const merchantLower = merchant?.toLowerCase();
      const domainLower = merchantDomain?.toLowerCase();
      products = products.filter((product) => {
        if (product.source !== 'shopify') return false;
        const nameMatch = !!merchantLower && product.sellerName?.toLowerCase().includes(merchantLower);
        const domainMatch = !!domainLower && product.sellerDomain?.toLowerCase() === domainLower;
        return nameMatch || domainMatch;
      });
    }

    products = diversifyByCategory(interleaveBySource(dedupe(products))).slice(0, MAX_RESULTS);

    return NextResponse.json({
      products,
      count: products.length,
      source,
      category: category ?? 'all',
      merchant,
    });
  } catch (error) {
    console.error('Explore API error:', error);
    return NextResponse.json(
      { products: [], count: 0, error: 'Failed to load products' },
      { status: 200 }
    );
  }
}
