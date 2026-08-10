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
- **API Integration**: Walmart, Best Buy, Target, eBay, Costco, Shopify Global Catalog MCP
- **AI**: WebLLM architecture (progressive enhancement, currently mock fallback)

## Retailer API Access

All retailer API credentials are **server-side only**. The browser never receives API keys, tokens, provider URLs, or raw provider responses. This is a hard security boundary:

- **Browser**: Only receives structured, sanitized `SearchApiResponse` JSON
- **Server**: The only layer allowed to access retailer APIs, Shopify MCP, and credentials
- **WebLLM**: Runs locally in browser; never transmits prompts or user search text to any server

## Provider Adapter Architecture

Each retailer has a dedicated adapter implementing `RetailerSearchProvider`:

| Provider | Capabilities |
|----------|-------------|
| **Walmart** | Keyword search, shipping data, availability |
| **Best Buy** | Keyword search, brand/price filters, rich category/manufacturer data |
| **Target** | Keyword search, store-level pricing, pickup availability |
| **eBay** | Keyword search, GTIN lookup, condition/price filters, marketplace seller data |
| **Costco** | Keyword search, availability (requires session cookies) |
| **Shopify** | Full keyword search, category/brand/price/destination filters, variants, seller data (Global Catalog MCP) |

Unsupported filters are explicitly reported in `metadata.unsupportedFilters`. Adapters never pretend an unsupported filter was applied.

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
- **Low-memory fallback**: Qwen3-1.7B-q4f16_1-MLC
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

# Target API
TARGET_STORE_ID=
TARGET_ZIP=

# eBay API
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=

# Costco
COSTCO_COOKIES=

# Shopify
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_AGENT_PROFILE=

# WebLLM (optional, progressive enhancement)
NEXT_PUBLIC_WEBLLM_ENABLED=true
NEXT_PUBLIC_WEBLLM_DEFAULT_MODEL=Qwen3-1.7B-q4f16_1-MLC
NEXT_PUBLIC_WEBLLM_LOW_MEMORY_MODEL=Qwen3-1.7B-q4f16_1-MLC

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

Vitest with 19 tests across 3 test files:

```bash
npm test
```

Test categories:
- **Schema validation**: SearchPlan parsing, rejection of invalid plans, weight validation
- **Ranking engine**: Price/availability/condition scoring, determinism, breakdown generation
- **Entity resolution**: Title matching, dissimilarity detection, empty input handling

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
│   ├── api/search/route.ts     # GET (simple) + POST (intelligent) search API
│   └── page.tsx                # Main search UI
├── components/
│   ├── ProductResultCard.tsx    # Intelligent ranked product card
│   ├── SearchStatus.tsx         # Source coverage & status
│   ├── WebLLMStatus.tsx         # AI planner status indicator
│   ├── ClarificationPrompt.tsx  # Clarification question UI
│   └── ...                      # Existing components (SearchBar, ProductCard, etc.)
├── search/
│   ├── types.ts                 # All domain types
│   ├── schemas.ts               # Zod schemas (SearchPlan, request)
│   ├── orchestrator.ts          # Main search pipeline
│   ├── planner.ts               # Deterministic fallback planner
│   ├── normalize.ts             # Candidate normalization
│   ├── entity-resolution.ts     # Cross-retailer ER
│   ├── offer-normalize.ts       # Offer comparability
│   ├── filter.ts                # Deterministic hard filters
│   ├── ranker.ts                # Deterministic ranking engine
│   ├── errors.ts                # Typed error classes
│   ├── telemetry.ts             # Structured logging
│   └── providers/
│       ├── capabilities.ts      # Provider capability definitions
│       └── adapter.ts           # Provider adapters (wraps existing API clients)
├── lib/
│   ├── webllm/
│   │   ├── types.ts             # WebLLM adapter interface
│   │   ├── client.ts            # WebLLM client (singleton)
│   │   ├── prompts.ts           # Versioned prompts
│   │   └── mock-adapter.ts      # Mock adapter (always degrades gracefully)
│   └── ...                      # Existing retailer API clients
├── hooks/
│   └── useIntelligentSearch.ts  # React hook for intelligent search flow
├── tests/
│   └── search/
│       ├── schemas.test.ts      # SearchPlan validation tests
│       ├── ranker.test.ts       # Ranking engine tests
│       └── entity-resolution.test.ts  # Entity resolution tests
└── types/                       # Existing retailer-specific type definitions
```
