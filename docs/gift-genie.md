# Gift Genie — local-first gift intelligence

Gift Genie lets a shopper save the people they buy gifts for and get "gift
ideas" for one of them on demand. Since v3 the *judgement* — matching a profile
to searches, ranking products, filtering noise, learning from feedback — runs
in the browser, and no recipient profile is transmitted.

## The privacy boundary

This is the part that matters, so it is stated precisely rather than as a
slogan.

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Recipient profile (name, gender, age, interests, budget, excluded retailers) | `localStorage` + React state | **No** |
| Compiled search intents (which queries to run) | Built in the browser | Only the query text, a label, a price ceiling and brand/category hints |
| Interaction ledger (saved / clicked / dismissed) | `localStorage` | **No** |
| Ranking, type filtering, dedupe, bundling, affinity | Browser | **No** |
| Embedding model + vectors | Browser (WASM/WebGPU) | **No** |
| Product listings | Retailer APIs via this app's server | n/a — that is the search |

Two consequences worth spelling out:

- **Age-bracket title exclusions are applied client-side.** Sending strings
  like `small parts` or `alcohol` alongside a query would let anyone reading the
  request infer the recipient is a toddler. They stay in the browser, filtered
  against product titles after the results arrive.
- **The query text necessarily reveals a topic.** A search for `sourdough
  starter kit` tells the server someone wants to buy baking gear. That is
  unavoidable while retailer APIs are server-side (their credentials cannot
  ship to a browser), and it is a very different disclosure from "Priya is a
  34-year-old woman who likes coffee."

Verified by intercepting the real request in a browser: the POST body to
`/api/gift/ideas` contains `intents`, `excludedProviders`, `maxResults` and
nothing else. `Priya`, `"woman"`, `34` and the age-exclusion strings do not
appear in it.

## Architecture

```
browser                                             server
──────────────────────────────────────────────      ────────────────────
profile → buildGiftBrief() → intent requests  ───▶  buildPlanFromRequest()
   │            (local, deterministic)              → federated search
   │                                                     │
   ├── semantic expansion (embeddings)                   │
   │                                                     ▼
   └───────────────────── products ◀──────────────── ranked results
                            │
   product-type tagging → budget fit → semantic → affinity
   → dedupe → rank → bundles → grid
```

`/api/gift/ideas` accepts only `{ intents, excludedProviders, maxResults }`
(`search/gift/request.ts`). It has no recipient concept.

## The five intelligence layers

### 1. Semantic search (Transformers.js)

`lib/gift/semantic.ts` loads a small retrieval model on demand — **never
automatically**, because it is a ~22 MB download. WebGPU is used when available,
WASM otherwise.

**The model is chosen by measurement, not reputation.** `scripts/bench-embedding-models.ts`
downloads each candidate, runs it on this app's own task (28 free-text → intent
queries with hand-checked answers, plus 12 "right product vs near-miss
distractors" rankings), and reports quality per megabyte. Results are committed
in `docs/embedding-bench.json`; the ranking tool is deterministic, so the table
can be re-derived at any time.

| Model | Download | R@1 | R@3 | MRR | Product top-1 | Quality/MB |
|---|---|---|---|---|---|---|
| MiniLM-L6 q8 (old default) | 22.6 MB | 0.36 | 0.54 | 0.50 | 0.75 | 0.027 |
| **Arctic Embed XS q8 (new default)** | **22.6 MB** | **0.50** | **0.64** | **0.61** | 0.75 | **0.030** |
| GTE Small q8 | 33.1 MB | 0.32 | **0.71** | 0.51 | **0.83** | 0.023 |
| MiniLM-L12 q8 | 33.1 MB | 0.32 | 0.61 | 0.50 | 0.83 | 0.021 |
| BGE small v1.5 q8 | 33.1 MB | 0.29 | 0.61 | 0.47 | 0.75 | 0.020 |
| Jina v2 small q8 | 31.9 MB | 0.50 | 0.61 | 0.58 | 0.67 | 0.020 |
| BGE base v1.5 q8 | 105.7 MB | 0.36 | 0.64 | 0.53 | 0.92 | 0.007 |
| MiniLM-L6 **q4** | 52.7 MB | 0.36 | 0.61 | 0.52 | 0.75 | 0.013 |

Two findings worth keeping:

- **The same-size model is meaningfully better.** Arctic XS downloads the same
  22.6 MB as the original MiniLM and wins on every retrieval metric
  (R@1 0.50 vs 0.36, MRR 0.61 vs 0.50), so the smarter default costs the user
  nothing extra.
