import { NextResponse } from 'next/server';
import { UCP_AGENT_PROFILE } from '@/lib/ucp/profile';

/**
 * GET /.well-known/ucp
 *
 * UCP discovery endpoint. Serves the same agent profile as
 * `/ucp-agent-profile.json` (source of truth: `lib/ucp/profile.ts`)
 * so verifiers that probe the well-known location get the truthful
 * capability set (cart + catalog.search/lookup, no native checkout).
 */
export async function GET() {
  return NextResponse.json(UCP_AGENT_PROFILE, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
