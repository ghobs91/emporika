#!/usr/bin/env node
/**
 * Diagnose eBay OAuth credentials.
 *
 * Usage from project root:
 *   node scripts/diagnose-ebay.mjs
 *
 * If you keep credentials in .env.local, load them first:
 *   export $(grep -E '^EBAY_' .env.local | xargs) && node scripts/diagnose-ebay.mjs
 */

const clientId = process.env.EBAY_CLIENT_ID || '';
const clientSecret = process.env.EBAY_CLIENT_SECRET || '';

function mask(str) {
  if (!str) return '(empty)';
  if (str.length <= 8) return '*'.repeat(str.length);
  return str.slice(0, 4) + '...' + str.slice(-4);
}

function hasSandboxMarker(str) {
  return /SBX|SANDBOX/i.test(str);
}

async function tryOAuth({ name, oauthBase, scope }) {
  const url = `${oauthBase}/identity/v1/oauth2/token`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  console.log(`\n--- Trying ${name} ---`);
  console.log('Endpoint:', url);
  console.log('Scope:', scope);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope,
      }),
    });

    const text = await response.text();
    console.log('Status:', response.status, response.statusText);
    console.log('Response:', text.slice(0, 500));

    if (response.ok) {
      const data = JSON.parse(text);
      console.log('✅ SUCCESS — access_token starts with:', data.access_token?.slice(0, 20));
      return true;
    }
  } catch (err) {
    console.error('Network error:', err.message);
  }
  return false;
}

async function main() {
  console.log('EBAY_CLIENT_ID:', mask(clientId));
  console.log('EBAY_CLIENT_SECRET:', mask(clientSecret));
  console.log('Sandbox marker detected:', hasSandboxMarker(clientId) || hasSandboxMarker(clientSecret));

  if (!clientId || !clientSecret) {
    console.error('\n❌ EBAY_CLIENT_ID and/or EBAY_CLIENT_SECRET are not set.');
    process.exit(1);
  }

  const prodOk = await tryOAuth({
    name: 'Production',
    oauthBase: 'https://api.ebay.com',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const sandboxOk = await tryOAuth({
    name: 'Sandbox',
    oauthBase: 'https://api.sandbox.ebay.com',
    scope: 'https://api.sandbox.ebay.com/oauth/api_scope',
  });

  console.log('\n--- Summary ---');
  if (prodOk && sandboxOk) {
    console.log('Both environments worked (unusual — check which keyset this is).');
  } else if (prodOk) {
    console.log('✅ Production credentials are valid. Make sure the app uses production endpoints.');
  } else if (sandboxOk) {
    console.log('✅ Sandbox credentials are valid. Make sure the app uses sandbox endpoints.');
  } else {
    console.log('❌ Credentials failed for both production and sandbox.');
    console.log('   - Verify the values at https://developer.ebay.com/my/keys');
    console.log('   - Ensure you copied the Client ID (App ID) and Client Secret (Cert ID), not the Dev ID.');
    console.log('   - Regenerate the keys if they were rotated.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
