# Emporika — Intelligent Federated Shopping Search

A production-quality universal shopping search engine that federates product discovery across multiple retailers with AI-assisted natural-language query planning and deterministic ranking.

## Architecture

```
Browser Query
  → [WebLLM] creates SearchPlan JSON (optional, progressive enhancement)
  → browser sends query + candidate plan to backend
  → backend validates plan
  → backend searches eligible retail providers concurrently
  → backend normalizes and entity-resolves results
  → backend deterministically filters and ranks products/offers
  → backend returns structured results
  → browser renders ranked products with offer comparisons
```

The search engine works without WebLLM. WebLLM is **progressive enhancement**, not a hard dependency.

## End-to-End Request Flow

1. User types a natural-language query (e.g., "best waterproof trail running shoes under $150 that ship to 11756; prioritize trail grip and wide sizes")
2. **Browser**: If WebLLM is available, it generates a `SearchPlan` with parsed constraints, search queries, and ranking criteria
3. **Browser**: Sends `POST /api/search` with the query, preferences, and candidate plan
4. **Server**: Validates the plan (or falls back to deterministic planning)
5. **Server**: Determines eligible providers based on plan + capabilities
6. **Server**: Searches all eligible providers concurrently with timeout/retry
7. **Server**: Normalizes results into common `ProviderProductCandidate` format
8. **Server**: Entity-resolves equivalent products across retailers (by title similarity)
9. **Server**: Applies deterministic hard filters (price, condition, availability, brands, features)
10. **Server**: Ranks products and offers using plan-specified criteria weights
11. **Server**: Returns `SearchApiResponse` with ranked products, metadata, and source coverage
12. **Browser**: Renders ranked product cards with offer comparisons, reasons, tradeoffs, and ranking transparency

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript end-to-end
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **Validation**: Zod
- **Testing**: Vitest
- **API Integration**: Walmart, Best Buy, eBay, Shopify Global Catalog MCP (server-side) + Back Market, Costco (collected in the user's browser by `extension/`). **Target is disabled** — see below for why, and for what is parked rather than deleted.
- **AI**: WebLLM architecture (progressive enhancement, currently mock fallback)

## Retailer API Access

All retailer API credentials are **server-side only**. The browser never receives API keys, tokens, provider URLs, or raw provider responses. This is a hard security boundary:

- **Browser**: Only receives structured, sanitized `SearchApiResponse` JSON
- **Server**: The only layer allowed to access retailer APIs, Shopify MCP, and credentials
- **WebLLM**: Runs locally in browser; never transmits prompts or user search text to any server

### Retailers that cannot be searched from a server

Costco's search endpoint is Kasada-guarded (`gdx-api.costco.com` returns HTTP 429 with challenge headers) and Back Market has never had a public search API, so both are collected in the user's own browser.

**Target is disabled (2026-11).** It was re-enabled once and served from a
locally built catalog index, which worked for titles, images and ratings but
never for price. Every route to price was measured and closed: Node, the
extension service worker, a page's main world from both the homepage and the
search page, a fresh profile, a real user profile with history, and seven
retries over twenty seconds — all HTTP 435 PerimeterX. The remaining options
were a visible tab per search or licensed data, and neither was taken.

Everything below still works and is still tested; it is parked, not deleted.
Reviving Target means deleting the entry in `search/providers/availability.ts`
and restoring the app-side wiring.

The catalog pipeline, for the record: `redsky.target.com` returns an HTTP 435 PerimeterX challenge to every non-navigation request, and the storefront HTML is a Next.js shell on every URL form — a canonical product page returns 200 but carries no price, availability or `schema.org` `Product`. What Target *does* publish for crawlers is its product sitemap (`sitemap_pdp-index.xml.gz`: ~106 shards, ~2.5M product URLs), so two scripts turn that into a local catalog:

```bash
npx tsx scripts/target-sitemap.ts --all   # download all shards (ETag-incremental, ~920MB once)
npx tsx scripts/target-index-build.ts     # build the SQLite FTS5 index (~1GB)
npx tsx scripts/target-precompute.ts      # generate the runtime artifact (~0.6MB)
```

`lib/target-index.ts` can query the SQLite database in-process via the built-in `node:sqlite` (Node ≥ 22.5) — arbitrary queries, full 2.6M-product recall. The retailer is never contacted at search time. Re-running the first script HEADs every shard and downloads only those whose ETag moved, so a scheduled refresh costs a few MB rather than ~920MB.

**A ~1GB database cannot run on a host with no persistent disk**, so production serves from `data/target-precomputed.json` instead: `scripts/target-precompute.ts` runs the real index over a curated query vocabulary (observed trends + the brand catalogue + common shopping seeds) and commits the results, which `lib/target-precomputed.ts` answers from with an in-memory object lookup (~1ms, no I/O). The artifact is ~1,000 queries / ~8,000 hits / 0.6MB.

The adapter prefers whichever backend is present: SQLite when there is a filesystem, the precomputed map otherwise. Coverage is explicit — a query outside the vocabulary reports *"Target results are precomputed for N curated searches and this query is not one of them"* rather than claiming Target has no matching products.

**The published sitemap is not Target's whole assortment.** It covers Target's own brands densely (`a new day` 2,768 titles, `wild fable` 1,849, `universal thread` 1,091) and the long marketplace tail, but at least some licensed brands are absent or near-absent: `nike` appears as a leading word in 43 of 2.6M titles and `adidas` in 29. So 2.6M is the size of the *enumeration*, not of Target's real catalogue, and Target results will systematically miss those brands. Fixing that would need a source Target does not publish.

**Netlify note:** `netlify.toml` pins `NODE_VERSION = "20"`, which has no `node:sqlite`. The precomputed path does not need it, so production works on Node 20; only the build-time index commands require ≥22.5.

The consequence is a deliberate capability limit: Target answers "does Target carry something matching these words, and where do I link to it" — and **not** price, availability, shipping, ratings or images. Those are reported as unavailable rather than guessed.

The browser-collected retailers are fetched by the extension in `extension/`, then posted to `/api/search` as pre-supplied results and passed through the same normalize → entity-resolution → filter → rank pipeline as every API-backed provider. Ranking never moves to the client. See `extension/README.md` for the verification details and the capture harness.

Retailers that are entirely off are declared once, in `search/providers/availability.ts`, and honoured by the orchestrator, `?sources=`, the retailer pickers and the extension. That registry is currently empty.

A retailer that cannot be reached is reported in `metadata.providersUnavailable` with a shopper-facing reason, and rendered by `ProviderStatusBar`. It is never reported as "this retailer has no matches".

## Provider Adapter Architecture

Each retailer has a dedicated adapter implementing `RetailerSearchProvider`:

| Provider | Transport | Capabilities |
|----------|-----------|-------------|
| **Walmart** | server | Keyword search, shipping data, availability |
| **Best Buy** | server | Keyword search, brand/price filters, rich category/manufacturer data |
| **Target** | — (**disabled**) | Vertex issue: price is only served by a PerimeterX-guarded host. Catalog index (titles/images/ratings) is built and parked; see above |
| **eBay** | server | Keyword search, GTIN lookup, condition/price filters, marketplace seller data |
| **Costco** | browser extension (server fallback) | Keyword search, availability |
| **Shopify** | server | Full keyword search, category/brand/price/destination filters, variants, seller data (Global Catalog MCP) |
| **Back Market** | browser extension only | Keyword search, refurbished condition, brand/model |

Unsupported filters are explicitly reported in `metadata.unsupportedFilters`. Adapters never pretend an unsupported filter was applied. Unreachable retailers are reported in `metadata.providersUnavailable`, and deliberately disabled ones in `search/providers/availability.ts`. A retailer whose data source is missing on this deployment reports `index_unavailable`, so "not built here" is never shown as "has no matches".

## Entity Resolution

Cross-retailer product matching uses title similarity (Jaccard-like token overlap). In priority order:

1. **Shopify UPID** — within Shopify, same UPID = same product
2. **Title similarity > 90%** → medium confidence merge
3. **Title similarity > 75%** → low confidence merge
4. Below 75% → kept separate (avoids false merges)

The system never merges products with different model numbers, generations, variants, or conditions. Match confidence is preserved for diagnostic transparency.

## Ranking Engine

Ranking is **deterministic server-side code** — the LLM does not determine final rank.

Each plan specifies up to 8 ranking criteria with weights summing to 1.0:

- `price`, `featureMatch`, `availability`, `shipping`, `pickup`
- `seller`, `retailer`, `brandPreference`, `variantFit`, `condition`, `preferenceFit`

Rules:
- Rank canonical product fit first, then offers within each product
- Compare prices only when currency, condition, and variant are comparable
- Penalize missing data (never award favorable assumptions)
- Prefer new condition by default
- Use stable tie-breakers for deterministic results
- Never claim "best everywhere" or "lowest price online"

## WebLLM (Progressive Enhancement)

Architecture for browser-local AI planning using `@mlc-ai/web-llm`:

- **Default model**: Qwen3-1.7B-q4f16_1-MLC
- **Low-memory fallback**: Qwen3-4B-q4f16_1-MLC
- **Enhanced model**: Qwen3-8B-q4f16_1-MLC
- **Role**: Parse natural-language queries into `SearchPlan` JSON
- **Not used for**: Factual product data, pricing, filtering, ranking

Currently using a mock adapter (always falls back to deterministic planning). To enable actual WebLLM, replace the adapter in `lib/webllm/client.ts`.

WebGPU compatibility is detected cleanly. If unavailable, the app degrades gracefully to "fast search mode" with the deterministic fallback planner.

## Environment Variables

```
# Walmart API
WALMART_CONSUMER_ID=
WALMART_PRIVATE_KEY_BASE64=
WALMART_KEY_VERSION=1

# Best Buy API
BESTBUY_API_KEY=

# Target store context (INERT — Target is disabled)
# Redsky answers every non-navigation request with an HTTP 435 PerimeterX
# challenge, so Target is disabled in search/providers/availability.ts.
TARGET_STORE_ID=
TARGET_ZIP=

# eBay API
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_SANDBOX=false   # set true when using eBay sandbox keys

# Costco (enables the server-side fallback path; the API is edge-blocked)
# Costco is normally collected by the browser extension instead.
COSTCO_COOKIES=
COSTCO_API_KEY=
COSTCO_REFRESH_SECRET=

# Cron auth (when set, /api/cron/refresh-costco requires this as Bearer token)
CRON_SECRET=

# Shopify
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_AGENT_PROFILE=
# Optional buyer-linked token (JWT) for personalized catalog + checkout auto-discounts
SHOPIFY_BUYER_TOKEN=

# WebLLM (optional, progressive enhancement)
NEXT_PUBLIC_WEBLLM_ENABLED=true
NEXT_PUBLIC_WEBLLM_DEFAULT_MODEL=Qwen3-1.7B-q4f16_1-MLC
NEXT_PUBLIC_WEBLLM_LOW_MEMORY_MODEL=Qwen3-4B-q4f16_1-MLC
NEXT_PUBLIC_WEBLLM_ENHANCED_MODEL=Qwen3-8B-q4f16_1-MLC
NEXT_PUBLIC_BASE_URL=   # base URL for cron self-calls (optional; VERCEL_URL is auto-set on Vercel)

# Search configuration
SEARCH_MAX_PROVIDER_QUERIES=5
SEARCH_MAX_CONCURRENCY=4
SEARCH_MAX_ENRICHMENT_PRODUCTS=15
SEARCH_TIMEOUT_MS=20000
PROVIDER_TOOL_TIMEOUT_MS=8000
PLANNER_CLARIFICATION_THRESHOLD=0.55
```

## Local Development

```bash
npm install
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Production build
npm run test       # Run tests
npm run test:watch # Watch mode
```

## Testing

Vitest with 107 tests across 13 test files:

```bash
npm test
```

Test categories:
- **Schema validation**: SearchPlan parsing, rejection of invalid plans, weight validation
- **Ranking engine**: Price/availability/condition scoring, determinism, breakdown generation
- **Entity resolution**: Title matching, dissimilarity detection, empty input handling
- **Provider selection**: Capability-based provider eligibility and query fan-out
- **Planning & filtering**: Size/category extraction, adjacent-category exclusions
- **Interaction learning**: Deterministic preference derivation from local signals
- **Shopify UCP**: Cart and Checkout MCP lifecycle (mocked fetch)

Tests do not require WebGPU, browser model download, live retailer APIs, or Shopify MCP access.

## Security & Privacy

- All retailer credentials are server-side only
- Raw provider responses and product images are not cached or persisted beyond request lifecycle
- Anonymous request IDs and aggregate telemetry are acceptable
- Never retain: API credentials, OAuth tokens, MCP authorization headers, full raw catalog data, identifiable user prompts, browser GPU fingerprints
- WebLLM prompts remain local to the browser; never transmitted to analytics

## Known Limitations

- **Incomplete fields**: Not all providers supply price, shipping, availability, brand, or condition data
- **Variant comparability**: Cross-retailer variant matching is title-based; exact option matching limited
- **Unsupported filters**: Many providers do not support brand/price/destination filters — these are labeled as unsupported
- **Source coverage**: Results reflect only the searched sources, not the entire web
- **No guaranteed data**: Shipping estimates, return policies, and availability claims are only as good as provider data
- **Entity resolution**: Currently title-similarity based; GTIN/UPC/MPN matching requires those fields from providers

## Replacing WebLLM

To use a self-hosted or server-hosted OpenAI-compatible planner instead of browser-local WebLLM:

1. Keep the `SearchPlan` schema (it's provider-neutral)
2. Create a server-side planner that calls your LLM API
3. Validate the output with the same Zod schemas
4. Return the validated plan to the orchestrator
5. Optionally remove the `lib/webllm/` directory

The search orchestrator accepts any valid `SearchPlan` regardless of source.

## Project Structure

```
emporika/
├── app/
│   ├── api/
│   │   ├── search/route.ts               # GET (simple) + POST (intelligent) search API
│   │   ├── trending/route.ts             # Trending products feed
│   │   ├── target/nearest-store/route.ts # Nearest Target store lookup
│   │   ├── shopify/cart/route.ts         # Shopify cart operations
│   │   ├── costco/
│   │   │   ├── set-cookie/route.ts       # Store Costco session cookie
│   │   │   └── refresh-cookie/route.ts   # Refresh Costco session cookie
│   │   └── cron/refresh-costco/route.ts  # Cron entry point (Vercel Cron in vercel.json)
│   ├── images/                           # Retailer favicons
│   ├── offline/page.tsx                  # PWA offline page
│   ├── layout.tsx                        # Root layout
│   └── page.tsx                          # Main search UI
├── components/                           # UI: SearchBar, ProductCard, ProductResultCard,
│                                         # SearchStatus, WebLLMStatus, ClarificationPrompt,
│                                         # SearchFilters, Sidebar, Pagination, SortSelect,
│                                         # RetailerToggle, CartDrawer, TrendingFeed, PWAInstallPrompt, ...
├── context/
│   └── CartContext.tsx                   # Client-side cart state
├── hooks/
│   ├── useIntelligentSearch.ts           # Intelligent search flow
│   ├── useMerchantCheckout.ts            # Merchant checkout handling
│   └── useTargetStore.ts                 # Target store selection
├── search/
│   ├── types.ts                          # All domain types
│   ├── schemas.ts                        # Zod schemas (SearchPlan, request)
│   ├── orchestrator.ts                   # Main search pipeline
│   ├── planner.ts                        # Deterministic fallback planner
│   ├── normalize.ts                      # Candidate normalization
│   ├── entity-resolution.ts              # Cross-retailer ER
│   ├── offer-normalize.ts                # Offer comparability
│   ├── filter.ts                         # Deterministic hard filters
│   ├── ranker.ts                         # Deterministic ranking engine
│   ├── errors.ts                         # Typed error classes
│   ├── telemetry.ts                      # Structured logging
│   └── providers/
│       ├── capabilities.ts               # Provider capability definitions
│       └── adapter.ts                    # Provider adapters (wraps existing API clients)
├── lib/
│   ├── webllm/
│   │   ├── types.ts                      # WebLLM adapter interface + model defaults
│   │   ├── client.ts                     # WebLLM client (singleton)
│   │   ├── mock-adapter.ts               # Mock adapter (always degrades gracefully)
│   │   ├── real-adapter.ts               # Real WebLLM adapter
│   │   ├── worker.ts                     # WebLLM worker wiring
│   │   └── prompts.ts                    # Versioned prompts
│   ├── bestbuy.ts / ebay.ts / target.ts / walmart.ts / costco.ts / shopify.ts  # Retailer API clients
│   ├── costco-cookie-cache.ts            # In-memory Costco cookie cache
│   ├── costco-cookie-fetcher.ts          # Costco cookie fetcher
│   └── retailer.ts                       # Retailer registry
├── tests/
│   └── search/
│       ├── schemas.test.ts               # SearchPlan validation tests
│       ├── ranker.test.ts                # Ranking engine tests
│       ├── entity-resolution.test.ts     # Entity resolution tests
│       └── provider-selection.test.ts    # Provider eligibility tests
├── types/                                # Retailer-specific type definitions
├── scripts/
│   └── diagnose-ebay.mjs                 # eBay integration diagnostics
├── public/                               # Static assets, PWA icons, sw.js (generated)
├── netlify.toml                          # Netlify config (headers, Node 20)
├── vercel.json                           # Vercel config (Costco cookie refresh cron)
├── next.config.ts                        # Next.js + PWA config, image domains
└── vitest.config.ts                      # Vitest (node env, @ → root alias)
```
