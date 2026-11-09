// ── Back Market ───────────────────────────────────────────────────────
//
// Back Market is a Nuxt (Vue) app served from front-office.statics.backmarket.com.
// Its search results ARE server-rendered, and each card is explicitly
// machine-readable in markup — verified from a live capture:
//
//   <div data-test="product-card" id="c8fc0d62-…" brand="apple"
//        category="Smartphones" model="iphone 15"
//        image-alt="iPhone 15 • Unlocked">
//     …<span data-test="product-title">iPhone 15 • Unlocked</span>
//     …aria-label="Rating of 4.5 out of 5 stars"
//
// So this adapter parses cards, not JSON. An earlier version assumed a
// Next.js RSC stream (wrong framework) and a later one tried the Nuxt
// payload (devalue-flattened, so plain JSON walking found nothing). Both
// parsed zero products.
//
// PRICE is the one heuristic here: the card does not expose a single
// unambiguous price element that has been confirmed, so amounts are read
// from rendered text with per-month figures excluded:
//   • price     = lowest remaining amount ("From $264.00")
//   • listPrice = highest, only when it is plausibly the same product
// Capture exposes `fullCardSample` so this can be replaced with an exact
// selector as soon as the real price element is confirmed.

export const HOST = 'backmarket.com';

const LOCALE = 'en-us';
const SEARCH_URL = (query) =>
  `https://www.backmarket.com/${LOCALE}/search?q=${encodeURIComponent(query)}`;

const CARD_MARKER = 'data-test="product-card"';

