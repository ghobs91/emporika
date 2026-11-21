// ── Target PDP metadata extraction ─────────────────────────────────────
//
// Target serves a Next.js shell at `/p/-/A-<tcin>`, and it is NOT
// PerimeterX-challenged (unlike `redsky.target.com`), so it can be fetched
// server-side. What that shell contains, measured on a live page:
//
//   ✓ og:title / og:description / og:image
//   ✓ ProductDetailImageGallery  → the full Scene7 gallery
//   ✓ ratings_and_reviews        → average + count
//   ✗ price                      → the ProductDetailPrice module ships with no
//                                  module_data at all, only an
//                                  `enrichment_context` descriptor, so it is
//                                  hydrated client-side through the same
//                                  PX-blocked API. It is not in the HTML.
//   ✗ availability               → ProductDetailFulfillment ships
//                                  `three_up_sections: []`
//
// So this enriches images, titles, descriptions and ratings, and deliberately
// does not invent prices. Pure string parsing: no network, no DOM, testable.

export interface TargetProductDetails {
  tcin: string;
  title?: string;
  description?: string;
  imageUrls: string[];
  rating?: number;
  reviewCount?: number;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Decode the handful of entities Target actually emits in meta content. */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match);
}

/**
 * Read a `<meta>` value by property (or name).
 *
 * Attribute order is not guaranteed — Live Imprint emits `content` before
 * `property` — so the tag is parsed attribute by attribute rather than matched
 * positionally.
 */
export function metaContent(html: string, key: string): string | undefined {
  const tagRe = /<meta\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html)) !== null) {
    const text = tag[0];
    const nameMatch = /(?:property|name)\s*=\s*"([^"]*)"/i.exec(text);
    if (!nameMatch || nameMatch[1].toLowerCase() !== key.toLowerCase()) continue;
    const contentMatch = /content\s*=\s*"([^"]*)"/i.exec(text);
    if (contentMatch) return decodeEntities(contentMatch[1]).trim();
  }
  return undefined;
}

/**
 * Gallery images from the `ProductDetailImageGallery` module.
 *
 * Scoped to the module's slice of the document so unrelated Scene7 assets
 * (recommendation carousels, display ads) are not picked up as this product's
 * photos.
 */
export function galleryImages(html: string): string[] {
  const start = html.indexOf('"module_type":"ProductDetailImageGallery"');
  if (start === -1) return [];
  // The module's JSON is contiguous; 8k covers a large gallery comfortably.
  const slice = html.slice(start, start + 8000);
  const urls = new Set<string>();
  const re = /"url":"(https:\/\/target\.scene7\.com\/[^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) urls.add(match[1]);
  return [...urls];
}

/**
 * Parse the details worth showing on a result card.
 *
 * Returns `imageUrls: []` and undefined fields rather than throwing when the
 * page is a challenge shell, a redirect, or simply missing a module — the card
 * then renders its placeholder, which is the honest outcome.
 */
export function parseTargetProductDetails(html: string, tcin: string): TargetProductDetails {
  const title = metaContent(html, 'og:title');
  const description = metaContent(html, 'og:description');

  const gallery = galleryImages(html);
  const ogImage = metaContent(html, 'og:image');
  const imageUrls = gallery.length > 0 ? gallery : ogImage ? [ogImage] : [];

  const ratingMatch = /"ratings_and_reviews":\{"average":([0-9.]+),"count":(\d+)/.exec(html);
  const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
  const reviewCount = ratingMatch ? Number(ratingMatch[2]) : undefined;

  return {
    tcin,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    // Cap matches the browser payload schema's limit of 10.
    imageUrls: imageUrls.slice(0, 10),
    ...(rating !== undefined && Number.isFinite(rating) && rating > 0 ? { rating } : {}),
    ...(reviewCount !== undefined && Number.isFinite(reviewCount) ? { reviewCount } : {}),
  };
}
