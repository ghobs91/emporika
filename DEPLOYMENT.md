# Deploying Emporika to Netlify

This guide walks through deploying the Emporika application to Netlify.

## Prerequisites

1. A Netlify account
2. Walmart API credentials (Consumer ID and Private Key)
3. Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Prepare Your Environment Variables

You'll need to set the following environment variables in Netlify:

1. **WALMART_CONSUMER_ID**: Your Walmart API Consumer ID
2. **WALMART_KEY_VERSION**: Usually "1"
3. **WALMART_PRIVATE_KEY_BASE64**: Your private key encoded as base64

To generate the base64-encoded private key, run:

```bash
cat WM_IO_private_key.pem | base64 | tr -d '\n'
```

Copy the entire output (it will be one long string).

## Step 2: Push to Git

Make sure your code is pushed to a Git repository:

```bash
git add .
git commit -m "Prepare for Netlify deployment"
git push
```

## Step 3: Deploy to Netlify

### Option A: Using Netlify Web UI

1. Go to [Netlify](https://app.netlify.com/)
2. Click "Add new site" → "Import an existing project"
3. Connect to your Git provider and select your repository
4. Netlify will auto-detect Next.js settings:
   - **Build command**: `next build` (auto-detected)
   - **Publish directory**: `.next` (auto-detected)
5. Click "Show advanced" → "Add environment variable"
6. Add each environment variable:
   - `WALMART_CONSUMER_ID`
   - `WALMART_KEY_VERSION`
   - `WALMART_PRIVATE_KEY_BASE64`
7. Click "Deploy site"

### Option B: Using Netlify CLI

1. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```

2. Login to Netlify:
   ```bash
   netlify login
   ```

3. Initialize and deploy:
   ```bash
   netlify init
   netlify env:set WALMART_CONSUMER_ID "your_consumer_id"
   netlify env:set WALMART_KEY_VERSION "1"
   netlify env:set WALMART_PRIVATE_KEY_BASE64 "your_base64_key"
   netlify deploy --prod
   ```

## Step 4: Verify Deployment

Once deployed, test your site:

1. Visit your Netlify URL (e.g., `https://your-site.netlify.app`)
2. Try searching for products
3. Check the trending feed
4. Open browser DevTools to check for any API errors

## Troubleshooting

### API Routes Not Working

If API routes return 404:
- Ensure you're using Next.js 15+ which Netlify supports natively
- Check the Netlify function logs in your dashboard

### Authentication Errors

If you get Walmart API authentication errors:
- Verify your `WALMART_PRIVATE_KEY_BASE64` is correct (no extra newlines or spaces)
- Ensure your Consumer ID and Key Version are correct
- Check that your private key matches your Consumer ID

### Build Failures

- Check the build logs in Netlify dashboard
- Ensure all dependencies are in `package.json`
- Verify Node version is set to 20 in `netlify.toml`

## Configuration Files

The deployment uses:
- **netlify.toml**: Netlify configuration (Node version, headers)
- **.env.example**: Template for environment variables
- **next.config.ts**: Next.js configuration (image domains)

## Custom Domain (Optional)

To add a custom domain:
1. Go to your site in Netlify
2. Click "Domain settings"
3. Click "Add custom domain"
4. Follow the DNS configuration instructions
