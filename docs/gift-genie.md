# Gift Genie — recipient profiles and the gift index

Gift Genie lets a shopper save the people they buy gifts for and get
"gift ideas" for one of them on demand. It is intentionally **not** an LLM
feature: a recipient's gender, age and interests are compiled against a
checked-in index into concrete retailer searches, and the results run
through the normal search pipeline.

## Why an index instead of inference

The alternative — ask a model "what should I buy a 34-year-old man who likes
coffee?" on every request — needs a model in the request path, costs a call
per gift request, produces different answers for identical input, and cannot
be unit-tested. The index makes all four properties invert:

| Property | Index (this implementation) |
|---|---|
| Model required | No — pure data + pure functions |
| Cost per request | Zero inference; only the retailer searches |
| Determinism | Same recipient → same brief → same searches |
| Testability | `tests/search/gift-*.test.ts` |
| Latency | Brief is built in microseconds; the retailers are the only wait |

## Files

| File | Role |
|---|---|
| `search/gift/types.ts` | Domain types, tier prices, interest/gender/bracket ids |
| `search/gift/taxonomy.ts` | Client-safe metadata: interest labels, bracket labels, `ageBracketForAge` |
| `search/gift/index-data.ts` | **The index**: 35 interest profiles, 9 age brackets, 166 gift intents (139 interest + 27 bracket-universal) |
| `search/gift/schema.ts` | Index validation (`validateGiftIndex`) + re-exported recipient schemas |
| `search/gift/recipient-schema.ts` | Zod schemas safe to import in the browser (no index data) |
| `search/gift/brief.ts` | Recipient → `GiftBrief` (deterministic scoring + selection) |
| `search/gift/plan.ts` | One selected intent → a `SearchPlan` the core pipeline accepts |
| `search/gift/orchestrator.ts` | Fan out over intents, interleave results, report per-intent status |
| `app/api/gift/ideas/route.ts` | `POST /api/gift/ideas` |
| `app/gift/page.tsx`, `components/GiftGenie.tsx` | The UI |
| `lib/gift-recipients.ts`, `hooks/useGiftRecipients.ts` | Browser-local recipient storage |
| `scripts/probe-gift-index.ts` | Verifies every index query against the real retailers |
| `docs/gift-index-evidence.json` | Output of the last probe run |

## The three layers

```
recipient (name, gender, age, interests, optional budget)
   │  buildGiftBrief()            deterministic, pure
   ▼
GiftBrief (bracket, budget ceiling, exclusions, ≤5 scored intents)
   │  buildGiftSearchPlan()       one plan per selected intent
   ▼
SearchPlan × N  ──► executeSearch() ──► RankedProduct[]
   │  mergeGiftIdeas()            round-robin, de-duplicated by canonical id
   ▼
GiftIdea[] (product + which intent found it + why)
```

Everything below `SearchPlan` is the existing pipeline — the same providers,
hard filters, entity resolution and ranker used by normal search. Gift mode
changes *what is searched for*, never how results are scored.

### The brief

`buildGiftBrief` scores every offerable intent and keeps the best few:

```
score = strength                 index's own confidence (0–1, editorial)
      + tierFit                  ±: does the gift's price tier fit the budget
      + leanNudge                ±0.04 for gender lean
      + universalBonus           +0.02 for bracket-universal fallbacks
```

Three selection rules then apply:

1. **At most 2 intents per interest** (`MAX_PER_INTEREST`) so one hobby
   cannot fill the page.
2. **At least half the set is neutral-lean** when the shopper named a gender.
3. **No duplicate queries** — a universal fallback that repeats an interest
   intent loses to the higher-ranked copy so no provider request is wasted.

## Age gating

Two independent gates, both in `isIntentOfferable`:

- `avoidAgeBrackets` — safety/complexity. Alcohol intents are blocked for
  every minor bracket; a pellet grill is blocked below young adult; an
  e-reader is blocked below school age.
- `onlyAgeBrackets` — age-specific-only items. Board books are offered to
  infants/toddlers/children and never to adults.

Interests outside a bracket are **dropped with a stated reason**, which the
UI renders (e.g. "Wine & spirits is not a plausible gift for toddler (1–3).")
— nothing is silently hidden.

Each bracket also carries `exclusions`, applied as title substring matches by
`search/filter.ts`. These are deliberately unambiguous phrases ("small parts",
"button battery", "alcohol") because substring matching is coarse.

## How gender is used — and how it is bounded

Gender is a **tiebreaker, never a filter**:

- It only applies to intents tagged `lean: 'woman' | 'man'`; **154 of 166 intents
  (92.8%) are neutral**, and the neutral-majority rule below keeps a
  gendered set balanced even when a gendered intent scores highest.
- The nudge is ±0.04 on a score that otherwise ranges 0–1.
- `unspecified` and `nonbinary` score **zero** nudge rather than defaulting
  to a lean.
- `selectGiftIntents` guarantees a **neutral majority** in the final set
  whenever a gender is specified.
- The lean encodes how retailers merchandise an aisle, not a claim about a
  person. It is a single field per intent, reviewed like any other data, and
  `tests/search/gift-brief.test.ts` asserts that gender never changes which
  intents are *available*.

