// ── Embedded Checkout Protocol (ECP) helpers ─────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  ECP_SUPPORTED_DELEGATIONS,
  buildEmbeddedCheckoutUrl,
  ecpError,
  ecpSuccess,
  isAllowedWindowOpenUrl,
  negotiateDelegations,
  originOf,
  parseEcpMessage,
  readEcpError,
  readEcpOrder,
  readEmbeddedBinding,
  resolveCheckoutHandoff,
} from '@/lib/ucp/ecp';
import type { ShopifyUCPMetadata } from '@/types/shopify';

const CONTINUE_URL = 'https://example.myshopify.com/checkout/c/abc123?key=secret';
const VERSION = '2026-08-25';

function ucp(services?: ShopifyUCPMetadata['services']): ShopifyUCPMetadata {
  return { version: VERSION, capabilities: {}, ...(services ? { services } : {}) };
}

describe('readEmbeddedBinding', () => {
  it('reports ECP unavailable when there is no service binding', () => {
    expect(readEmbeddedBinding(undefined)).toEqual({ available: false, delegates: [] });
    expect(readEmbeddedBinding(ucp())).toEqual({ available: false, delegates: [] });
  });

  it('ignores non-embedded transports', () => {
    const binding = readEmbeddedBinding(
      ucp({ 'dev.ucp.shopping': [{ transport: 'mcp' }, { transport: 'rest' }] })
    );
    expect(binding).toEqual({ available: false, delegates: [] });
  });

  it('reads the allowed delegations from the embedded binding', () => {
    const binding = readEmbeddedBinding(
      ucp({
        'dev.ucp.shopping': [
          { transport: 'mcp' },
          {
            transport: 'embedded',
            config: { delegate: ['window.open', 'payment.credential'] },
          },
        ],
      })
    );
    expect(binding).toEqual({
      available: true,
      delegates: ['window.open', 'payment.credential'],
    });
  });

  it('deduplicates delegations across bindings and drops invalid entries', () => {
    const binding = readEmbeddedBinding(
      ucp({
        'dev.ucp.shopping': [
          { transport: 'embedded', config: { delegate: ['window.open'] } },
          { transport: 'embedded', config: { delegate: ['window.open', ''] } },
        ],
      })
    );
    expect(binding.delegates).toEqual(['window.open']);
  });
});

describe('negotiateDelegations', () => {
  it('only requests delegations Emporika can fulfil', () => {
    expect(ECP_SUPPORTED_DELEGATIONS).toEqual(['window.open']);
    expect(
      negotiateDelegations(['window.open', 'payment.credential', 'fulfillment.address_change'])
    ).toEqual(['window.open']);
  });

  it('returns an empty list when nothing supported is allowed', () => {
    expect(negotiateDelegations([])).toEqual([]);
    expect(negotiateDelegations(['payment.credential'])).toEqual([]);
  });
});

describe('buildEmbeddedCheckoutUrl', () => {
  it('appends the ECP parameters and preserves merchant query params', () => {
    const url = new URL(
      buildEmbeddedCheckoutUrl({
        continueUrl: CONTINUE_URL,
        version: VERSION,
        delegates: ['window.open'],
        colorScheme: 'dark',
      }) as string
    );

    expect(url.origin + url.pathname).toBe(
      'https://example.myshopify.com/checkout/c/abc123'
    );
    expect(url.searchParams.get('key')).toBe('secret');
    expect(url.searchParams.get('ec_version')).toBe(VERSION);
    expect(url.searchParams.get('ec_delegate')).toBe('window.open');
    expect(url.searchParams.get('ec_color_scheme')).toBe('dark');
  });

  it('never sets ec_auth (Emporika has no buyer identity to hand over)', () => {
    const raw = buildEmbeddedCheckoutUrl({
      continueUrl: CONTINUE_URL,
      version: VERSION,
      delegates: ['window.open'],
    }) as string;
    expect(raw).not.toContain('ec_auth');
  });

  it('omits ec_delegate when no delegation was negotiated', () => {
    const raw = buildEmbeddedCheckoutUrl({
      continueUrl: CONTINUE_URL,
      version: VERSION,
      delegates: [],
    }) as string;
    expect(raw).not.toContain('ec_delegate');
  });

  it('rejects unusable inputs so callers can fall back to a redirect', () => {
    expect(buildEmbeddedCheckoutUrl({ continueUrl: '', version: VERSION })).toBeNull();
    expect(buildEmbeddedCheckoutUrl({ continueUrl: CONTINUE_URL, version: '' })).toBeNull();
    expect(buildEmbeddedCheckoutUrl({ continueUrl: 'not a url', version: VERSION })).toBeNull();
    expect(
      buildEmbeddedCheckoutUrl({ continueUrl: 'javascript:alert(1)', version: VERSION })
    ).toBeNull();
  });
});