const TITLE_RE = /data-test="product-title"[^>]*>([\s\S]*?)</;
const RATING_RE = /aria-label="Rating of ([\d.]+) out of 5/;
const HREF_RE = /href="([^"]*\/p\/[^"?]+)/;
const CLOUDFRONT_RE = /https:\/\/[^"'\\\s]+cloudfront\.net[^"'\\\s"]+/g;

/** Dollar amounts, excluding "per month" financing figures. */
const AMOUNT_RE = /\$\s?([\d,]+(?:\.\d{1,2})?)/g;

/** "$22.00/mo", "$22.00 per month", "$22.00/month" — not the asking price. */
const FINANCING_TAIL = /^\s*(?:\/|per\b)\s*(?:mo\b|month)/i;

// ── HTML helpers ───────────────────────────────────────────────────────

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

/** Attribute map from a single opening tag. */
function parseAttributes(tag) {
  const attributes = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let match;

  while ((match = re.exec(tag)) !== null) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

/**
 * Split the page into card chunks. A card runs from its marker to the next
 * card's marker, which keeps each card's price and title together.
 */
function splitCards(html) {
  const cards = [];
  let index = html.indexOf(CARD_MARKER);

  while (index !== -1) {
    const next = html.indexOf(CARD_MARKER, index + CARD_MARKER.length);
    const start = Math.max(0, html.lastIndexOf('<', index));
    const end = next === -1 ? html.length : Math.max(start, html.lastIndexOf('<', next));
    cards.push(html.slice(start, end));
    index = next;
  }
  return cards;
}

function openingTag(cardHtml) {
  const end = cardHtml.indexOf('>');
  return end === -1 ? cardHtml : cardHtml.slice(0, end + 1);
}

function readAmounts(cardHtml) {
  const text = stripTags(cardHtml);
  const amounts = [];
  let match;

  AMOUNT_RE.lastIndex = 0;
  while ((match = AMOUNT_RE.exec(text)) !== null) {
    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;

    // A lookahead here would be defeated by regex backtracking (the number
    // can shrink to satisfy it), so the tail is checked explicitly.
    const tail = text.slice(
      match.index + match[0].length,
      match.index + match[0].length + 24
    );
    if (FINANCING_TAIL.test(tail)) continue;

    amounts.push(value);
  }
  return amounts;
}

/** Back Market exposes brand slugs lowercase ("apple"). */
function normaliseBrand(brand) {
  if (!brand) return undefined;
  return /^[a-z]+$/.test(brand) ? brand[0].toUpperCase() + brand.slice(1) : brand;
}

// ── Card → shared payload ──────────────────────────────────────────────

function parseCard(cardHtml) {
  const attributes = parseAttributes(openingTag(cardHtml));
  const text = stripTags(cardHtml);

  const hrefMatch = cardHtml.match(HREF_RE);
  const id = attributes.id ?? hrefMatch?.[1]?.split('/').pop();
  if (!id) return null;

  const title = (cardHtml.match(TITLE_RE)?.[1] && decodeEntities(cardHtml.match(TITLE_RE)[1]))
    || attributes['image-alt']
    || undefined;
  if (!title) return null;

  const amounts = readAmounts(cardHtml);
  if (amounts.length === 0) return null;

  const price = Math.min(...amounts);
  const highest = Math.max(...amounts);
  // Only treat a higher figure as a list price when it is plausibly the same
  // product — a 4x spread is a different device, not a "was" price.
  const listPrice = highest > price && highest <= price * 4 ? highest : undefined;

  const images = [...new Set(cardHtml.match(CLOUDFRONT_RE) ?? [])].slice(0, 3);

  return {
    // Shared payload contract — see search/browser-providers.ts
    providerProductId: id,
    title,
    brand: normaliseBrand(attributes.brand),
    // Feeds entity resolution, which is otherwise unable to join these
    // listings to the same device at other retailers.
    model: attributes.model || undefined,
    price: { amount: price, currency: 'USD' },
    listPrice: listPrice ? { amount: listPrice, currency: 'USD' } : undefined,
    // Every Back Market listing is a refurbished device.
    condition: 'refurbished',
    productUrl: hrefMatch
      ? `https://www.backmarket.com${hrefMatch[1]}`
      : `https://www.backmarket.com/${LOCALE}/p/-/${id}`,
    imageUrls: images,
    rating: Number(cardHtml.match(RATING_RE)?.[1]) || undefined,
    category: attributes.category || undefined,
    availability: text.includes('Out of stock') ? 'out_of_stock' : 'in_stock',
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/** Raw HTML, shared by search(), capture() and the debug harness. */
export async function raw(query, { signal } = {}) {
  const response = await fetch(SEARCH_URL(query), {
    credentials: 'include',
    headers: { Accept: 'text/html' },
    signal,
  });
  return { status: response.status, finalUrl: response.url, html: await response.text() };
}

export async function search(query, { limit = 24, signal } = {}) {
  const { status, html } = await raw(query, { signal });

  if (status !== 200) {
    throw new Error(
      `Back Market returned HTTP ${status}${status === 403 ? ' (bot challenge)' : ''}`
    );
  }

  return parseCards(html, { limit });
}

/** Pure HTML → products. Exported so the parser is testable without network. */
export function parseCards(html, { limit = 24 } = {}) {
  const seen = new Set();
  const products = [];

  for (const cardHtml of splitCards(html)) {
    if (products.length >= limit) break;

    const product = parseCard(cardHtml);
    if (!product || seen.has(product.providerProductId)) continue;

    seen.add(product.providerProductId);
    products.push(product);
  }

  return products;
}

/** Exposed for the debug harness — reports what the parser actually saw. */
export async function capture(query) {
  const { status, finalUrl, html } = await raw(query);
  const cards = splitCards(html);
  const firstCard = cards[0] ?? '';

  return {
    status,
    finalUrl,
    htmlLength: html.length,
    cards: cards.length,
    parsedCards: cards.filter((card) => parseCard(card) !== null).length,
    firstCardAttributes: firstCard ? parseAttributes(openingTag(firstCard)) : null,
    firstCardAmounts: firstCard ? readAmounts(firstCard) : [],
    // Full first card: the evidence needed to replace the price heuristic
    // with an exact selector.
    fullCardSample: firstCard.slice(0, 6000),
  };
}
