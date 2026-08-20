# Development Guide — Emporika

Practical instructions for running, testing, and debugging this repository.

## Prerequisites

- Node.js 20+ (Netlify builds pin Node 20 via `netlify.toml`; development has been observed on v26.0.0)
- npm (lockfile: `package-lock.json`; use `npm install`, not yarn/pnpm)
- No database, Docker, or local services required — the app is stateless except for an in-memory Costco cookie cache

## Install

```bash
npm install
```

## Environment setup

Copy the documented variables into `.env.local` (never committed — `.env*` is git-ignored).

- Full variable list: see `AGENTS.md` (Environment and secrets) and the README (Environment Variables).
- Per-retailer required variables: see `DEPLOYMENT.md` (e.g. eBay needs `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`; Walmart needs `WALMART_CONSUMER_ID` + `WALMART_PRIVATE_KEY_BASE64` + `WALMART_KEY_VERSION`).
- WebLLM variables (`NEXT_PUBLIC_WEBLLM_*`) are optional; defaults live in `lib/webllm/types.ts`.
- All retailer credentials are server-side only. Never expose them in client components.

## Running locally

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve production build
```

## Quality checks

```bash
npm test            # Vitest, Node environment — 33 tests, 4 files (all passing as of 2026-08-20)
npm run test:watch  # watch mode
npm run test:ui     # Vitest UI
npx tsc --noEmit    # type check (strict mode) — currently passes
npm run lint        # ESLint — currently FAILS with 231 errors / 3,822 pre-existing warnings; do not add new ones
```

Do not fix the pre-existing lint backlog unless asked; it is large and mostly `no-explicit-any`/warning class.

## Costco cookie maintenance

Costco search requires session cookies, cached in memory for up to 2 hours (`lib/costco-cookie-cache.ts`, stored on a global in dev mode to survive hot reloads):

- `POST /api/costco/set-cookie` — store a session cookie (guarded; see route)
- `GET /api/costco/refresh-cookie` — refresh via `lib/costco-cookie-fetcher.ts`
- `GET /api/cron/refresh-costco` — cron entry point; requires `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set. Scheduled hourly by `vercel.json` crons; self-calls using `VERCEL_URL`/`NEXT_PUBLIC_BASE_URL`.

When Costco results are missing, suspect an expired or missing `COSTCO_COOKIES` value.

## Debugging

- **eBay**: `node scripts/diagnose-ebay.mjs` — exercises eBay OAuth/search; check `EBAY_SANDBOX` matches your key environment.
- **Search pipeline**: `search/telemetry.ts` emits structured per-request logs (phases, provider errors, timing). Check server logs during `/api/search` requests.
- **WebLLM**: UI shows planner status (`components/WebLLMStatus.tsx`). If WebGPU is unavailable the app degrades to deterministic planning — this is expected behavior, not a failure.

## Common failure modes

- **Costco empty results** — session cookies expired; refresh via the cookie routes (above).
- **eBay auth errors** — sandbox vs production key mismatch, or OAuth token expired.
- **A retailer silently missing from results** — check `metadata.unsupportedFilters`; adapters report unsupported filters instead of applying them wrongly.
- **WebLLM never engages** — the default adapter is a mock (`lib/webllm/mock-adapter.ts`); intentional until a real adapter is enabled.
- **Build behaving differently from dev** — PWA is disabled in development (`next.config.ts`).

## Pre-commit verification checklist

1. `npm test` passes
2. `npx tsc --noEmit` passes
3. `npm run lint` introduces no **new** errors (231 pre-existing ones are not yours to fix)
4. No `.env*` values or generated files (`public/sw.js`, `.next/`) staged
5. Commit messages follow Conventional Commits (`type(scope): subject`)

## Deployment

- Netlify: `netlify.toml` (headers, Node 20). See `DEPLOYMENT.md` for env setup.
- Vercel: `vercel.json` (cron for Costco cookie refresh).
- The primary production target is ambiguous between the two — confirm before changing either file.
