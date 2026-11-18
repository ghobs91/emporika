# Gift Genie — the recipient matrix and the gift index

Gift Genie lets a shopper save the people they buy gifts for and get "gift
ideas" for one of them on demand. It is intentionally **not** an LLM feature:
a recipient's gender, age and interests are compiled against a checked-in
index into concrete retailer searches, and the results run through the normal
search pipeline.

## Why an index instead of inference

The alternative — ask a model "what should I buy a 34-year-old man who likes
coffee?" on every request — needs a model in the request path, costs a call
per gift request, produces different answers for identical input, and cannot
be unit-tested. The index inverts all four: no model, no inference cost,
identical input → identical brief, and the whole thing is covered by
`tests/search/gift-*.test.ts`.

## What "popular lately" means here — read this before trusting a number

The index is a **matrix of traits → gift intents**. Its provenance is split in
two, because only one half can be measured:

| Part | How it is established |
|---|---|
| Which traits map to which products/brands | **Editorial.** Curated from general knowledge of current retail, not from survey data, purchase data, or a per-demographic popularity feed. No such feed exists in this repo. |
| Whether those mappings are *buyable* | **Measured.** Every authored query is run against the live retailers; result counts, providers, price ranges and sample titles are recorded. Every brand is probed the same way, including how often the brand name actually appears in the results. |

So a row in this index means "this is a well-known gift for someone with this
trait, and the retailers actually stock it" — **not** "this is statistically
what people with this trait buy". `strength`, `tier` and brand membership are
editorial rankings, not probabilities. Anything the probes killed was deleted
(see *Evidence* below).

## The matrix

```
                        ┌─────────── recipient traits ───────────┐
age bracket  ───────────┤                                        │
gender       ───────────┤   each layer can stand alone            ├──► scored intent pool
age × gender ───────────┤   combinations outscore single traits   │        │
interests    ───────────┤                                        │        ▼
brands       ───────────┘                                        │   allocation
                                                                 │   (one slot per layer)
                                                                 │        │
                                                                 ▼        ▼
                                                          SearchPlan × N  → federated search
```

Every intent declares the traits it answers as **facets**:

| Facet | Example | Layer size |
|---|---|---|
| `age:<bracket>` | `age:toddler` | 63 age-alone intents (7 per bracket) |
| `gender:<gender>` | `gender:woman` | 32 gender-alone intents (16 per gender) |
| `combo:<bracket>:<gender>` | `combo:adult:man` | 24 age × gender intents across 8 cells |
| `interest:<id>` | `interest:coffee` | 139 interest intents across 35 interests |
| — (universal) | — | 27 always-appropriate fallbacks |
| `brand:<slug>` | `brand:nike` | 314 brands → one `"<brand> <noun>"` search each |

That is **285 authored intents + 314 brand intents ≈ 600 distinct searches**,
versus 166 in the interest-only v1 index. More importantly the *per-recipient
candidate pool* grew from ~10–15 intents to ~40–60, because every layer now
contributes.

### Each trait stands on its own

`buildGiftBrief` allocates slots by layer before it allocates by score:

1. **Coverage pass** — one slot per facet layer that applies (age, gender,
   age×gender, interest, brand). A recipient with no interests still gets a
   specific list: age intents + gender intents + combination intents + brand
   intents.
2. **Fill pass** — remaining slots by score, with at most 2 intents per
   source and at most ⌈n/3⌉ brand intents.
3. **Neutral majority** — for a binary-gender recipient, ≥ half the set is
   neutral-lean. Coverage slots are protected; only fill slots can be swapped.

Combinations outrank single traits because `combinationBonus` grants +0.05 per
extra facet family an intent answers (+0.10 for a three-trait intent).

### Age + interest without 315 hand-written rows

Each interest declares a `primeAgeBrackets` window (where that interest is
most active — e.g. coffee peaks at 18–60, toys at 1–12). An intent inside the
window gets `AGE_AFFINITY_BONUS` (+0.04), so "34 + coffee" outranks "coffee"
without authoring an age × interest cell for every pair.

### Gender

Gender is treated as a **retail-merchandising layer**, and it is bounded three
ways:

- it contributes intents only for `woman` and `man`; `nonbinary` and
  `unspecified` get **no** gender layer at all, and are scored fully neutral;
- the per-intent `lean` is still only a ±0.04 nudge on a 0–1 score;
- the selected set must remain at least half neutral for a gendered recipient,
  and age/interest/brand coverage slots prefer neutral intents so a gendered
  combination cannot occupy them.

The layer encodes how retailers merchandise aisles. It is not a claim about a
person, `tests/search/gift-brief.test.ts` asserts gender never changes which
intents are *available*, and removing the layer is a one-line change
(`GENDER_SPECS` in `index-data.ts`).

## Merchant exclusion

A shopper can exclude retailers **per recipient** — "no eBay for my dad" is
stored with the profile, not re-entered every time.

- `GiftRecipient.excludedProviders` (persisted in `localStorage`), plus an
  optional per-request `excludedProviders` on `POST /api/gift/ideas`.
