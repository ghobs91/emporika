// ── Embedded Checkout Protocol (ECP) helpers ─────────────────────────────
//
// ECP is the UCP `embedded` transport binding for checkout. Emporika is a web
// host: the merchant's `continue_url` is loaded in a sandboxed iframe and both
// sides exchange JSON-RPC 2.0 messages through `window.postMessage`.
//
// Spec:
//   https://shopify.dev/docs/agents/carts-and-checkout/ecp
//   https://ucp.dev/2026-08-25/specification/shopping/checkout/embedded/
//
// Everything here is a pure function (no DOM access) so the protocol rules
// stay unit-testable in the Node test environment.
//
// Deliberate omissions:
//   - `ec_auth` is never set. Emporika has no buyer identity to hand the
//     merchant, and minting one would put `SHOPIFY_BUYER_TOKEN` in the browser.
//   - Only `window.open` is requested. Payment and address UI stay inside the
//     merchant's checkout because Emporika holds no wallet or address book.

import type { ShopifyUCPMetadata } from '@/types/shopify';

/** Delegations Emporika can actually fulfil natively. */
export const ECP_SUPPORTED_DELEGATIONS = ['window.open'] as const;
export type EcpDelegation = (typeof ECP_SUPPORTED_DELEGATIONS)[number];

export interface EmbeddedCheckoutBinding {
  /** True when the merchant advertised the `embedded` service binding for this checkout. */
  available: boolean;
  /** Delegations the merchant allows for this session (`config.delegate`). */
  delegates: string[];
}

/**
 * Read the per-checkout ECP availability signal. Merchants MUST include an
 * `embedded` service binding with `config.delegate` in checkout responses to
 * indicate ECP is available; its absence means redirect-only continuation.
 */
export function readEmbeddedBinding(
  ucp: ShopifyUCPMetadata | null | undefined
): EmbeddedCheckoutBinding {
  const services = ucp?.services?.['dev.ucp.shopping'];
  if (!Array.isArray(services)) return { available: false, delegates: [] };

  const embedded = services.filter((service) => service?.transport === 'embedded');
  if (embedded.length === 0) return { available: false, delegates: [] };

  const delegates = new Set<string>();
  for (const service of embedded) {
    for (const delegate of service.config?.delegate ?? []) {
      if (typeof delegate === 'string' && delegate.length > 0) delegates.add(delegate);
    }
  }

  return { available: true, delegates: [...delegates] };
}

/** Intersect what the merchant allows with what Emporika can fulfil. */
export function negotiateDelegations(allowed: readonly string[]): EcpDelegation[] {
  return ECP_SUPPORTED_DELEGATIONS.filter((delegate) => allowed.includes(delegate));
}

export interface BuildEmbeddedCheckoutUrlParams {
  /** Merchant `continue_url` (untouched, as returned by Checkout MCP). */
  continueUrl: string;
  /** UCP version from the checkout response (`ucp.version`). */
  version: string;
  delegates?: readonly string[];
  colorScheme?: 'light' | 'dark';
}

/**
 * Append the ECP query parameters to `continue_url`.
 * Returns null when the URL or version is unusable, so callers can fall back to
 * the redirect handoff instead of loading a broken embedded checkout.
 */