## Budget

Ceiling resolution, in order:

1. `recipient.budget` (the shopper typed one), else
2. `maxPrice` on the API request, else
3. the age bracket's `budgetCeiling` (e.g. $60 for an infant, $400 for an
   adult 26–40).

It becomes a hard `maxPrice` on each plan's `hardFilters`, so an over-budget
item is filtered out rather than ranked down. The scoring additionally
penalises a tier that cannot fit the ceiling, so a $160 espresso machine does
not win a $30 brief before the filter has to intervene.

## Relevance: why the plan carries feature terms

The ranker gives `featureMatch` a free 1.0 when no features are requested, so
listing relevance to the *intent* contributed nothing. Observed in a real run:
`coffee grinder` surfaced an eBay "herb tobacco grinder" among the real burr
grinders. `deriveGiftFeatures` now adds the intent's phrase plus its first and
last content word to `hardFilters.requiredFeatures`, so `featureMatch`
(weight 0.25 in the fallback plan) separates listings that match the intent
from listings that merely share a keyword. Re-running the same request after
the change removed the herb grinder from the top results; this is a ranking
improvement, not a filter — nothing is excluded on those terms.

## Persistence

Recipients live in `localStorage` under `emporika-gift-recipients:v1`:

- Loaded in an effect (never during render) so server and client markup match.
- Every entry is re-validated with `giftRecipientSchema` on read; entries
  that no longer validate (e.g. an interest removed from the taxonomy) are
  dropped instead of crashing the page.
- Corrupt JSON or a full quota degrades to an empty/kept list — storage
  failures never break the page.
- Capped at `MAX_RECIPIENTS = 25`.
- **Nothing is sent anywhere except the recipient fields needed for the
  search**, and no recipient is persisted server-side.

## Evidence: the index is probed, not assumed

Every intent must return real listings. That claim is checked by
`scripts/probe-gift-index.ts`, which builds each intent's real `SearchPlan`
and runs it through the real providers.

Last run (index v1.0.0):

```bash
npx tsx --env-file=.env.local scripts/probe-gift-index.ts --all --concurrency 2
```

| Result | Value |
|---|---|
| Intents probed | 165 (every intent offerable at its probe age, including all 27 universal fallbacks) |
| Intents returning results | 165 (20 ranked results each) |
| Interests covered | 35/35 |
| Providers answering | walmart, bestbuy, ebay, shopify — 165/165 intents each |
| Outcome split | 126 `results`, 39 `partial_results` (a provider returned a partial set) |
| Duration | 112s |
| Per-intent detail | `docs/gift-index-evidence.json` |

The one index intent not probed directly is `reading/board-books`, which
`onlyAgeBrackets` restricts to under-13s and therefore is not offerable at
`reading`'s representative age; the identical query is probed as
`universal/toddler/board-books`.

The probe counts as a gate: it exits non-zero when any intent returns
nothing, and it also surfaced a real crash in the core ranker (a provider
price object with no usable `amount` threw on `.toFixed`, failing the whole
search). That is fixed in `search/ranker.ts` + `search/providers/adapter.ts`
and covered by `tests/search/ranker.test.ts`.

## Extending the index

1. Add an `InterestProfile` (or an intent under an existing one) in
   `search/gift/index-data.ts`.
2. New interest ids must also be added to `INTEREST_IDS` in
   `search/gift/types.ts` and to `INTERESTS` in `search/gift/taxonomy.ts`.
3. Give every intent a real retailer `query`, a `tier`, a `strength`, a
   `lean`, and a one-line `why` written for a shopper.
4. Run `npx vitest run tests/search/gift-*.test.ts` — the index validator
   enforces unique ids, no duplicate non-universal queries, bracket coverage,
   and at least two neutral fallbacks per bracket.
5. Run the probe with `--all` and commit the refreshed
   `docs/gift-index-evidence.json`.

## Known limitations

- **`strength` is editorial.** It is a hand-assigned ranking, not a
  probability and not learned from shopper behaviour. There is no usage data
  behind it.
- **`lean` is merchandising-based.** See the bounded-use note above; it is a
  deliberate, small, documented nudge rather than a personalisation model.
- **Relevance is still retailer keyword relevance.** Adding feature terms
  improved a specific observed failure; it does not make eBay marketplace
  listings reliable. Marketplace noise is visible in the results.
- **Cost scales with intents.** Each idea request runs one federated search
  per selected intent (default 3, `GIFT_DEFAULTS`), at provider-request cost.
  There is no batching across intents.
- **No rate limiting.** `/api/gift/ideas` is unauthenticated and amplifies one
  request into up to 3 federated searches. It needs the same abuse protection
  as `/api/search` before it is exposed to uncontrolled traffic.
- **No price-tier enforcement against real listings.** The tier is a
  scoring signal plus a hard `maxPrice`; a "$160 hero gift" that actually
  sells for $15 is not detected.
- **The budget ceiling defaults are not market-researched.** They are
  round numbers chosen to avoid absurd results; they are not survey data.
