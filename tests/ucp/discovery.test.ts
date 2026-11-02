// ── Merchant UCP discovery (mocked fetch, no live merchant calls) ─────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  InvalidMerchantDomainError,
  clearMerchantCapabilityCache,
  getMerchantCapabilities,
  normalizeShopDomain,
  readMerchantProfile,
} from '@/lib/ucp/discovery';

const VERSION = '2026-08-25';
const SHOP = 'allbirds.example';

function profileWith(transports: string[] = ['mcp', 'embedded']) {
  return {
    ucp: {
      version: VERSION,
      capabilities: { 'dev.ucp.shopping.checkout': [{ version: VERSION }] },
      services: {
        'dev.ucp.shopping': transports.map((transport) =>
          transport === 'mcp'
            ? {
                version: VERSION,
                transport,
                endpoint: 'https://weareallbirds.myshopify.com/api/ucp/mcp',
              }
            : { version: VERSION, transport }
        ),
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  clearMerchantCapabilityCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeShopDomain', () => {
  it('normalizes hostnames, URLs, ports and paths', () => {
    expect(normalizeShopDomain('Example.MyShopify.com')).toBe('example.myshopify.com');
    expect(normalizeShopDomain('https://example.com/')).toBe('example.com');
    expect(normalizeShopDomain('https://example.com:8443/cart?x=1')).toBe('example.com');
    expect(normalizeShopDomain('  example.com.  ')).toBe('example.com');
  });

  it('rejects values that must never become a server-side request', () => {
    expect(normalizeShopDomain('')).toBeNull();
    expect(normalizeShopDomain('localhost')).toBeNull();
    expect(normalizeShopDomain('127.0.0.1')).toBeNull();
    expect(normalizeShopDomain('192.168.1.1')).toBeNull();
    expect(normalizeShopDomain('printer.local')).toBeNull();
    expect(normalizeShopDomain('metadata.internal')).toBeNull();
    expect(normalizeShopDomain('not-a-domain')).toBeNull();
    expect(normalizeShopDomain('javascript:alert(1)')).toBeNull();
    expect(normalizeShopDomain('https://*.example.com')).toBeNull();
    expect(normalizeShopDomain(`${'a'.repeat(64)}.com`)).toBeNull();
  });
});

describe('readMerchantProfile', () => {
  it('detects the embedded transport from the merchant profile', () => {
    expect(readMerchantProfile(profileWith())).toEqual({
      embedded: true,
      delegates: [],
      transports: ['mcp', 'embedded'],
      version: VERSION,
      mcpEndpoint: 'https://weareallbirds.myshopify.com/api/ucp/mcp',
    });
  });

  it('reports no ECP support when only MCP is advertised', () => {
    const summary = readMerchantProfile(profileWith(['mcp']));
    expect(summary.embedded).toBe(false);
    expect(summary.transports).toEqual(['mcp']);
  });

  it('surfaces a merchant-level delegation hint without treating it as authoritative', () => {
    const profile = profileWith();
    profile.ucp.services['dev.ucp.shopping'][1] = {
      version: VERSION,
      transport: 'embedded',
      config: { delegate: ['window.open'] },
    } as (typeof profile.ucp.services)['dev.ucp.shopping'][number];

    expect(readMerchantProfile(profile)).toMatchObject({
      embedded: true,
      delegates: ['window.open'],
    });
  });

  it('treats malformed profiles as unsupported', () => {
    for (const profile of [null, undefined, 'nope', {}, { ucp: {} }]) {
      const summary = readMerchantProfile(profile);
      expect(summary.embedded).toBe(false);
      expect(summary.transports).toEqual([]);
      expect(summary.version).toBeUndefined();
    }
  });
});

describe('getMerchantCapabilities', () => {
  it('probes the well-known profile over https', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(profileWith()));
    vi.stubGlobal('fetch', fetchMock);

    const capabilities = await getMerchantCapabilities(SHOP);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://${SHOP}/.well-known/ucp`);
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(capabilities).toMatchObject({
      shopDomain: SHOP,
      profileUrl: `https://${SHOP}/.well-known/ucp`,
      ok: true,
      embedded: true,
      cached: false,
    });
  });

  it('caches successful probes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(profileWith()));
    vi.stubGlobal('fetch', fetchMock);

    await getMerchantCapabilities(SHOP);
    const second = await getMerchantCapabilities(SHOP);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(second.embedded).toBe(true);
  });

  it('refetches when refresh is forced', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(profileWith()));
    vi.stubGlobal('fetch', fetchMock);

    await getMerchantCapabilities(SHOP);
    await getMerchantCapabilities(SHOP, { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse(profileWith())), 1);
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      getMerchantCapabilities(SHOP),
      getMerchantCapabilities(SHOP),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.embedded).toBe(true);
    expect(second.embedded).toBe(true);
  });

  it('caches failures briefly instead of retrying on every call', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getMerchantCapabilities(SHOP);
    const second = await getMerchantCapabilities(SHOP);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      ok: false,
      embedded: false,
      error: 'profile_unavailable (404)',
    });
    expect(second.cached).toBe(true);
  });

  it('honours a zero TTL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(profileWith()));
    vi.stubGlobal('fetch', fetchMock);

    await getMerchantCapabilities(SHOP, { ttlMs: 0 });
    await getMerchantCapabilities(SHOP, { ttlMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports fetch failures without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    await expect(getMerchantCapabilities(SHOP)).resolves.toMatchObject({
      ok: false,
      embedded: false,
      error: 'fetch_failed',
    });
  });

  it('rejects invalid domains before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getMerchantCapabilities('localhost')).rejects.toBeInstanceOf(
      InvalidMerchantDomainError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