export function buildEmbeddedCheckoutUrl({
  continueUrl,
  version,
  delegates,
  colorScheme,
}: BuildEmbeddedCheckoutUrlParams): string | null {
  if (!continueUrl || !version) return null;

  let url: URL;
  try {
    url = new URL(continueUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  url.searchParams.set('ec_version', version);
  if (delegates && delegates.length > 0) {
    url.searchParams.set('ec_delegate', delegates.join(','));
  }
  if (colorScheme) {
    url.searchParams.set('ec_color_scheme', colorScheme);
  }

  return url.toString();
}

/** Origin used for strict `postMessage` validation against `continue_url`. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface CheckoutHandoffInput {
  continueUrl?: string | null;
  /** `ucp.version` from the checkout response. */
  ucpVersion?: string | null;
  /** Per-checkout ECP availability from the checkout response. */
  embedded?: { available: boolean; delegates?: readonly string[] } | null;
  colorScheme?: 'light' | 'dark';
}

export interface CheckoutHandoff {
  /** `embedded` when the merchant returned the ECP binding, otherwise `redirect`. */
  mode: 'embedded' | 'redirect';
  /** ECP URL for embedded mode; the merchant's own checkout URL for redirect mode. */
  url: string;
  /** Session-bound UCP version (`''` when the merchant omitted it). */
  version: string;
  delegates: EcpDelegation[];
}

/**
 * Decide how to present a created checkout.
 *
 * ECP applies only when the merchant returned the `embedded` binding in the
 * checkout response *and* supplied a usable `ucp.version`. Anything else — no
 * binding, no version, or an unusable `continue_url` — is redirect-only
 * continuation, which is the documented general-access flow.
 */
export function resolveCheckoutHandoff(
  input: CheckoutHandoffInput
): CheckoutHandoff | null {
  const continueUrl = input.continueUrl;
  if (!continueUrl) return null;

  // Never hand a non-web URL to the browser, even for the redirect fallback.
  try {
    const parsed = new URL(continueUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }

  const version =
    typeof input.ucpVersion === 'string' && input.ucpVersion.length > 0
      ? input.ucpVersion
      : '';
  const delegates = negotiateDelegations(input.embedded?.delegates ?? []);

  if (input.embedded?.available && version) {
    const url = buildEmbeddedCheckoutUrl({
      continueUrl,
      version,
      delegates,
      colorScheme: input.colorScheme,
    });
    if (url) return { mode: 'embedded', url, version, delegates };
  }

  return { mode: 'redirect', url: continueUrl, version, delegates: [] };
}

/** `window.open` delegation: only https links may be handed to the browser. */
export function isAllowedWindowOpenUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// ── JSON-RPC 2.0 messages ───────────────────────────────────────────────

export interface EcpMessage {
  jsonrpc: '2.0';
  method: string;
  /** Present only on requests (which require a response). */
  id?: string | number;
  params?: Record<string, unknown>;
}

/** Parse an untrusted `MessageEvent.data` payload into an ECP message. */
export function parseEcpMessage(data: unknown): EcpMessage | null {
  if (!data || typeof data !== 'object') return null;

  const message = data as Record<string, unknown>;
  if (message.jsonrpc !== '2.0') return null;
  if (typeof message.method !== 'string' || message.method.length === 0) return null;
  if (
    message.id !== undefined &&
    typeof message.id !== 'string' &&
    typeof message.id !== 'number'
  ) {
    return null;
  }

  const rawParams = message.params;
  if (rawParams !== undefined && (rawParams === null || typeof rawParams !== 'object')) {
    return null;
  }

  return {
    jsonrpc: '2.0',
    method: message.method,
    ...(message.id !== undefined ? { id: message.id as string | number } : {}),
    ...(rawParams ? { params: rawParams as Record<string, unknown> } : {}),
  };
}

export interface EcpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: {
    ucp: { version: string; status: 'success' | 'error' };
    messages?: Array<{
      type: 'error';
      code: string;
      content: string;
      severity: 'recoverable' | 'unrecoverable';
    }>;
    [key: string]: unknown;
  };
}

/** Success result carrying the session-bound UCP envelope. */
export function ecpSuccess(
  id: string | number,
  version: string,
  result: Record<string, unknown> = {}
): EcpResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: { ucp: { version, status: 'success' }, ...result },
  };
}

/**
 * Application-level error. Per UCP, failures travel as a `result` with
 * `ucp.status: 'error'` — never as a JSON-RPC `error` object.
 */
export function ecpError(
  id: string | number,
  version: string,
  code: string,
  content: string,
  severity: 'recoverable' | 'unrecoverable' = 'recoverable'
): EcpResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      ucp: { version, status: 'error' },
      messages: [{ type: 'error', code, content, severity }],
    },
  };
}

/** Transport-level failure (malformed or unknown method), per JSON-RPC. */
export function ecpTransportError(id: string | number, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const METHOD_NOT_FOUND = -32601;
export const ECP_METHOD_NOT_FOUND = METHOD_NOT_FOUND;

// ── Notification payload readers ────────────────────────────────────────

export interface EcpOrder {
  id?: string;
  permalinkUrl?: string;
}

/** Read `params.checkout.order` from `ec.complete`. */
export function readEcpOrder(
  params: Record<string, unknown> | undefined
): EcpOrder | null {
  const checkout = params?.checkout;
  if (!checkout || typeof checkout !== 'object') return null;

  const order = (checkout as Record<string, unknown>).order;
  if (!order || typeof order !== 'object') return null;

  const record = order as Record<string, unknown>;
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.permalink_url === 'string'
      ? { permalinkUrl: record.permalink_url }
      : {}),
  };
}

export interface EcpErrorDetail {
  code: string;
  content: string;
}

/** Read the first message from an `ec.error` notification. */
export function readEcpError(
  params: Record<string, unknown> | undefined
): EcpErrorDetail {
  const error = params?.error;
  const messages =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>).messages
      : undefined;

  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (!first || typeof first !== 'object') {
    return { code: 'unknown_error', content: 'Checkout stopped unexpectedly.' };
  }

  const record = first as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : 'unknown_error',
    content:
      typeof record.content === 'string'
        ? record.content
        : 'Checkout stopped unexpectedly.',
  };
}