describe('resolveCheckoutHandoff', () => {
  it('embeds when the merchant returned the binding and a version', () => {
    const handoff = resolveCheckoutHandoff({
      continueUrl: CONTINUE_URL,
      ucpVersion: VERSION,
      embedded: { available: true, delegates: ['window.open', 'payment.credential'] },
      colorScheme: 'dark',
    });

    expect(handoff?.mode).toBe('embedded');
    expect(handoff?.version).toBe(VERSION);
    expect(handoff?.delegates).toEqual(['window.open']);
    const url = new URL(handoff!.url);
    expect(url.searchParams.get('ec_version')).toBe(VERSION);
    expect(url.searchParams.get('ec_delegate')).toBe('window.open');
    expect(url.searchParams.get('ec_color_scheme')).toBe('dark');
  });

  it('redirects when the merchant omitted the binding', () => {
    const handoff = resolveCheckoutHandoff({
      continueUrl: CONTINUE_URL,
      ucpVersion: VERSION,
      embedded: { available: false, delegates: ['window.open'] },
    });

    expect(handoff).toEqual({
      mode: 'redirect',
      url: CONTINUE_URL,
      version: VERSION,
      delegates: [],
    });
  });

  it('redirects when the version is missing, since ECP requires ec_version', () => {
    const handoff = resolveCheckoutHandoff({
      continueUrl: CONTINUE_URL,
      ucpVersion: null,
      embedded: { available: true, delegates: ['window.open'] },
    });

    expect(handoff?.mode).toBe('redirect');
    expect(handoff?.version).toBe('');
    expect(handoff?.url).toBe(CONTINUE_URL);
  });

  it('returns null without a continue_url or for non-web URLs', () => {
    expect(resolveCheckoutHandoff({ continueUrl: null, ucpVersion: VERSION })).toBeNull();
    expect(
      resolveCheckoutHandoff({ continueUrl: 'javascript:alert(1)', ucpVersion: VERSION })
    ).toBeNull();
    expect(resolveCheckoutHandoff({ continueUrl: 'nope' })).toBeNull();
  });
});

describe('originOf', () => {
  it('derives the origin used for postMessage validation', () => {
    expect(originOf(CONTINUE_URL)).toBe('https://example.myshopify.com');
    expect(originOf('nope')).toBeNull();
  });
});

describe('isAllowedWindowOpenUrl', () => {
  it('allows only https links', () => {
    expect(isAllowedWindowOpenUrl('https://example.myshopify.com/privacy')).toBe(true);
    expect(isAllowedWindowOpenUrl('http://example.myshopify.com/privacy')).toBe(false);
    expect(isAllowedWindowOpenUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedWindowOpenUrl('shopify://checkout')).toBe(false);
    expect(isAllowedWindowOpenUrl(undefined)).toBe(false);
    expect(isAllowedWindowOpenUrl(42)).toBe(false);
  });
});

describe('parseEcpMessage', () => {
  it('parses a request', () => {
    expect(
      parseEcpMessage({
        jsonrpc: '2.0',
        id: 'ready_1',
        method: 'ec.ready',
        params: { delegate: [], auth: { type: 'oauth' } },
      })
    ).toEqual({
      jsonrpc: '2.0',
      id: 'ready_1',
      method: 'ec.ready',
      params: { delegate: [], auth: { type: 'oauth' } },
    });
  });

  it('parses a notification', () => {
    expect(
      parseEcpMessage({ jsonrpc: '2.0', method: 'ec.start', params: { checkout: {} } })
    ).toEqual({ jsonrpc: '2.0', method: 'ec.start', params: { checkout: {} } });
  });

  it('rejects anything that is not JSON-RPC 2.0 with a method', () => {
    expect(parseEcpMessage(null)).toBeNull();
    expect(parseEcpMessage('ec.ready')).toBeNull();
    expect(parseEcpMessage({ jsonrpc: '1.0', method: 'ec.ready' })).toBeNull();
    expect(parseEcpMessage({ jsonrpc: '2.0' })).toBeNull();
    expect(parseEcpMessage({ jsonrpc: '2.0', method: 'ec.ready', id: {} })).toBeNull();
    expect(parseEcpMessage({ jsonrpc: '2.0', method: 'ec.ready', params: null })).toBeNull();
  });
});

describe('response builders', () => {
  it('wraps success in the session-bound UCP envelope', () => {
    const response = ecpSuccess('ready_1', VERSION);
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'ready_1',
      result: { ucp: { version: VERSION, status: 'success' } },
    });
  });

  it('returns application errors as a result, never as JSON-RPC errors', () => {
    const response = ecpError(
      'window_1',
      VERSION,
      'window_open_rejected_error',
      'Host policy blocked the link.',
      'unrecoverable'
    );
    expect(response).not.toHaveProperty('error');
    expect(response.result.ucp).toEqual({ version: VERSION, status: 'error' });
    expect(response.result.messages?.[0]).toEqual({
      type: 'error',
      code: 'window_open_rejected_error',
      content: 'Host policy blocked the link.',
      severity: 'unrecoverable',
    });
  });
});

describe('readEcpOrder', () => {
  it('extracts the completed order', () => {
    expect(
      readEcpOrder({
        checkout: {
          id: 'checkout_1',
          order: { id: 'gid://shopify/Order/1', permalink_url: 'https://shop/orders/1' },
        },
      })
    ).toEqual({ id: 'gid://shopify/Order/1', permalinkUrl: 'https://shop/orders/1' });
  });

  it('returns null when checkout has no order', () => {
    expect(readEcpOrder({ checkout: { id: 'checkout_1' } })).toBeNull();
    expect(readEcpOrder(undefined)).toBeNull();
  });
});

describe('readEcpError', () => {
  it('extracts the first error message from ec.error', () => {
    expect(
      readEcpError({
        error: {
          ucp: { version: VERSION, status: 'error' },
          messages: [{ type: 'error', code: 'timeout_error', content: 'Timed out.' }],
        },
      })
    ).toEqual({ code: 'timeout_error', content: 'Timed out.' });
  });

  it('falls back when the payload is malformed', () => {
    expect(readEcpError(undefined)).toEqual({
      code: 'unknown_error',
      content: 'Checkout stopped unexpectedly.',
    });
  });
});
