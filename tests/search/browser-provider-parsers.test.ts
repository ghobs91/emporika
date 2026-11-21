// ── Extension parser → wire-contract conformance ───────────────────────
//
// The extension fetches Target and Costco in the user's browser; the server
// trusts none of it. The single most dangerous failure mode is silent drift
// between what a provider module emits and what `browserProviderPayloadSchema`
// accepts: `.strict()` rejects the *entire batch* over one unexpected key, so a
// parser change could empty a retailer without any error surfacing.
//
// These tests run the real provider parsers (the same modules the service
// worker imports) against fixtures shaped like the responses documented in
// `types/target.ts` and Costco's own `keyword_search_api_service_config`, then
// push the output through the actual server schema. No network, no WebGPU — per
// the repo's test policy.

import { describe, expect, it } from 'vitest';
import { browserProviderPayloadSchema } from '@/search/browser-providers';
import { parseResponse as parseTarget } from '@/extension/src/providers/target.js';
import {
  extractResults as extractCostcoResults,
  parseResponse as parseCostco,
} from '@/extension/src/providers/costco.js';

// ── Fixtures ───────────────────────────────────────────────────────────

const targetResponse = {
  data: {
    search: {
      total: 2,
      products: [
        {
          tcin: '1010046012',
          item: {
            product_description: { title: 'Anker USB-C Cable, 6ft' },
            primary_brand: { name: 'Anker' },
            enrichment: {
              images: { primary_image_url: 'https://target.scene7.com/is/image/Target/1010046012' },
            },
            product_classification: { product_type_name: 'USB Cables' },
          },
          price: { current_retail: 12.99, reg_retail: 19.99 },
          ratings_and_reviews: {
            statistics: { rating: { average: 4.7, count: 812 } },
          },
          fulfillment: {
            shipping_options: { availability_status: 'IN_STOCK' },
          },
        },
        {
          // No price → must be dropped, never emitted as $0.
          tcin: '1010046013',
          item: { product_description: { title: 'No price listing' } },
        },
      ],
    },
  },
};