- Merged into `ShopperPreferences.excludedProviders`, which the existing
  `resolveEligibleProviders` already honours, so excluded retailers are never
  searched — not merely hidden from the results.
- Over and above the explicit exclusion, the merge step is **provider-aware**:
  within each intent it takes the listing whose retailer is least represented
  so far, so a marketplace with hundreds of near-identical listings cannot
  crowd out the other retailers.

## Files

| File | Role |
|---|---|
| `search/gift/types.ts` | Domain types, facets, tier prices, ids |
| `search/gift/taxonomy.ts` | Client-safe metadata: interest labels, bracket labels, `ageBracketForAge` |
| `search/gift/index-data.ts` | Age / gender / combo / universal / interest layers + prime age windows |
| `search/gift/brands.ts` | 314-brand catalog: product nouns, tiers, ages, leans, interests |
| `search/gift/brief.ts` | Facet scoring, combination bonus, allocation |
| `search/gift/plan.ts` | One intent → a `SearchPlan` the core pipeline accepts |
| `search/gift/orchestrator.ts` | Fan out over intents, provider-aware interleave, per-intent status |
| `search/gift/schema.ts` | Index validation + re-exported recipient schemas |
| `search/gift/recipient-schema.ts` | Zod schemas safe to import in the browser (no index data) |
| `app/api/gift/ideas/route.ts` | `POST /api/gift/ideas` |
| `app/gift/page.tsx`, `components/GiftGenie.tsx` | The UI |
| `lib/gift-recipients.ts`, `hooks/useGiftRecipients.ts` | Browser-local recipient storage |
| `scripts/probe-gift-index.ts` | Verifies every authored intent against the real retailers |
| `scripts/probe-brand-catalog.ts` | Verifies every brand, including brand-name presence |

## Evidence

```bash
npx tsx --env-file=.env.local scripts/probe-gift-index.ts --concurrency 3
npx tsx --env-file=.env.local scripts/probe-brand-catalog.ts --concurrency 3
```

Last run (index v2.0.0):

**Authored layers — `docs/gift-index-evidence.json`**

| Result | Value |
|---|---|
| Intents probed | 284 of 285 authored (the board-book intent is only offerable under 13, and is probed as the toddler universal) |
| Intents returning results | **284 / 284**, 20 ranked results each |
| By layer | universal 27/27, age 63/63, gender 32/32, combo 24/24, interest 138/138 |
| Providers answering | walmart, bestbuy, ebay, shopify — all 284 |
| Outcome split | 192 `results`, 92 `partial_results` |
| Duration | 122s |

**Brand catalog — `docs/gift-brand-evidence.json`**

| Result | Value |
|---|---|
| Brands probed | 314 |
| Brands returning listings | **314 / 314** |
| Brands whose listings barely mention the brand (<20%) | 1 (`warby-parker`, kept: it does appear, just not in most titles) |
| Duration | 107s |

Three brands that the probe showed *no* real presence for (DTC-only, not
carried by these retailers) were deleted: `Beardbrand`, `Catbird`, `Article`.

The probes are gates — both exit non-zero when anything returns nothing.

## Extending the matrix

1. **New gift idea**: add a row to the relevant layer in `index-data.ts`
   (or a brand to `brands.ts`).
2. **New interest**: add the id to `INTEREST_IDS` (`types.ts`), a label to
   `taxonomy.ts`, a profile + `primeAgeBrackets` to `index-data.ts`.
3. **New brand**: one line in `brands.ts`. `ages` is gift-plausibility, not a
   marketing segment.
4. Run `npx vitest run tests/search/gift-*.test.ts` — the validator enforces
   unique ids, facet well-formedness, per-source query uniqueness, age gating,
   ≥5 age-alone intents per bracket, ≥2 neutral fallbacks per bracket, and that
   every brand can actually serve its interests.
5. Run **both** probes and commit the refreshed evidence files.

## Known limitations

- **Membership and weights are editorial.** See the provenance section. The
  probes prove stock and relevance-by-title, not demographic popularity.
- **`strength` is a hand-assigned rank**, not a probability and not learned
  from shopper behaviour.
- **Brand queries are one-noun deep.** `"Nike running shoes"` is one search;
  the catalog does not model per-brand sub-categories, seasonal drops or
  sizing.
- **Relevance is still retailer keyword relevance.** Feature terms
  (`deriveGiftFeatures`) improve it; they do not make eBay marketplace
  listings reliable. Age-mismatch exclusions ("for kids", "toddler") remove
  the obvious failures for adult recipients.
- **Cost scales with intents.** One gift request runs one federated search per
  selected intent (default 6). There is no batching across intents.
- **No rate limiting.** `/api/gift/ideas` is unauthenticated and amplifies one
  request into up to 8 federated searches. It needs the same abuse protection
  as `/api/search` before it sees uncontrolled traffic.
- **No price-tier enforcement against real listings.** Tier is a scoring
  signal plus a hard `maxPrice`; a "$160 hero gift" that sells for $15 is not
  detected.
