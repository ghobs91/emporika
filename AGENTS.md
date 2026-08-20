# AGENTS.md — Emporika

## Purpose

Emporika is a universal shopping search engine that federates product discovery across multiple retailers (Walmart, Best Buy, Target, eBay, Costco, Shopify Global Catalog MCP) with AI-assisted natural-language query planning (WebLLM in the browser, progressive enhancement) and deterministic server-side filtering and ranking.

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, Lucide React icons
- **Validation**: Zod v4
- **Testing**: Vitest 4 (Node environment, no browser/WebGPU needed)
- **Linting**: ESLint 9 via `eslint-config-next` (flat config in `eslint.config.mjs`)
- **PWA**: `@ducanh2912/next-pwa`, disabled when `NODE_ENV === "development"`
- **Browser AI**: `@mlc-ai/web-llm` — currently behind a mock adapter (`lib/webllm/mock-adapter.ts`); falls back to deterministic planning
- **Package manager**: npm (use `package-lock.json`; do not add yarn/pnpm lockfiles)

## Directory map

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages and API routes (`app/page.tsx` = main search UI, `app/api/*/route.ts` = route handlers) |
| `components/` | React UI components (SearchBar, ProductCard, filters, pagination, cart, trending, PWA) |
| `search/` | Domain core: orchestrator, planner, schemas, normalize, entity-resolution, offer-normalize, filter, ranker, errors, telemetry, providers |
| `lib/` | Retailer API clients (`bestbuy.ts`, `ebay.ts`, `target.ts`, `walmart.ts`, `costco.ts`, `shopify.ts`), `webllm/` adapters, Costco cookie cache/fetcher |
| `hooks/` | `useIntelligentSearch.ts`, `useMerchantCheckout.ts`, `useTargetStore.ts` |
| `context/` | `CartContext.tsx` (client-side cart state) |
| `types/` | Retailer-specific type definitions (`unified.ts`, `cart.ts`, etc.) |
| `tests/search/` | Vitest suites: `schemas`, `ranker`, `entity-resolution`, `provider-selection` |
| `scripts/` | `diagnose-ebay.mjs` (eBay integration diagnostics) |
| `public/` | Static assets, PWA icons, generated `sw.js` (git-ignored) |

The `@/` import alias resolves to the repository root (see `tsconfig.json` `paths`).

## Commands

Verified this session unless marked otherwise. All are npm scripts from `package.json`.

| Command | Purpose | Status |
|---------|---------|--------|
| `npm install` | Install dependencies | [inferred, not verified] |
| `npm run dev` | Dev server at `http://localhost:3000` | [inferred, not verified] |
| `npm run build` | Production build | [inferred, not verified] |
| `npm run start` | Serve production build | [inferred, not verified] |
| `npm test` | Run Vitest once (33 tests, 4 files) | ✅ passed 2026-08-20 |
| `npm run test:watch` | Vitest watch mode | [inferred, not verified] |
| `npm run test:ui` | Vitest UI (`@vitest/ui`) | [inferred, not verified] |
| `npm run lint` | ESLint (flat config) | ❌ exits 1: 231 errors / 3,822 warnings (pre-existing; e.g. `no-explicit-any` in `types/unified.ts`) |
| `npx tsc --noEmit` | Type check | ✅ passed 2026-08-20 |

There is no Makefile/justfile and no CI workflow in this repo.

## Development workflow

1. **Inspect** the relevant code first (`search/` for search behavior, `lib/` for retailer APIs, `components/` for UI).
2. **Plan** minimal changes; the search pipeline is deterministic — preserve that property.
3. **Implement** with Zod validation at every boundary (`search/schemas.ts`).
4. **Verify**: `npm test` then `npx tsc --noEmit`, and treat new ESLint errors as failures even though the repo currently has 231 pre-existing ones (do not add to them; do not fix them unless asked).
5. **Report** what changed, what was verified, and any behavior changes.

## Conventions

- **TypeScript strict mode** is on; avoid `any` in new code.
- **Deterministic ranking**: the LLM never determines final rank — `search/ranker.ts` is the single source of truth. Do not make ranking depend on LLM output or randomness.
- **Progressive enhancement**: WebLLM is optional. Everything must work via `search/planner.ts` (deterministic fallback).
- **Unsupported filters are reported, never faked**: adapters set `metadata.unsupportedFilters` rather than pretending a filter was applied (`search/providers/capabilities.ts`).
- **Server-only credentials**: retailer API keys, tokens, and provider URLs are read server-side only and must never reach the browser bundle or client components.
- **Git**: Conventional Commits (`type(scope): subject`, e.g. `feat(search):`, `fix(costco):`), matching the repo history. Two remotes: `origin` (GitHub) and `rad` (Radicle).

## Testing expectations

- Tests live in `tests/search/` and run in a Node environment (`vitest.config.ts`).
- Tests must not require WebGPU, browser model downloads, live retailer APIs, or Shopify MCP access.
- Any change to `search/` behavior (schemas, ranking, filtering, entity resolution, provider selection) should come with or update a test in `tests/search/`.
- `npm test` must pass before considering work done.

