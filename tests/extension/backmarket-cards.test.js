// ── Back Market card parser (extension) ────────────────────────────────
//
// Fixture structure is copied from a live capture of
// https://www.backmarket.com/en-us/search?q=iphone%2015 — attributes on the
// card element, title in data-test="product-title", rating in aria-label,
// prices in rendered text.
//
// This exists because the adapter was twice written against an assumed data
// source (a Next.js RSC stream, then the Nuxt payload) and parsed nothing.

import { describe, expect, it } from 'vitest';
import { parseCards } from '../../extension/src/providers/backmarket.js';

function card({ id, title, model, rating, amounts, brand = 'apple' }) {
  return `
<div data-test="product-card" id="${id}" brand="${brand}" category="Smartphones" category-id="2" image-alt="${title}" model="${model}">
  <article class="_cardContainer_18hlb_2" data-spec="product-card-content">
    <h3><a href="/en-us/p/${model.replace(/ /g, '-')}-128-gb-black-unlocked/${id}?l=12">
      <span class="body-1-bold" data-test="product-title">${title}</span></a></h3>
    <span aria-label="Rating of ${rating} out of 5 stars"></span>
    <img src="https://d2e6ccujb3mkqf.cloudfront.net/${id}-1.jpg">
    ${amounts.map((amount, index) => index === 2 ? `<span>$${amount}/mo</span>` : `<span>$${amount}</span>`).join('\n')}
  </article>
</div>`;
}

const html = [
  card({ id: 'c8fc0d62-5daa-48f0-ba1e-4c41b4612249', title: 'iPhone 15 • Unlocked', model: 'iphone 15', rating: 4.5, amounts: ['629.00', '264.00', '22.00'] }),
  card({ id: '05142a1a-d99b-428c-8ba6-4b085c329e18', title: 'iPhone 15 Plus • Unlocked', model: 'iphone 15 plus', rating: 4.4, amounts: ['829.00', '389.00', '32.41'] }),
].join('\n');

describe('Back Market card parser', () => {
  const products = parseCards(html);
  const [first, second] = products;

  it('parses every card on the page', () => {
    expect(products).toHaveLength(2);
  });

  it('reads structured attributes from the card element', () => {
    expect(first.providerProductId).toBe('c8fc0d62-5daa-48f0-ba1e-4c41b4612249');
    expect(first.brand).toBe('Apple');
    expect(first.model).toBe('iphone 15');
    expect(first.category).toBe('Smartphones');
  });

  it('reads the title from data-test="product-title"', () => {
    expect(first.title).toBe('iPhone 15 • Unlocked');
  });

  it('reads the rating from aria-label', () => {
    expect(first.rating).toBe(4.5);
  });

  it('treats the lowest non-financing amount as the price', () => {
    expect(first.price).toEqual({ amount: 264, currency: 'USD' });
  });

  it('excludes per-month financing figures', () => {
    // Regression: a lookahead here previously let the regex backtrack and
    // match $22 out of "$22.00/mo", making the price 12x too low.
    expect(first.price.amount).not.toBe(22);
  });

  it('treats a plausible higher amount as the list price', () => {
    expect(first.listPrice).toEqual({ amount: 629, currency: 'USD' });
  });

  it('builds an absolute product URL', () => {
    expect(first.productUrl).toMatch(/^https:\/\/www\.backmarket\.com\/en-us\/p\//);
  });

  it('captures the product image', () => {
    expect(first.imageUrls[0]).toContain('cloudfront.net');
  });

  it('marks listings as refurbished, which is what Back Market sells', () => {
    expect(first.condition).toBe('refurbished');
  });

  it('keeps cards independent', () => {
    expect(second.price.amount).toBe(389);
    expect(second.model).toBe('iphone 15 plus');
  });

  it('returns nothing from a page with no cards', () => {
    expect(parseCards('<html><body>no products here</body></html>')).toEqual([]);
  });

  it('drops a card that has no price rather than inventing one', () => {
    const priceless = card({ id: 'a'.repeat(8), title: 'iPhone 15', model: 'iphone 15', rating: 4.5, amounts: [] });
    expect(parseCards(priceless)).toEqual([]);
  });
});
