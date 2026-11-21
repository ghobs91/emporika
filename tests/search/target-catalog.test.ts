import { describe, it, expect } from 'vitest';
import {
  parseProductUrl,
  humanizeSlug,
  parseShardLocs,
  parseSitemapIndex,
  shardName,
  diffShards,
  shardsToFetch,
  countProducts,
  normalizeEtag,
  reconcileManifest,
  type ShardManifestEntry,
  type ShardProbe,
} from '@/lib/target-catalog';

const SLUGGED =
  'https://www.target.com/p/campus-lab-university-of-arkansas-at-monticello-official-uam-boll-weevils-logo-unisex-adult-pull-over-hoodie/-/A-1000000076';
const BARE = 'https://www.target.com/p/-/A-86376363';

function probe(overrides: Partial<ShardProbe> = {}): ShardProbe {
  return {
    url: 'https://www.target.com/pdp/sitemap_00-0001.xml.gz',
    name: 'sitemap_00-0001.xml.gz',
    ok: true,
    status: 200,
    etag: 'W/"aaa"',
    lastModified: 'Thu, 19 Nov 2026 08:05:25 GMT',
    ...overrides,
  };
}

function entry(overrides: Partial<ShardManifestEntry> = {}): ShardManifestEntry {
  return {
    name: 'sitemap_00-0001.xml.gz',
    url: 'https://www.target.com/pdp/sitemap_00-0001.xml.gz',
    etag: 'W/"aaa"',
    lastModified: 'Thu, 19 Nov 2026 08:05:25 GMT',
    productCount: 23116,
    ...overrides,
  };
}

describe('parseProductUrl', () => {
  it('recovers tcin, slug and a canonical url from a published URL', () => {
    const product = parseProductUrl(SLUGGED);
    expect(product).not.toBeNull();
    expect(product!.tcin).toBe('1000000076');
    expect(product!.slug).toContain('campus-lab');
    expect(product!.url).toBe(SLUGGED);
  });

  it('accepts the bare /p/-/A- form, which has no slug', () => {
    const product = parseProductUrl(BARE);
    expect(product).toEqual({
      tcin: '86376363',
      slug: '',
      title: '',
      url: BARE,
    });
  });

  it('keeps the tcin but drops tracking junk from a URL', () => {
    const product = parseProductUrl(`${BARE}?preselect=123#specs`);
    expect(product!.tcin).toBe('86376363');
    expect(product!.url).toBe(BARE);
  });

  it('decodes an escaped slug but keeps the url percent-encoded', () => {
    const product = parseProductUrl('https://www.target.com/p/lego%20classic%20set/-/A-123');
    expect(product!.slug).toBe('lego classic set');
    expect(product!.url).toBe('https://www.target.com/p/lego%20classic%20set/-/A-123');
  });

  it('rejects everything that is not a product page', () => {
    // Search, category, and the image: namespace all appear alongside product
    // URLs in a shard and must never be admitted as products.
    expect(parseProductUrl('https://www.target.com/s?searchTerm=usb')).toBeNull();
    expect(parseProductUrl('https://www.target.com/c/electronics/-/N-5xtg6')).toBeNull();
    expect(
      parseProductUrl('https://target.scene7.com/is/image/Target/GUEST_abc')
    ).toBeNull();
    expect(parseProductUrl('https://www.target.com/p/-/A-')).toBeNull();
    expect(parseProductUrl('not a url')).toBeNull();
  });
});

describe('humanizeSlug', () => {
  it('turns separators into single spaces without changing case', () => {
    expect(humanizeSlug('lego-classic_large+set')).toBe('lego classic large set');
    expect(humanizeSlug('UAM-Boll-Weevils')).toBe('UAM Boll Weevils');
    expect(humanizeSlug('')).toBe('');
  });
});

describe('parseShardLocs', () => {
  it('reads page locs and ignores image/video namespace locs', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url>
          <loc>${SLUGGED}</loc>
          <image:loc>https://target.scene7.com/is/image/Target/GUEST_abc</image:loc>
        </url>
        <url><loc>${BARE}</loc></url>
      </urlset>`;
    expect(parseShardLocs(xml)).toEqual([SLUGGED, BARE]);
  });

  it('returns nothing for a challenge body', () => {
    expect(parseShardLocs('{"appId":"PXGWPp4wUS"}')).toEqual([]);
  });
});

describe('parseSitemapIndex', () => {
  it('keeps only shard URLs under /pdp/', () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://www.target.com/pdp/sitemap_00-0001.xml.gz</loc></sitemap>
      <sitemap><loc>https://www.target.com/sitemap_taxonomy-brand-index.xml.gz</loc></sitemap>
      <sitemap><loc>https://www.target.com/pdp/sitemap_39-0003.xml.gz</loc></sitemap>
    </sitemapindex>`;
    expect(parseSitemapIndex(xml)).toEqual([
      'https://www.target.com/pdp/sitemap_00-0001.xml.gz',
      'https://www.target.com/pdp/sitemap_39-0003.xml.gz',
    ]);
  });
});

describe('shardName', () => {
  it('reduces a shard URL to its manifest key', () => {
    expect(shardName('https://www.target.com/pdp/sitemap_00-0001.xml.gz')).toBe(
      'sitemap_00-0001.xml.gz'
    );
  });
});