/** Costco GRS projection: `{ results: [{ product: {...} }] }`. */
const costcoResponse = {
  results: [
    {
      product: {
        id: '1646545',
        title: 'Anker USB-C to USB-C Cable, 2-pack',
        brands: ['Anker'],
        categories: ['Electronics'],
        images: ['https://www.costco.com/wcsstore/a.jpg'],
        priceInfo: { price: 17.99, originalPrice: 24.99, currencyCode: 'USD' },
        availability: 'IN_STOCK',
        uri: 'https://www.costco.com/anker-usb-c-cable.product.1646545.html',
      },
    },
    {
      // No price → dropped.
      product: { id: '999', title: 'No price' },
    },
    {
      // No title (`name` is a resource path in GRS, not a display name) → dropped.
      product: { id: '998', name: 'projects/p/locations/l/catalogs/default_catalog', priceInfo: { price: 5 } },
    },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────

/** Push a parser's output through the exact schema the API validates with. */
function assertWireValid(providerId: 'target' | 'costco', products: unknown[]) {
  const parsed = browserProviderPayloadSchema.safeParse({
    providerId,
    query: 'usb cable',
    products,
  });
  if (!parsed.success) {
    throw new Error(
      `${providerId} payload rejected by the wire schema:\n${JSON.stringify(parsed.error.issues, null, 2)}`
    );
  }
  return parsed.data;
}

// ── Target ─────────────────────────────────────────────────────────────

describe('target provider parser', () => {
  const products = parseTarget(targetResponse);

  it('parses only complete products', () => {
    expect(products).toHaveLength(1);
    expect(products[0].providerProductId).toBe('target-1010046012');
  });

  it('emits a payload the server schema accepts', () => {
    const payload = assertWireValid('target', products);
    expect(payload.products).toHaveLength(1);
  });

  it('maps the fields entity resolution and ranking depend on', () => {
    const [product] = products;
    expect(product.title).toBe('Anker USB-C Cable, 6ft');
    expect(product.brand).toBe('Anker');
    expect(product.price).toEqual({ amount: 12.99, currency: 'USD' });
    // 19.99 > 12.99, so it is a genuine list price.
    expect(product.listPrice).toEqual({ amount: 19.99, currency: 'USD' });
    expect(product.condition).toBe('new');
    expect(product.availability).toBe('in_stock');
    expect(product.productUrl).toBe('https://www.target.com/p/-/A-1010046012');
    expect(product.rating).toBe(4.7);
    expect(product.reviewCount).toBe(812);
    expect(product.category).toBe('USB Cables');
  });

  it('never emits an unparseable page as products', () => {
    expect(parseTarget(null)).toEqual([]);
    expect(parseTarget({ data: { search: { products: 'nope' } } })).toEqual([]);
    // A PerimeterX challenge is JSON but has no product array.
    expect(parseTarget({ appId: 'PXGWPp4wUS', blockScript: 'https://captcha.px-cdn.net/x' })).toEqual([]);
  });

  it('never reports a list price below the current price', () => {
    const withRegLower = parseTarget({
      data: {
        search: {
          products: [
            {
              ...targetResponse.data.search.products[0],
              price: { current_retail: 20, reg_retail: 10 },
            },
          ],
        },
      },
    });
    expect(withRegLower[0].listPrice).toBeUndefined();
  });

  it('reports unknown availability instead of guessing in_stock', () => {
    const noFulfillment = parseTarget({
      data: {
        search: {
          products: [
            {
              ...targetResponse.data.search.products[0],
              fulfillment: undefined,
            },
          ],
        },
      },
    });
    expect(noFulfillment[0].availability).toBe('unknown');
  });
});

// ── Costco (GRS) ───────────────────────────────────────────────────────

describe('costco provider parser', () => {
  const products = parseCostco(costcoResponse);

  it('parses only results with a title and a price', () => {
    expect(products).toHaveLength(1);
    expect(products[0].providerProductId).toBe('1646545');
  });

  it('emits a payload the server schema accepts', () => {
    const payload = assertWireValid('costco', products);
    expect(payload.products).toHaveLength(1);
  });

  it('maps the fields entity resolution and ranking depend on', () => {
    const [product] = products;
    expect(product.title).toBe('Anker USB-C to USB-C Cable, 2-pack');
    expect(product.brand).toBe('Anker');
    expect(product.category).toBe('Electronics');
    expect(product.price).toEqual({ amount: 17.99, currency: 'USD' });
    expect(product.listPrice).toEqual({ amount: 24.99, currency: 'USD' });
    expect(product.condition).toBe('new');
    expect(product.availability).toBe('in_stock');
    // A GRS `uri` is authoritative, so it wins over the constructed URL.
    expect(product.productUrl).toBe(
      'https://www.costco.com/anker-usb-c-cable.product.1646545.html'
    );
    expect(product.imageUrls).toEqual(['https://www.costco.com/wcsstore/a.jpg']);
  });

  it('rejects a GRS resource path as a display title', () => {
    // `name` is `projects/…/products/…`; using it would put a URL in the UI.
    const parsed = parseCostco({
      results: [
        {
          product: {
            id: '1',
            name: 'projects/123/locations/global/catalogs/default_catalog',
            priceInfo: { price: 9.99 },
          },
        },
      ],
    });
    expect(parsed).toEqual([]);
  });

  it('derives the product URL from the id when no uri is present', () => {
    const parsed = parseCostco({
      results: [{ product: { id: '1646545', title: 'Cable', priceInfo: { price: 10 } } }],
    });
    expect(parsed[0].productUrl).toBe('https://www.costco.com/.product.1646545.html');
  });

  it('tolerates the envelope the Costco wrapper may add', () => {
    // The wrapper's exact nesting was not observable from a server, so the
    // parser probes several placements rather than assuming one.
    const shapes = [
      { results: costcoResponse.results },
      { data: { results: costcoResponse.results } },
      { items: costcoResponse.results },
      { data: { items: costcoResponse.results } },
      { searchResult: { results: costcoResponse.results } },
    ];
    for (const shape of shapes) {
      expect(extractCostcoResults(shape)).toHaveLength(3);
      expect(parseCostco(shape)).toHaveLength(1);
    }
  });

  it('never emits an unparseable response as products', () => {
    expect(parseCostco(null)).toEqual([]);
    expect(parseCostco({})).toEqual([]);
    expect(parseCostco({ results: 'nope' })).toEqual([]);
    // Kasada (429) and the retired Lucidworks host (403) both return no JSON.
    expect(parseCostco({ response: { numFound: 0, docs: [] } })).toEqual([]);
  });

  it('does not report a list price below the current price', () => {
    const parsed = parseCostco({
      results: [
        {
          product: {
            id: '1',
            title: 'Cable',
            priceInfo: { price: 20, originalPrice: 10, currencyCode: 'USD' },
          },
        },
      ],
    });
    expect(parsed[0].listPrice).toBeUndefined();
  });
});
