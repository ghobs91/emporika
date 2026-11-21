import { describe, it, expect } from 'vitest';
import {
  targetSearchUrl,
  targetProductUrl,
  targetTcinFromUrl,
} from '@/lib/target-deep-links';

describe('targetSearchUrl', () => {
  it('builds the storefront search URL Target itself uses', () => {
    expect(targetSearchUrl('usb cable')).toBe(
      'https://www.target.com/s?searchTerm=usb+cable'
    );
  });

  it('encodes characters that would otherwise break the query', () => {
    const url = targetSearchUrl('lego & "blocks"');
    expect(url.startsWith('https://www.target.com/s?searchTerm=')).toBe(true);
    expect(url).not.toContain(' & ');
    expect(new URL(url).searchParams.get('searchTerm')).toBe('lego & "blocks"');
  });

  it('trims and truncates rather than building a huge URL', () => {
    expect(targetSearchUrl('  hoodie  ')).toBe('https://www.target.com/s?searchTerm=hoodie');
    const long = new URL(targetSearchUrl('x'.repeat(500))).searchParams.get('searchTerm')!;
    expect(long).toHaveLength(200);
  });
});

describe('targetProductUrl', () => {
  it('builds a canonical slugged product URL', () => {
    expect(targetProductUrl('1000000076', 'campus-lab-hoodie')).toBe(
      'https://www.target.com/p/campus-lab-hoodie/-/A-1000000076'
    );
  });

  it('falls back to the bare form when there is no slug', () => {
    expect(targetProductUrl('86376363')).toBe('https://www.target.com/p/-/A-86376363');
    expect(targetProductUrl('86376363', '   ')).toBe('https://www.target.com/p/-/A-86376363');
  });

  it('refuses anything that is not a numeric tcin', () => {
    expect(targetProductUrl('')).toBeNull();
    expect(targetProductUrl('abc')).toBeNull();
    expect(targetProductUrl('../../admin')).toBeNull();
    expect(targetProductUrl('12/34')).toBeNull();
  });

  it('cannot be used to rewrite the destination via the slug', () => {
    // A slug is cosmetic, but it is still attacker-influenced input: it may not
    // introduce a query, fragment, path segment or host change.
    const url = targetProductUrl('123', 'evil?#x/../..//other.com');
    expect(url).toBe('https://www.target.com/p/evilx....other.com/-/A-123');
    expect(new URL(url!).host).toBe('www.target.com');
    expect(new URL(url!).search).toBe('');
    expect(new URL(url!).hash).toBe('');
  });
});

describe('targetTcinFromUrl', () => {
  it('recovers the tcin from either product URL shape', () => {
    expect(targetTcinFromUrl('https://www.target.com/p/-/A-86376363')).toBe('86376363');
    expect(
      targetTcinFromUrl('https://www.target.com/p/some-slug/-/A-1000000076?preselect=1')
    ).toBe('1000000076');
  });

  it('returns null when there is no product id', () => {
    expect(targetTcinFromUrl('https://www.target.com/s?searchTerm=lego')).toBeNull();
  });
});
