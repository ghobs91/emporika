import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  galleryImages,
  metaContent,
  parseTargetProductDetails,
} from '@/lib/target-pdp';

// Shape mirrors a live Target PDP: Live Imprint emits `content` BEFORE
// `property`, which is why positional matching would break.
const HTML = `<!DOCTYPE html><html><head>
<meta content="Reiko Wireless Charger for Apple Watch" property="og:title" data-next-head=""/>
<meta content="Read reviews and buy Reiko at Target." property="og:description" data-next-head=""/>
<meta content="https://target.scene7.com/is/image/Target/GUEST_og" property="og:image" data-next-head=""/>
<meta content="product" property="og:type" data-next-head=""/>
</head><body>
<script>{"module_type":"ProductDetailImageGallery","module_data":{"data_by_tcin":[{"tcin":"89795232","product_gallery":{"assets":[{"url":"https://target.scene7.com/is/image/Target/GUEST_a"},{"url":"https://target.scene7.com/is/image/Target/GUEST_b"}]}}]}}</script>
<script>{"module_type":"ProductDetailDisplayAd","module_data":{"img":"https://target.scene7.com/is/image/Target/AD_JUNK"}}</script>
<script>{"module_type":"ProductDetailReviewsAndQuestions","module_data":{"review_count":3,"ratings_and_reviews":{"average":3,"count":4,"distribution":{}}}}</script>
<script>{"module_type":"ProductDetailPrice","version":2,"enrichment_context":"eyJ9"}</script>
</body></html>`;

describe('decodeEntities', () => {
  it('decodes the entities Target emits in meta content', () => {
    expect(decodeEntities('Tom &amp; Jerry &quot;Set&quot; &#39;x&#39;')).toBe(
      'Tom & Jerry "Set" \'x\''
    );
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('a &unknown; b')).toBe('a &unknown; b');
  });
});

describe('metaContent', () => {
  it('finds a property whose content attribute comes first', () => {
    expect(metaContent(HTML, 'og:title')).toBe('Reiko Wireless Charger for Apple Watch');
  });

  it('matches name= as well as property=', () => {
    const html = '<meta name="og:image" content="https://x/y.jpg">';
    expect(metaContent(html, 'og:image')).toBe('https://x/y.jpg');
  });

  it('returns undefined when the tag is absent', () => {
    expect(metaContent(HTML, 'og:price:amount')).toBeUndefined();
  });

  it('does not return a different meta by prefix', () => {
    // property="og:type" must not satisfy a lookup for "og:t".
    expect(metaContent(HTML, 'og:t')).toBeUndefined();
  });
});

describe('galleryImages', () => {
  it('reads the gallery module only, ignoring other Scene7 assets', () => {
    expect(galleryImages(HTML)).toEqual([
      'https://target.scene7.com/is/image/Target/GUEST_a',
      'https://target.scene7.com/is/image/Target/GUEST_b',
    ]);
  });

  it('returns nothing when the module is missing', () => {
    expect(galleryImages('<html></html>')).toEqual([]);
  });
});

describe('parseTargetProductDetails', () => {
  it('extracts everything the shell actually contains', () => {
    const details = parseTargetProductDetails(HTML, '89795232');
    expect(details.tcin).toBe('89795232');
    expect(details.title).toBe('Reiko Wireless Charger for Apple Watch');
    expect(details.description).toMatch(/Read reviews/);
    expect(details.imageUrls).toHaveLength(2);
    expect(details.rating).toBe(3);
    expect(details.reviewCount).toBe(4);
  });

  it('never invents a price, because the shell has none', () => {
    const details = parseTargetProductDetails(HTML, '1') as unknown as Record<string, unknown>;
    expect(details.price).toBeUndefined();
    expect(details.availability).toBeUndefined();
  });

  it('falls back to og:image when the gallery module is absent', () => {
    const html = '<meta content="https://target.scene7.com/is/image/Target/GUEST_og" property="og:image"/>';
    expect(parseTargetProductDetails(html, '1').imageUrls).toEqual([
      'https://target.scene7.com/is/image/Target/GUEST_og',
    ]);
  });

  it('degrades to an empty record on a challenge shell instead of throwing', () => {
    const challenge = '{"appId":"PXGWPp4wUS","blockScript":"https://captcha.px-cdn.net/x"}';
    const details = parseTargetProductDetails(challenge, '1');
    expect(details).toEqual({ tcin: '1', imageUrls: [] });
  });

  it('caps images at the payload limit', () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `"url":"https://target.scene7.com/is/image/Target/GUEST_${i}"`
    ).join(',');
    const html = `"module_type":"ProductDetailImageGallery",${many}`;
    expect(parseTargetProductDetails(html, '1').imageUrls.length).toBe(10);
  });
});