describe('diffShards', () => {
  it('classifies added, changed, unchanged and removed shards', () => {
    const delta = diffShards(
      {
        'sitemap_00-0001.xml.gz': entry(),
        'sitemap_00-0002.xml.gz': entry({ name: 'sitemap_00-0002.xml.gz', etag: 'W/"old"' }),
      },
      [
        probe(),
        probe({ name: 'sitemap_00-0002.xml.gz', etag: 'W/"new"' }),
        probe({ name: 'sitemap_00-0003.xml.gz', etag: 'W/"fresh"' }),
      ]
    );
    expect(delta.unchanged.map((p) => p.name)).toEqual(['sitemap_00-0001.xml.gz']);
    expect(delta.changed.map((p) => p.name)).toEqual(['sitemap_00-0002.xml.gz']);
    expect(delta.added.map((p) => p.name)).toEqual(['sitemap_00-0003.xml.gz']);
    expect(delta.removed).toEqual([]);
  });

  it('treats a shard that stopped answering HEAD as a removal', () => {
    const delta = diffShards(
      { 'sitemap_00-0001.xml.gz': entry() },
      [probe({ ok: false, status: 404, etag: null })]
    );
    expect(delta.removed).toEqual(['sitemap_00-0001.xml.gz']);
    expect(delta.unchanged).toEqual([]);
  });

  it('treats a shard dropped from the index as a removal', () => {
    const delta = diffShards({ 'sitemap_00-0001.xml.gz': entry() }, []);
    expect(delta.removed).toEqual(['sitemap_00-0001.xml.gz']);
  });

  it('refetches rather than assuming equality when an ETag is missing', () => {
    // Target has been observed to omit validators; guessing "unchanged" there
    // would silently freeze a shard forever.
    const delta = diffShards(
      { 'sitemap_00-0001.xml.gz': entry({ etag: null }) },
      [probe({ etag: null })]
    );
    expect(delta.changed).toHaveLength(1);
    expect(delta.unchanged).toHaveLength(0);
  });

  it('downloads only added and changed shards', () => {
    const delta = diffShards(
      { 'sitemap_00-0001.xml.gz': entry(), 'sitemap_00-0002.xml.gz': entry({ name: 'sitemap_00-0002.xml.gz', etag: 'W/"old"' }) },
      [probe(), probe({ name: 'sitemap_00-0002.xml.gz', etag: 'W/"new"' })]
    );
    expect(shardsToFetch(delta).map((p) => p.name)).toEqual(['sitemap_00-0002.xml.gz']);
  });
});

describe('countProducts', () => {
  it('counts only parseable product URLs', () => {
    const xml = `<urlset>
      <url><loc>${SLUGGED}</loc></url>
      <url><loc>${BARE}</loc></url>
      <url><loc>https://www.target.com/c/electronics/-/N-5xtg6</loc></url>
    </urlset>`;
    expect(countProducts(xml)).toBe(2);
  });
});

describe('normalizeEtag', () => {
  it('drops the weak prefix so the value is client-independent', () => {
    // Node's fetch strips W/, curl keeps it, for the identical response.
    expect(normalizeEtag('W/"76101cbb"')).toBe('"76101cbb"');
    expect(normalizeEtag('"76101cbb"')).toBe('"76101cbb"');
    expect(normalizeEtag('w/"abc"')).toBe('"abc"');
  });

  it('treats a missing or empty validator as unknown, not as a match', () => {
    expect(normalizeEtag(null)).toBeNull();
    expect(normalizeEtag('')).toBeNull();
    expect(normalizeEtag('   ')).toBeNull();
  });
});

describe('reconcileManifest', () => {
  const probe = (name: string, etag: string) =>
    ({ url: `https://www.target.com/pdp/${name}`, name, ok: true, status: 200, etag, lastModified: 'x' }) as const;
  const prior = (name: string, etag: string, fetched: boolean) => ({
    name,
    url: `https://www.target.com/pdp/${name}`,
    etag,
    lastModified: 'old',
    productCount: fetched ? 10 : 0,
    fetched,
  });

  it('records the freshly observed ETag for a shard it just downloaded', () => {
    const next = reconcileManifest(
      { a: prior('a', '"old"', true) },
      [probe('a', '"new"')],
      new Set(['a']),
      new Map([['a', 12]])
    );
    expect(next.a.etag).toBe('"new"');
    expect(next.a.productCount).toBe(12);
    expect(next.a.fetched).toBe(true);
  });

  it('keeps the OLD ETag when rows are stale, so the next run refetches', () => {
    // This is the silent-staleness bug: shard rotated, we had no download
    // budget, so we still hold the old rows. Storing the new ETag here would
    // mark those rows current and they would never refresh again.
    const next = reconcileManifest(
      { a: prior('a', '"old"', true) },
      [probe('a', '"new"')],
      new Set(),
      new Map([['a', 10]])
    );
    expect(next.a.etag).toBe('"old"');
    expect(next.a.lastModified).toBe('old');
    expect(next.a.fetched).toBe(true);

    // …and the diff must still see it as changed on the following run.
    const delta = diffShards(next, [probe('a', '"new"')]);
    expect(delta.changed.map((p) => p.name)).toEqual(['a']);
  });

  it('records the observed ETag for a shard HEADed but never downloaded', () => {
    const next = reconcileManifest({}, [probe('a', '"new"')], new Set(), new Map());
    expect(next.a.etag).toBe('"new"');
    expect(next.a.fetched).toBe(false);
    expect(next.a.productCount).toBe(0);
  });

  it('drops a shard that did not answer HEAD', () => {
    const next = reconcileManifest(
      { a: prior('a', '"old"', true) },
      [{ url: 'u', name: 'a', ok: false, status: 404, etag: null, lastModified: null }],
      new Set(),
      new Map([['a', 10]])
    );
    expect(next.a).toBeUndefined();
  });
});