- **4-bit quantization is not a free size win.** At q4 the MiniLM ONNX file is
  *larger* (52.7 MB) and no better than q8 — small embedding models are already
  heavily optimized, and the q4 artifacts carry their own overhead.

`gte-small` is the accuracy option: +10.5 MB for the best recall@3 (0.71) and
product discrimination (0.83). It is a one-line deployment choice:

```bash
NEXT_PUBLIC_GIFT_EMBEDDING_MODEL=gte-small   # default: arctic-xs
```

Retrieval-tuned models expect an **instruction prefix on the query side only**.
`embedQuery()` applies it and `embedDocuments()` does not; mixing the two
measurably hurts recall, so the code keeps them separate instead of exposing one
generic embed call.

`lib/gift/corpus.ts` flattens the whole index (age, gender, age×gender,
interest and brand entries) into embeddable texts, cached per session.
`lib/gift/semantic-search.ts` does two jobs:

- **Intent expansion** — free text like *"cozy baking afternoon with fresh
  bread"* is matched against the corpus; the best two *unselected* intents are
  added as extra searches. Observed: `Baking · semantic → "sourdough starter
  kit"` and `Baking · semantic → "baking sheet set"`.
- **Product relevance** — the same query vector is compared with each product
  title, contributing 22% of the final rank.

Degradation is explicit: if the model fails, `tokenSimilarity` keeps free-text
matching working lexically, the UI says so, and ranking treats the semantic
component as neutral rather than zero.

### 2. Product-type tagging and noise filtering

The index carries an authoring hint (`productType`) for intents whose results
are inherently one type (pod refills, tea samplers, film). The decisive
classification is per listing, on the title, in
`lib/gift/product-type.ts`:

| Type | Example | Default treatment |
|---|---|---|
| `main` | "Breville Barista Express" | shown, full weight |
| `consumable` | "Nespresso coffee pods" | shown, 0.98× |
| `accessory` | "Silicone case for AirPods" | shown, 0.86× |
| `replacement_part` | "Replacement gasket, fits Breville" | **hidden** unless the profile is DIY |

Replacement/repair language is matched before consumables, so "replacement
filter" is not misread as "filter". The escape hatch is `isDiyOrRepairProfile`
(`tools_diy`, `cycling`, `fishing`, `camping`, `gaming`, `photography`) plus a
"Show replacement parts" toggle.

### 3. Budget sweet-spot scoring

`lib/gift/budget.ts` scores the price against the ceiling instead of rewarding
cheapness: **1.0 inside 60–90% of budget**, linear decay outside, and a 1.6×
faster decay below 25% so a $12 "gift" cannot win a $300 budget. Unknown price
scores 0.45 (neutral-negative). This is 26% of the final rank, and every card
shows the reason ("73% of budget — in the 60–90% sweet spot").

### 4. Deduplication and bundling

`lib/gift/dedupe.ts` removes near-duplicates before rendering. Structured
identity (UPC/EAN/GTIN/MPN) wins outright; otherwise normalized-title Jaccard
with containment credit at a 0.82 threshold. This is what removes "Milwaukee
2606-20 Cordless Drill Driver" vs "… - New" arriving from two different
searches.

`buildBundles` pairs a core gift with a consumable/accessory from a **different
interest** ("one thing to use, one that gets used up"). It only runs when at
least two interests are active, never exceeds the budget by more than 15%, and
falls back to a second gift from the other interest when the searches returned
nothing consumable.

### 5. Local behavioural ledger

`lib/gift/ledger.ts` records `clicked` (+1), `saved` (+3) and `dismissed` (−4)
per recipient, keyed by dimension (`interest`, `brand`, `productType`,
`intent`, `retailer`). Weights decay with a 30-day half-life and are squashed
through `tanh(score/4)`, so one save is a nudge and five dismissals are a
statement.

Behaviour is deliberately asymmetric:

- **one** "not for them" removes that card immediately (UI state);
- a whole **search** or **interest** is hidden only after repeated dismissals
  (`≤ −0.8`);
- a **product type** is never hidden by the ledger, only demoted — dismissing
  one accessory must not hide every accessory.

## Verification (real runs, not mocks)

`npm test` → 414 tests. The behavioural checks below were performed in
Chromium against the running app with real retailer traffic.

