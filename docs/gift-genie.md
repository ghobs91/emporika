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

`lib/gift/semantic.ts` loads `Xenova/all-MiniLM-L6-v2` (384-dim, q8) on demand —
**never automatically**, because it is a ~23 MB download. WebGPU is used when
available, WASM otherwise.

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

- **Model download**: ~23 MB, opt-in, cached by the browser. The index itself
  adds ~32 KB gzipped to the client bundle (139 KB source).
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

## Files

| File | Role |
|---|---|
| `search/gift/request.ts` | The client/server contract (no recipient fields) |
| `search/gift/brief.ts` | Profile → brief (runs in the browser) |
| `search/gift/plan.ts` | Intent → `SearchPlan` (server) |
| `search/gift/orchestrator.ts` | Federated fan-out + provider-aware interleave |
| `search/gift/index-data.ts`, `brands.ts`, `momentum.ts` | The index, brand catalog and measured momentum |
| `lib/gift/semantic.ts` | Local embedding model (Transformers.js) |
| `lib/gift/corpus.ts`, `semantic-search.ts` | Corpus + intent/product matching |
| `lib/gift/product-type.ts` | Main / accessory / consumable / replacement part |
| `lib/gift/budget.ts` | Budget sweet-spot curve |
| `lib/gift/dedupe.ts` | Identity + title dedupe |
| `lib/gift/rank.ts` | The composed client ranker + bundles |
| `lib/gift/ledger.ts` | Per-recipient interaction ledger |
| `components/GiftGenie.tsx` | UI: profile editor, semantic opt-in, filters, save/dismiss |
| `scripts/probe-*.ts` | Retailer probes for the index and brand catalog |
| `scripts/build-gift-momentum.ts` | Regenerates the measured momentum table |
