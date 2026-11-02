// ── UCP merchant discovery ───────────────────────────────────────────────
//
// ECP availability is signaled at two levels:
//
//   1. Merchant-level: the business advertises `transport: "embedded"` in its
//      `/.well-known/ucp` profile. Discoverable *before* creating a checkout,
//      so it can filter the candidate merchant set.
//   2. Per-checkout: `ucp.services…config.delegate` on the create_checkout
//      response. This is authoritative — the spec says a merchant-level
//      advertisement does NOT guarantee every checkout enables ECP (cart
//      contents, agent authorization and merchant policy can narrow it).
//
// This module implements layer 1 only, read-only, with an in-memory TTL cache
// and in-flight de-duplication so repeated searches don't hammer merchants.
// Layer 2 stays in lib/ucp/ecp.ts (`readEmbeddedBinding`).

import { readEmbeddedBinding } from '@/lib/ucp/ecp';
import type { ShopifyUCPMetadata } from '@/types/shopify';

const DISCOVERY_PATH = '/.well-known/ucp';

export const DEFAULT_DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour — matches merchant CDN caching
const FAILURE_TTL_MS = 5 * 60 * 1000; // retry unavailable merchants sooner
const CACHE_MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 4000;

/** Hostname with at least one dot; labels are 1–63 chars and may not start/end with `-`. */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.home', '.lan'];

export class InvalidMerchantDomainError extends Error {
  constructor(input: string) {
    super(`Invalid merchant domain: ${input}`);
    this.name = 'InvalidMerchantDomainError';
  }
}

export interface MerchantProfileSummary {
  /** True when the merchant advertises the `embedded` transport (ECP). */
  embedded: boolean;
  /** Merchant-level delegation hint. Usually empty — per-checkout config is authoritative. */
  delegates: string[];
  /** Advertised transports for `dev.ucp.shopping` (e.g. `mcp`, `embedded`). */
  transports: string[];
  version?: string;
  mcpEndpoint?: string;
}

export interface MerchantCapabilities extends MerchantProfileSummary {
  shopDomain: string;
  profileUrl: string;
  /** False when the profile could not be fetched or was not a UCP profile. */
  ok: boolean;
  error?: string;
  /** ISO timestamp of the probe. */
  fetchedAt: string;
  /** True when served from the in-memory cache. */
  cached: boolean;
}

/**
 * Normalize and validate a merchant domain for discovery.
 *
 * Accepts a bare hostname, a URL, or a URL with a path/port; returns null for
 * anything that is not a public-looking hostname. IP literals, `localhost` and
 * private-looking suffixes are rejected because this value becomes a
 * server-side `https` request (SSRF surface).
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let host = trimmed;
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host) return null;

  if (!HOSTNAME_PATTERN.test(host)) return null;
  if (IPV4_PATTERN.test(host) || host === 'localhost') return null;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

  return host;
}

/** Read ECP support out of a merchant `/.well-known/ucp` profile. */
export function readMerchantProfile(profile: unknown): MerchantProfileSummary {
  const ucp =
    profile && typeof profile === 'object'
      ? (profile as { ucp?: unknown }).ucp
      : undefined;

  if (!ucp || typeof ucp !== 'object') {
    return { embedded: false, delegates: [], transports: [] };
  }

  const metadata = ucp as ShopifyUCPMetadata;
  const services = metadata.services?.['dev.ucp.shopping'] ?? [];
  const transports = [
    ...new Set(
      services
        .map((service) => service?.transport)
        .filter((transport): transport is string => typeof transport === 'string')
    ),
  ];
  const binding = readEmbeddedBinding(metadata);
  const mcpEndpoint = services.find(
    (service) => service?.transport === 'mcp' && typeof service.endpoint === 'string'
  )?.endpoint;

  return {
    embedded: binding.available,
    delegates: binding.delegates,
    transports,
    ...(typeof metadata.version === 'string' ? { version: metadata.version } : {}),
    ...(mcpEndpoint ? { mcpEndpoint } : {}),
  };
}

// ── Cache + probe ───────────────────────────────────────────────────────

type CachedValue = Omit<MerchantCapabilities, 'cached'>;

interface CacheEntry {
  value: CachedValue;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CachedValue>>();

/** Drop cached probes. Exposed for tests and for forced re-checks. */
export function clearMerchantCapabilityCache(): void {
  cache.clear();
  inflight.clear();
}

function remember(shopDomain: string, value: CachedValue, expiresAt: number): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(shopDomain)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(shopDomain, { value, expiresAt });
}

async function probe(
  shopDomain: string,
  timeoutMs: number
): Promise<CachedValue> {
  const profileUrl = `https://${shopDomain}${DISCOVERY_PATH}`;
  const fetchedAt = new Date().toISOString();
  const empty = {
    embedded: false,
    delegates: [],
    transports: [],
  } satisfies MerchantProfileSummary;

  try {
    const response = await fetch(profileUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        shopDomain,
        profileUrl,
        ok: false,
        error: `profile_unavailable (${response.status})`,
        ...empty,
        fetchedAt,
      };
    }

    const summary = readMerchantProfile((await response.json()) as unknown);
    if (!summary.version) {
      return {
        shopDomain,
        profileUrl,
        ok: false,
        error: 'invalid_profile',
        ...summary,
        fetchedAt,
      };
    }

    return { shopDomain, profileUrl, ok: true, ...summary, fetchedAt };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      shopDomain,
      profileUrl,
      ok: false,
      error: timedOut ? 'timeout' : 'fetch_failed',
      ...empty,
      fetchedAt,
    };
  }
}

export interface MerchantCapabilityOptions {
  /** Bypass a fresh cache entry. */
  forceRefresh?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
}

/**
 * Probe a merchant's `/.well-known/ucp` profile for ECP advertisement.
 *
 * Cached per normalized domain; concurrent callers share one request. Failures
 * are cached briefly so a dead merchant doesn't get retried on every search.
 */
export async function getMerchantCapabilities(
  shopDomainInput: string,
  options: MerchantCapabilityOptions = {}
): Promise<MerchantCapabilities> {
  const shopDomain = normalizeShopDomain(shopDomainInput);
  if (!shopDomain) throw new InvalidMerchantDomainError(shopDomainInput);

  const {
    forceRefresh = false,
    ttlMs = DEFAULT_DISCOVERY_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!forceRefresh) {
    const entry = cache.get(shopDomain);
    if (entry && entry.expiresAt > Date.now()) {
      return { ...entry.value, cached: true };
    }
  }

  const pending = inflight.get(shopDomain);
  if (pending) {
    return { ...(await pending), cached: false };
  }

  const request = probe(shopDomain, timeoutMs)
    .then((value) => {
      const ttl = value.ok ? ttlMs : Math.min(ttlMs, FAILURE_TTL_MS);
      remember(shopDomain, value, Date.now() + ttl);
      return value;
    })
    .finally(() => {
      inflight.delete(shopDomain);
    });

  inflight.set(shopDomain, request);
  return { ...(await request), cached: false };
}