| Check | Observed |
|---|---|
| Profile on the wire | request body keys = `intents, excludedProviders, maxResults`; `Priya`/`"woman"`/`34`/`small parts` absent |
| Client-compiled brief | 6 intents, e.g. `Lodge cast iron skillet`, `gold necklace`, … with `maxPrice: 150` |
| Budget fit | "73% of budget — in the 60–90% sweet spot", "only 9% — reads as a stocking filler" |
| Product-type filter | replacement parts hidden by default, accessories demoted and labelled |
| Dedupe | near-duplicate titles collapsed; count surfaced in the summary line |
| Bundling | bundle section rendered for a cooking + baking profile |
| Ledger | save → 4 rows (`saved`); dismiss → ledger updated, card removed, page **not** wiped |
| Semantic opt-in | model ready in **3.7 s** (WASM), search 14.1 s including embedding 60 products |
| Semantic expansion | 2 extra searches: `sourdough starter kit`, `baking sheet set` |
| Semantic ranking | sourdough kits at 56–59% match from a coffee-only profile |

A bug this run caught: the ledger originally stored one `action` + `count` per
key, so "saved, then dismissed" became two dismissals and hid 59 of 60 cards.
Rows now keep per-action counts, and there is a regression test for that exact
sequence.

## Cost and limitations

- **Model download**: 22.6 MB (arctic-xs), opt-in, cached by the browser. The
  index itself adds ~32 KB gzipped to the client bundle (139 KB source). The
  optional `gte-small` build is 33.1 MB.
- **WASM latency**: embedding 60 product titles took ~10 s in headless Chromium.
  WebGPU is preferred when present; ranking itself is microseconds.
- **Heuristic classifiers**: product type is title-based. A poetic listing with
  no accessory language will be classified `main`. The index hint only covers
  intents where the whole result set is consumable.
- **Semantic weight is 22%.** It reorders and adds searches; it does not
  override the retailer ranker or the budget signal.
- **Bundling is a heuristic**, not an optimisation: highest-ranked core plus the
  first complementary partner from another interest.
- **The ledger is per browser.** Clearing site data forgets everything; there is
  no sync by design.
- **Search is still server-side.** Retailer credentials cannot be shipped to a
  browser, so queries must transit this app's server. Only queries do.


## Trend intelligence (static, free, weekly)

Up-to-date trends arrive as a **static file**, not an API call:

```
publication feeds ──▶ scripts/fetch-trends.ts ──▶ public/data/trends.json ──▶ browser
   (free RSS)          (GitHub Actions, weekly)      (5 KB, static)        (matching is local)
```

### Ingestion

`.github/workflows/update-trends.yml` runs every Monday at 06:17 UTC (and on
`workflow_dispatch`), executes `scripts/fetch-trends.ts`, and commits the
manifest back if it changed. It needs only the default `GITHUB_TOKEN`; there
are no API keys and no paid services. A step fails the job if the manifest comes
out empty, so a broken run cannot overwrite a good file with nothing.

Eleven free feeds are configured (Vogue, GQ, Allure, Bon Appétit, Apartment
Therapy, The Verge, Engadget, Wired, Gizmodo, Outside, Lifehacker, Teen Vogue,
Popular Mechanics). Each fetch is independently recorded in the manifest's
`sources` array with `status: "ok" | "failed"`, because publishers rate-limit
and block CI runners intermittently — a partial manifest beats a failed build.
Last local run: **13/13 feeds ok, 280 headlines → 65 terms across 4 cohorts**.

Extraction (`scripts/trend-extract.ts`, pure and unit-tested):

1. strip listicle scaffolding ("The 12 Best …");
2. find phrases whose head word is in an explicit product-noun vocabulary,
   mapped to exactly one category (`keyboard` can never be read as `board`);
3. allow only whitelisted modifiers ("sculptural", "cast iron", "cashmere") —
   without this, headlines contribute "should watch" and "herby sheet";
4. keep the stronger phrasing when one term contains another;
5. attribute terms to cohorts by explicit demographic language when a headline
   has it ("gifts for women in their 30s"), otherwise to the publication's
   declared audience.

That last rule is a **feed prior, not a measurement**, and the manifest says so
in `methodology.attribution` plus per-run counts. A decade bucket is only created
when a publication actually says "in their 30s" — the pipeline does not spray a
gendered feed across five decades to look richer.

### Client

`lib/gift/trends.ts` loads `/data/trends.json` on boot, caches it in
`localStorage` (key `emporika-trends:v1`) and falls back to that copy when
offline. A manifest older than 30 days is ignored rather than trusted.

