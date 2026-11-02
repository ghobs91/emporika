import { NextRequest, NextResponse } from 'next/server';
import { getMerchantCapabilities, normalizeShopDomain } from '@/lib/ucp/discovery';

/**
 * GET /api/shopify/capabilities?shopDomain=…&refresh=1
 *
 * Read-only merchant discovery: does this merchant advertise the `embedded`
 * transport (ECP) in `/.well-known/ucp`? Results are cached in memory for an
 * hour (five minutes for failures), so it is cheap to call per merchant.
 *
 * This is a candidate filter only. The authoritative signal is the per-checkout
 * `ucp.services…config.delegate` returned by `/api/shopify/checkout`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raw = params.get('shopDomain');

  if (!raw) {
    return NextResponse.json(
      { error: 'shopDomain query parameter is required' },
      { status: 400 }
    );
  }

  const shopDomain = normalizeShopDomain(raw);
  if (!shopDomain) {
    return NextResponse.json(
      { error: 'shopDomain must be a public hostname, e.g. example.myshopify.com' },
      { status: 400 }
    );
  }

  const refresh = params.get('refresh');
  const forceRefresh = refresh === '1' || refresh === 'true';

  try {
    const capabilities = await getMerchantCapabilities(shopDomain, { forceRefresh });
    return NextResponse.json(capabilities, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Merchant capability probe failed:', error);
    return NextResponse.json(
      { error: 'Failed to probe merchant capabilities' },
      { status: 500 }
    );
  }
}
