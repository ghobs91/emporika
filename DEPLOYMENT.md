# Deploying Emporika to Netlify

## Prerequisites

1. A Netlify account
2. Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Set Environment Variables in Netlify

Go to **Netlify > Site settings > Environment variables** and add the following.  
Empty/optional vars can be skipped.

### eBay (required for eBay search)
| Variable | Required | Notes |
|---|---|---|
| `EBAY_CLIENT_ID` | ✅ | App ID (Client ID) from developer.ebay.com |
| `EBAY_CLIENT_SECRET` | ✅ | Cert ID (Client Secret) from developer.ebay.com |
| `EBAY_SANDBOX` | ❌ | Set to `true` if using sandbox keys; omit for production |

### Walmart (required)
| Variable | Required |
|---|---|
| `WALMART_CONSUMER_ID` | ✅ |
| `WALMART_KEY_VERSION` | ✅ (usually `"1"`) |
| `WALMART_PRIVATE_KEY_BASE64` | ✅ |

### Best Buy (required)
| Variable | Required |
|---|---|
| `BESTBUY_API_KEY` | ✅ |

### Target (optional)
| Variable | Required | Default |
|---|---|---|
| `TARGET_STORE_ID` | ❌ | `"1264"` |
| `TARGET_ZIP` | ❌ | `"10001"` |

### Costco (optional)
| Variable | Required |
|---|---|
| `COSTCO_COOKIES` | ❌ |
| `COSTCO_API_KEY` | ❌ |
| `COSTCO_REFRESH_SECRET` | ❌ |

### Shopify (optional)
| Variable | Required |
|---|---|
| `SHOPIFY_CLIENT_ID` | ❌ |
| `SHOPIFY_CLIENT_SECRET` | ❌ |

### Internal
| Variable | Required |
|---|---|
| `CRON_SECRET` | ❌ (secures cron endpoints) |

## Step 2: Set Env Vars via CLI (or use the Netlify UI)

```bash
# eBay (add these now)
netlify env:set EBAY_CLIENT_ID "your-client-id"
netlify env:set EBAY_CLIENT_SECRET "your-client-secret"
# Only if using sandbox:
# netlify env:set EBAY_SANDBOX "true"

# Walmart
netlify env:set WALMART_CONSUMER_ID "your-consumer-id"
netlify env:set WALMART_KEY_VERSION "1"
netlify env:set WALMART_PRIVATE_KEY_BASE64 "your-base64-key"

# Best Buy
netlify env:set BESTBUY_API_KEY "your-api-key"

# Optional retailers
netlify env:set COSTCO_COOKIES "..."
netlify env:set SHOPIFY_CLIENT_ID "..."
netlify env:set SHOPIFY_CLIENT_SECRET "..."
```

## Step 3: Push & Deploy

```bash
git add .
git commit -m "Add eBay credentials and deployment config"
git push
```

Netlify auto-detects Next.js and will pick up the `netlify.toml` config.

## Step 4: Verify

1. Visit your Netlify URL
2. Search for a product — eBay results should appear in the grid
3. Check browser DevTools > Network for any API errors

## Troubleshooting

### eBay `invalid_client` error

1. Run the diagnostic script locally first:
   ```bash
   export $(grep -E '^EBAY_' .env.local | xargs)
   node scripts/diagnose-ebay.mjs
   ```
2. Make sure you used the **App ID (Client ID)** and **Cert ID (Client Secret)** — not the Dev ID.
3. Sandbox keys need `EBAY_SANDBOX=true`.
4. Production keys should NOT have `EBAY_SANDBOX` set.

### API Routes 404

- Netlify supports Next.js 15+ natively — no extra config needed.
- Check the Netlify function logs in your dashboard.

### Build Failures

- Check build logs in Netlify dashboard.
- Verify Node version is set to 20 in `netlify.toml`.
