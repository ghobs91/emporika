# Costco API Integration Setup for Netlify

## Overview
The Costco API requires bot detection cookies that expire every 2-4 hours. This setup automatically manages cookie refresh on Netlify.

## How It Works

1. **Automatic Cookie Fetching**: When no cookies are cached, the system automatically fetches fresh ones from Costco.com
2. **Scheduled Refresh**: A Netlify scheduled function runs every hour to keep cookies fresh
3. **Graceful Fallback**: If cookies can't be obtained, Costco results are simply skipped (other retailers still work)

## Deployment Steps

### 1. Deploy to Netlify
```bash
git push origin main
```

### 2. Enable Scheduled Functions (Optional but Recommended)
Netlify will automatically detect and enable the scheduled function in:
- `netlify/functions/refresh-costco-cookies.mts`

This runs every hour to proactively refresh cookies.

### 3. Manual Cookie Refresh (If Needed)
If you want to manually set cookies:

```bash
# Get fresh cookies by visiting your deployed site
curl -X POST https://your-site.netlify.app/api/costco/refresh-cookie

# Or set cookies manually via environment variable
# In Netlify Dashboard: Site settings > Environment variables
# Add: COSTCO_COOKIES = "ak_bmsc=...; bm_sz=..."
```

## Testing

### Check Cookie Status
```bash
curl https://your-site.netlify.app/api/costco/refresh-cookie
```

### Test Search with Costco
```bash
curl "https://your-site.netlify.app/api/search?query=humidifier"
```

## Architecture

```
Request → Costco API Client
           ↓
       Check Cache (global in dev, memory in prod)
           ↓
       If empty → Fetch fresh cookies automatically
           ↓
       Make API request with cookies
```

## Troubleshooting

### "No cookies configured" in logs
This is normal if:
- First request after deployment (cookies auto-fetch on first search)
- Cookies expired (will auto-refresh on next search)

The system automatically handles this - no action needed.

### Cookies keep expiring
The scheduled function should prevent this, but if issues persist:
1. Check Netlify Functions logs to ensure the scheduled function is running
2. Verify the scheduled function has the correct site URL in environment

## Environment Variables (Optional)

| Variable | Description | Required |
|----------|-------------|----------|
| `COSTCO_API_KEY` | API key for Costco search API | No (has default) |
| `COSTCO_COOKIES` | Manual cookie override | No (auto-fetched) |

## Notes

- Cookies are fetched automatically on-demand in production
- The global cache works in development mode only
- In production (Netlify), each function invocation may need to fetch cookies
- The scheduled function helps keep them cached longer
- If Costco fails, the app continues to work with the other 4 retailers
