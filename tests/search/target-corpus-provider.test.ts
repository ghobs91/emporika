import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// The provider reaches the network through the loader and storage through
// window.localStorage. Both are stubbed: this suite tests the merge/precedence
// rules, not the download.
const queryMock = vi.fn();
vi.mock('@/lib/target-corpus-client', () => ({
  loadTargetCorpusIndex: vi.fn(async () => ({ size: 3, query: queryMock })),
}));

import {
  getTargetCorpusResult,
  isTargetCorpusEnabled,
  setTargetCorpusEnabled,
  withTargetCorpus,
} from '@/lib/target-corpus-provider';

/** Minimal localStorage + window stand-in for the node test environment. */
function installWindow(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

/** A hit shaped like TargetCorpusIndex.query output. */
function hit(tcin: string, title: string) {
  return { tcin, title, matchMode: 'all' as const, matchedTokens: 2, coverage: 1, score: 1 };
}

beforeEach(() => {
  installWindow();
  queryMock.mockReset();
  queryMock.mockReturnValue([hit('1001', 'usb c cable braided'), hit('1002', 'usb hub')]);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('opt-in flag', () => {
  it('is off by default', () => {
    expect(isTargetCorpusEnabled()).toBe(false);
  });

  it('persists across reads once set', () => {
    setTargetCorpusEnabled(true);
    expect(isTargetCorpusEnabled()).toBe(true);
    setTargetCorpusEnabled(false);
    expect(isTargetCorpusEnabled()).toBe(false);
  });

  it('is off when there is no window (server render)', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(isTargetCorpusEnabled()).toBe(false);
  });

  it('does not throw when storage rejects the write', () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
        removeItem: () => {},
      },
    };
    expect(() => setTargetCorpusEnabled(true)).not.toThrow();
    expect(isTargetCorpusEnabled()).toBe(false);
  });
});

describe('getTargetCorpusResult', () => {
  it('returns null when the shopper has not opted in', async () => {
    expect(await getTargetCorpusResult('usb cable')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps corpus hits into the browser payload shape', async () => {
    setTargetCorpusEnabled(true);
    const payload = await getTargetCorpusResult('usb cable');
    expect(payload?.providerId).toBe('target');
    expect(payload?.query).toBe('usb cable');
    expect(payload?.products).toHaveLength(2);
    expect(payload?.products[0]).toMatchObject({
      providerProductId: 'target-1001',
      title: 'usb c cable braided',
      condition: 'unknown',
      availability: 'unknown',
      imageUrls: [],
    });
    // Derived from the tcin, because the corpus carries no slug.
    expect(payload?.products[0].productUrl).toBe('https://www.target.com/p/-/A-1001');
    // Never assert a price the catalog does not have.
    expect(payload?.products[0].price).toBeUndefined();
  });

  it('warns rather than silently returning nothing for an unmatched query', async () => {
    setTargetCorpusEnabled(true);
    queryMock.mockReturnValue([]);
    const payload = await getTargetCorpusResult('quantum flux capacitor');
    expect(payload?.products).toEqual([]);
    expect(payload?.warnings?.[0]).toMatch(/no match/i);
  });
});

describe('withTargetCorpus', () => {
  it('leaves the request untouched when opted out', async () => {
    expect(await withTargetCorpus(null, 'usb cable')).toBeNull();
  });

  it('adds target into an existing payload', async () => {
    setTargetCorpusEnabled(true);
    const merged = await withTargetCorpus(
      { providers: { costco: { providerId: 'costco' as const, query: 'usb cable', products: [] } } },
      'usb cable'
    );
    expect(Object.keys(merged!.providers).sort()).toEqual(['costco', 'target']);
  });

  it('creates the payload when the extension supplied nothing', async () => {
    setTargetCorpusEnabled(true);
    const merged = await withTargetCorpus(null, 'usb cable');
    expect(merged!.providers.target?.products).toHaveLength(2);
  });

  it('prefers extension-collected Target listings over the corpus', async () => {
    setTargetCorpusEnabled(true);
    const extensionTarget = { providerId: 'target' as const, query: 'usb cable', products: [] };
    const merged = await withTargetCorpus(
      { providers: { target: extensionTarget } },
      'usb cable'
    );
    // The extension sees a real page and can carry price/availability.
    expect(merged!.providers.target).toBe(extensionTarget);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does nothing when Target is not among the selected sources', async () => {
    setTargetCorpusEnabled(true);
    expect(await withTargetCorpus(null, 'usb cable', ['walmart'])).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('falls back to the server path when the corpus fails to load', async () => {
    setTargetCorpusEnabled(true);
    queryMock.mockImplementation(() => {
      throw new Error('corpus corrupt');
    });
    // A broken download must not fail the whole search.
    expect(await withTargetCorpus(null, 'usb cable')).toBeNull();
  });
});