## Environment and secrets

- Never commit `.env*` files (already git-ignored) or any secret value. `*.pem` is ignored but **`WM_IO_my_rsa_key_pair` at the repo root is tracked** — an encrypted RSA private key. Do not add to it or copy it anywhere; treat it as sensitive.
- Never invent environment variables. The complete set read by code (as of 2026-08-20) is:

| Variable | Used for | Notes |
|----------|----------|-------|
| `WALMART_CONSUMER_ID` | Walmart API | required for Walmart search |
| `WALMART_PRIVATE_KEY_BASE64` | Walmart API signing | required for Walmart search |
| `WALMART_KEY_VERSION` | Walmart API signing | required (usually `"1"`) |
| `BESTBUY_API_KEY` | Best Buy API | required for Best Buy search |
| `TARGET_STORE_ID` | Target store context | Target search |
| `TARGET_ZIP` | Target zip context | Target search |
| `EBAY_CLIENT_ID` | eBay OAuth | required for eBay search |
| `EBAY_CLIENT_SECRET` | eBay OAuth | required for eBay search |
| `EBAY_SANDBOX` | eBay sandbox mode | optional; set `true` for sandbox keys |
| `COSTCO_COOKIES` | Costco session cookies | required for Costco search |
| `COSTCO_API_KEY` | Costco API key | read by `lib/costco.ts` |
| `COSTCO_REFRESH_SECRET` | Costco cookie refresh auth | read by cookie routes |
| `CRON_SECRET` | Cron route auth | `/api/cron/refresh-costco` requires `Authorization: Bearer <CRON_SECRET>` when set |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify MCP auth | server-side only |
| `SHOPIFY_AGENT_PROFILE` | Shopify agent profile | fetched during MCP negotiation |
| `NEXT_PUBLIC_WEBLLM_ENABLED` | Toggle WebLLM | optional; default enabled unless `"false"` |
| `NEXT_PUBLIC_WEBLLM_DEFAULT_MODEL` | WebLLM model | default `Qwen3-1.7B-q4f16_1-MLC` |
| `NEXT_PUBLIC_WEBLLM_LOW_MEMORY_MODEL` | Low-memory fallback model | default `Qwen3-4B-q4f16_1-MLC` |
| `NEXT_PUBLIC_WEBLLM_ENHANCED_MODEL` | Enhanced model | default `Qwen3-8B-q4f16_1-MLC` |
| `NEXT_PUBLIC_BASE_URL` | Base URL for cron self-calls | optional |
| `VERCEL_URL` | Auto-set by Vercel | used by cron route |
| `SEARCH_MAX_PROVIDER_QUERIES` / `SEARCH_MAX_CONCURRENCY` / `SEARCH_MAX_ENRICHMENT_PRODUCTS` / `SEARCH_TIMEOUT_MS` / `PROVIDER_TOOL_TIMEOUT_MS` / `PLANNER_CLARIFICATION_THRESHOLD` | Search pipeline tuning | optional, with code defaults |

Defaults for models live in `lib/webllm/types.ts`; search-tuning defaults are read in `search/` (see `search/orchestrator.ts`).

## Safety constraints

- Do not invent APIs, files, test results, environment variables, or deployment behavior.
- Do not modify generated files (`.next/`, `public/sw.js`, PWA icons) unless explicitly asked.
- Do not access production systems or perform destructive operations (deploys, data deletion, history rewrites) without explicit user approval.
- Do not report tests as passing unless they were actually run.
- Do not touch or commit secrets; never copy values out of `.env*` files.

## Tool usage policy

- Read local code (`search/`, `lib/`, `app/api/`) before consulting external documentation.
- Use external docs (Context7 etc.) only for unfamiliar third-party APIs (e.g. `@mlc-ai/web-llm`, `@ducanh2912/next-pwa`).
- Browser/E2E tooling is only relevant for user-facing UI changes; there are no E2E tests configured.
- No repository issue/CI tools exist to consult.

## Known Unknowns

- **Primary hosting target is ambiguous**: `DEPLOYMENT.md` and `netlify.toml` document Netlify, but `vercel.json` defines a Vercel Cron (`/api/cron/refresh-costco` hourly) — production may be Vercel, Netlify, or both. Confirm before changing deployment config.
- `.env.example` exists but its contents could not be read this session (privacy settings); its coverage of the table above is unverified.
- The purpose and provenance of the tracked `WM_IO_my_rsa_key_pair` file are unknown; it appears to be an encrypted RSA private key and needs a human decision (rotate + remove from history, or delete).
- No CI is configured; nothing currently gates `npm test`, `npx tsc --noEmit`, or lint on push.
- Local Node version observed: v26.0.0; Netlify builds pin Node 20 (`netlify.toml`). The minimum supported local Node version is not documented.
