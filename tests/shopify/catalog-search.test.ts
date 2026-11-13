// ── search_catalog request shape (mocked fetch, no live APIs) ────────────
//
// Guards the two contract mismatches found against the live UCP schema
// (2026-08-25): the saved-catalog parameter is `catalog_id` (there is no
// `saved_catalog_slug`, which the endpoint silently ignored), and
// `filters.categories` takes plain strings, not `{ id, taxonomy }` objects.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchShopifyProducts } from '@/lib/shopify';

function jsonRpcResponse(structuredContent: unknown) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { structuredContent },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function mcpCallBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('catalog.shopify.com')
  );
  expect(call).toBeDefined();
  const [, init] = call as unknown as [string, { body: string }];
  return JSON.parse(init.body);
}

describe('searchShopifyProducts request shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends catalog_id and never the unsupported saved_catalog_slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRpcResponse({ ucp: { version: '2026-08-25' }, products: [] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchShopifyProducts({
      query: 'headphones',
      catalog_id: 'gid://shopify/SavedCatalog/1',
    });

    const body = mcpCallBody(fetchMock);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('search_catalog');
    expect(body.params.arguments.catalog.catalog_id).toBe(
      'gid://shopify/SavedCatalog/1'
    );
    expect(body.params.arguments.catalog).not.toHaveProperty('saved_catalog_slug');
  });

  it('passes category filters through as plain strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRpcResponse({ ucp: { version: '2026-08-25' }, products: [] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchShopifyProducts({
      query: '',
      filters: {
        available: true,
        categories: ['Apparel & Accessories', 'Electronics'],
        price: { max: 5000 },
      },
    });

    const { catalog } = mcpCallBody(fetchMock).params.arguments;
    expect(catalog.filters.categories).toEqual([
      'Apparel & Accessories',
      'Electronics',
    ]);
    expect(catalog.filters.price).toEqual({ max: 5000 });
  });

  it('returns the structured catalog payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRpcResponse({
        ucp: { version: '2026-08-25' },
        products: [{ id: 'gid://shopify/p/ABC', title: 'Thing' }],
        pagination: { has_next_page: false },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchShopifyProducts({ query: 'thing' });

    expect(result?.products?.[0]?.title).toBe('Thing');
    expect(result?.pagination?.has_next_page).toBe(false);
  });
});