`cohortChain(gender, bracket)` maps a recipient to ordered fallbacks — a woman of
34 reads `women-30s → women → unisex` — and `answerFromManifest` answers
questions from the manifest alone:

| Question | Answer (current manifest) |
|---|---|
| "what is trending for men right now" | `men: watch, jacket, jean, sneaker` |
| "what tech gifts are trending" | `women: mouse, tv, camera, reader` |
| "what jewelry is popular for women in their 30s" | `women (no jewelry trends this week): jean, sweater, skirt, blush` |

That third line is the important one: rather than invent a jewelry answer it
says the category was empty this week. Category words are matched with word
boundaries, so "what" does not match the alias "hat".

### Ranking

Trend alignment is one more bounded term in the client ranker
(`RANK_WEIGHTS.trend = 0.12`, with relevance 0.30, budget 0.24, semantic 0.20,
affinity 0.14). A product whose *title* matches a cohort trend term scores
fully; a product from a *search* that matches counts at 70%, because the listing
may not be the trending thing. It is a boost, never a filter.

### UI

- A **"Trending"** pill sits in the `SEARCHED FOR` header with the strongest
  matched term, the count of trend-boosted items, and the manifest's freshness
  ("updated today" / "12d ago").
- Cards whose title aligns with a trend term carry that term as a chip.
- The **Ask trends** box answers natural-language questions inline, shows
  whether it used the embedding model or keyword overlap, and offers
  "Boost these in the next search", which feeds the matched terms into the
  semantic query.

### Verification

| Check | Observed |
|---|---|
| Manifest served | `GET /data/trends.json` → 200, 5,472 bytes |
| Fetched on boot | exactly one request, `source: network` |
| Ask trends | answered from the manifest in <1s (keyword path, model not loaded) |
| Boost → search | context filled with 6 terms; 59 ideas, **18 trend-boosted** |
| Pill | `Trending · watch 18 · updated today` |
| Card chips | `cast iron skillet`, `electric stove` |
| Privacy | order payload still contains no recipient fields |
| Model weights persisted | `caches.keys()` → `transformers-cache` with 6 entries after first load |

### Limits

- **Trends are topic-level, not demographic truth.** The feeds describe what
  publishers are writing about; cohort attribution is explicit-language-first
  and feed-prior otherwise.
- **Thin categories happen.** If no publication covered jewelry this week,
  there is no jewelry bucket — by design.
- **Cron is only as reliable as GitHub Actions.** A missed run just leaves the
  previous manifest in place (and the UI shows its age).
- **The manifest is public.** It contains no user data; the browser does the
  matching.

## Files

| File | Role |
|---|---|
| `search/gift/request.ts` | The client/server contract (no recipient fields) |
| `search/gift/brief.ts` | Profile → brief (runs in the browser) |
| `search/gift/plan.ts` | Intent → `SearchPlan` (server) |
| `search/gift/orchestrator.ts` | Federated fan-out + provider-aware interleave |
| `search/gift/index-data.ts`, `brands.ts`, `momentum.ts` | The index, brand catalog and measured momentum |
| `lib/gift/semantic.ts` | Local embedding model registry (Transformers.js), query/document prefixes |
| `scripts/bench-embedding-models.ts` | Measures candidate models on this app's task → `docs/embedding-bench.json` |
| `lib/gift/corpus.ts`, `semantic-search.ts` | Corpus + intent/product matching |
| `lib/gift/product-type.ts` | Main / accessory / consumable / replacement part |
| `lib/gift/budget.ts` | Budget sweet-spot curve |
| `lib/gift/dedupe.ts` | Identity + title dedupe |
| `lib/gift/rank.ts` | The composed client ranker + bundles |
| `lib/gift/ledger.ts` | Per-recipient interaction ledger |
| `components/GiftGenie.tsx` | UI: profile editor, semantic opt-in, filters, save/dismiss |
| `scripts/probe-*.ts` | Retailer probes for the index and brand catalog |
| `scripts/build-gift-momentum.ts` | Regenerates the measured momentum table |
| `scripts/fetch-trends.ts`, `scripts/trend-extract.ts` | Weekly trend ingestion + pure extraction |
| `public/data/trends.json` | Committed trend manifest (static, no API) |
| `lib/gift/trends.ts` | Manifest loading, cohort mapping, answers, affinity |
| `components/GiftGenieResults.tsx` | Results grid, trend pill, trend answer card |
| `.github/workflows/update-trends.yml` | Cron job that rebuilds and commits the manifest |
