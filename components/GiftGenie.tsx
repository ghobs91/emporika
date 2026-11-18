'use client';

// ── Gift Genie ─────────────────────────────────────────────────────────
//
// Local-first by construction:
//   • the recipient profile is built and stored in this browser only;
//   • the *brief* (which searches to run) is computed here, not on a server;
//   • only search terms, a budget ceiling and age exclusions are sent out;
//   • ranking, type filtering, dedupe, bundling and learning all happen on
//     this device, including the embedding model when semantic search is on.
//
// No model calls, no profile uploads, no third-party analytics.

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Gift, Plus, Sparkles, Trash2, Pencil, Loader2, RefreshCw, AlertCircle, X,
  BrainCircuit, ThumbsDown, Bookmark, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import ProductModal from '@/components/ProductModal';
import { RESULTS_GRID_CLASS } from '@/components/ProductGrid';
import { useGiftRecipients, useHydrated } from '@/hooks/useGiftRecipients';
import { rankedProductToUnified } from '@/lib/ranked-products';
import {
  AGE_BRACKET_LABELS,
  GENDER_LABELS,
  INTEREST_GROUP_LABELS,
  INTERESTS,
  ageBracketForAge,
} from '@/search/gift/taxonomy';
import { PROVIDER_IDS } from '@/search/gift/recipient-schema';
import { buildGiftBrief } from '@/search/gift/brief';
import { briefToIntentRequests } from '@/search/gift/request';
import type { GiftIntentRequest, GiftSearchResponse } from '@/search/gift/request';
import type { Gender, GiftBrief, GiftRecipient, InterestGroup, InterestId } from '@/search/gift/types';
import { getRetailerInfo } from '@/lib/retailer';
import type { RetailerSource, UnifiedProduct } from '@/types/unified';
import {
  getLedgerServerSnapshot,
  getLedgerSnapshot,
  recordGiftInteraction,
  signalsForIdea,
  subscribeLedger,
  type Ledger,
  type LedgerAction,
} from '@/lib/gift/ledger';
import {
  getSemanticState,
  loadSemanticModel,
  subscribeSemantic,
} from '@/lib/gift/semantic';
import { embedProducts, embedQuery, matchCorpus } from '@/lib/gift/semantic-search';
import { rankGiftIdeas, type Bundle, type RankedIdea, type RankResult } from '@/lib/gift/rank';
import { isDiyOrRepairProfile, PRODUCT_TYPE_LABELS } from '@/lib/gift/product-type';

const MAX_INTENTS = 6;
const MAX_RESULTS = 60;

const FAMILY_LABELS: Record<string, string> = {
  age: 'age',
  gender: 'gender',
  combo: 'age + gender',
  interest: 'interests',
  brand: 'brands',
};

interface Draft {
  name: string;
  gender: Gender;
  age: string;
  interests: InterestId[];
  budget: string;
  excludedProviders: string[];
}

function emptyDraft(): Draft {
  return {
    name: '',
    gender: 'unspecified',
    age: '30',
    interests: [],
    budget: '',
    excludedProviders: [],
  };
}

function draftFrom(recipient: GiftRecipient): Draft {
  return {
    name: recipient.name,
    gender: recipient.gender,
    age: String(recipient.age),
    interests: [...recipient.interests],
    budget: recipient.budget !== undefined ? String(recipient.budget) : '',
    excludedProviders: [...(recipient.excludedProviders ?? [])],
  };
}

function parseDraft(draft: Draft) {
  const age = Number.parseInt(draft.age, 10);
  const budget = draft.budget.trim() === '' ? undefined : Number.parseFloat(draft.budget);
  return {
    name: draft.name,
    gender: draft.gender,
    age: Number.isFinite(age) ? age : 0,
    interests: draft.interests,
    budget: budget !== undefined && Number.isFinite(budget) && budget > 0 ? budget : undefined,
    excludedProviders: draft.excludedProviders,
  };
}

interface Run {
  recipientId: string;
  brief: GiftBrief;
  response: GiftSearchResponse;
  result: RankResult;
  /** How many extra searches the semantic layer added. */
  semanticSearches: number;
  semanticMatching: boolean;
  queryVector: Float32Array | null;
  ideaVectors: Map<string, Float32Array> | null;
}

export default function GiftGenie() {
  const { recipients, add, update, remove } = useGiftRecipients();
  const hydrated = useHydrated();
  const ledger = useSyncExternalStore(subscribeLedger, getLedgerSnapshot, getLedgerServerSnapshot);
  const semantic = useSyncExternalStore(subscribeSemantic, getSemanticState, getSemanticState);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);
  const [context, setContext] = useState('');
  const [allowParts, setAllowParts] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<UnifiedProduct | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () => recipients.find((r) => r.id === selectedId) ?? recipients[0] ?? null,
    [recipients, selectedId]
  );

  const activeRun = run && selected && run.recipientId === selected.id ? run : null;

  /** Re-run the local ranker over an existing response (ledger/filters changed). */
  const rerank = useCallback(
    (current: Run, overrides: { ledger?: Ledger; allowParts?: boolean } = {}) => {
      const result = rankGiftIdeas(current.response.ideas, {
        budgetMax: current.brief.budget.max,
        interests: current.brief.appliedInterests,
        ledger: overrides.ledger ?? ledger,
        recipientId: current.recipientId,
        semanticQuery: context,
        semanticVector: current.queryVector,
        ideaVectors: current.ideaVectors,
        allowReplacementParts:
          overrides.allowParts ?? (allowParts || isDiyOrRepairProfile(current.brief.appliedInterests)),
        productTypeHints: Object.fromEntries(
          current.brief.intents
            .filter((entry) => entry.intent.productType)
            .map((entry) => [entry.intent.id, entry.intent.productType!])
        ),
        exclusions: current.brief.exclusions,
      });
      setRun({ ...current, result });
    },
    [allowParts, context, ledger]
  );

  const requestIdeas = useCallback(
    async (recipient: GiftRecipient) => {
      setBusy(true);
      setError(null);
      try {
        // 1. Compile the profile locally. Nothing here leaves the device.
        const brief = buildGiftBrief(recipient, { maxIntents: MAX_INTENTS });
        const requests = briefToIntentRequests(brief);

        // 2. Optional semantic expansion: free text → extra searches.
        let semanticSearches = 0;
        const selectedIds = new Set(brief.intents.map((entry) => entry.intent.id));
        const selectedQueries = new Set(
          brief.intents.map((entry) => entry.intent.query.trim().toLowerCase())
        );

        const extra: GiftIntentRequest[] = [];
        const matching =
          semantic.status === 'ready' && context.trim().length >= 3;
        if (matching) {
          const matches = await matchCorpus(context, {
            excludeIds: selectedIds,
            excludeQueries: selectedQueries,
            limit: 2,
          });
          for (const match of matches) {
            extra.push({
              intentId: match.entry.id,
              query: match.entry.query,
              label: `${match.entry.label} · semantic`,
              families: match.entry.families as GiftIntentRequest['families'],
              why: match.entry.why,
              maxPrice: brief.budget.max,
            });
          }
          semanticSearches = extra.length;
        }

        // 3. Ask the server to search those queries only.
        const response = await fetch('/api/gift/ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intents: [...requests, ...extra],
            excludedProviders: recipient.excludedProviders,
            maxResults: MAX_RESULTS,
          }),
        });
        const payload = (await response.json()) as GiftSearchResponse & { details?: string[] };
        if (!response.ok) {
          setError([payload.error ?? 'Gift search failed', ...(payload.details ?? [])].join(' — '));
          return;
        }

        // 4. Rank locally: semantic + budget + learned affinity + dedupe.
        const queryVector = matching ? await embedQuery(context) : null;
        const ideaVectors = semantic.status === 'ready'
          ? await embedProducts(payload.ideas.map((idea) => idea.product))
          : null;

        const next: Run = {
          recipientId: recipient.id,
          brief,
          response: payload,
          result: {
            ideas: [],
            bundles: [],
            hidden: { dismissed: 0, replacementParts: 0, ageExcluded: 0 },
            duplicatesRemoved: 0,
          },
          semanticSearches,
          semanticMatching: matching,
          queryVector,
          ideaVectors,
        };

        setRun({
          ...next,
          result: rankGiftIdeas(payload.ideas, {
            budgetMax: brief.budget.max,
            interests: brief.appliedInterests,
            ledger,
            recipientId: recipient.id,
            semanticQuery: context,
            semanticVector: queryVector,
            ideaVectors,
            allowReplacementParts: allowParts || isDiyOrRepairProfile(brief.appliedInterests),
            productTypeHints: Object.fromEntries(
              brief.intents
                .filter((entry) => entry.intent.productType)
                .map((entry) => [entry.intent.id, entry.intent.productType!])
            ),
            exclusions: brief.exclusions,
          }),
        });
        setSaved(new Set());
        setDismissed(new Set());
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Gift search failed');
      } finally {
        setBusy(false);
      }
    },
    [allowParts, context, ledger, semantic.status]
  );

  const interact = useCallback(
    (idea: RankedIdea, action: LedgerAction) => {
      if (!activeRun) return;
      const signals = signalsForIdea({
        recipientId: activeRun.recipientId,
        interests: idea.interestIds,
        productType: idea.productType,
        brands: idea.product.product.brand ? [idea.product.product.brand] : [],
        intentId: idea.intentId,
        retailer: idea.product.bestOffer?.offer.providerId,
      });

      let nextLedger = ledger;
      for (const signal of signals) {
        nextLedger = recordGiftInteraction({
          recipientId: activeRun.recipientId,
          dimension: signal.dimension,
          key: signal.key,
          action,
        });
      }

      setSaved((current) => {
        const next = new Set(current);
        if (action === 'saved') next.add(idea.product.product.canonicalId);
        if (action === 'dismissed') next.delete(idea.product.product.canonicalId);
        return next;
      });
      setDismissed((current) => {
        const next = new Set(current);
        if (action === 'dismissed') next.add(idea.product.product.canonicalId);
        if (action === 'saved') next.delete(idea.product.product.canonicalId);
        return next;
      });

      rerank(activeRun, { ledger: nextLedger });
    },
    [activeRun, ledger, rerank]
  );

  const handleSubmit = useCallback(
    (draft: Draft) => {
      const values = parseDraft(draft);
      if (values.name.trim().length === 0) {
        setError('Give this person a name so you can tell their profile apart.');
        return;
      }

      if (editor?.mode === 'edit') {
        const existing = recipients.find((r) => r.id === editor.id);
        if (existing) {
          const next = update(existing, values);
          setSelectedId(next.id);
          setEditor(null);
          setRun(null);
        }
      } else {
        const created = add(values);
        setSelectedId(created.id);
        setEditor(null);
        setRun(null);
      }
    },
    [add, editor, recipients, update]
  );

  const handleDelete = useCallback(
    (id: string) => {
      remove(id);
      if (run?.recipientId === id) setRun(null);
      if (selectedId === id) setSelectedId(null);
    },
    [remove, run, selectedId]
  );

  const editing = editor?.mode === 'edit' ? recipients.find((r) => r.id === editor.id) : undefined;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
            <Gift size={22} />
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
              Gift Genie
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Matching, ranking and learning all run in this browser. Only the compiled search
              terms are sent to the retailers.
            </p>
          </div>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <ShieldCheck size={14} />
          Profiles and interaction history stay on this device
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ── Recipients ───────────────────────────────────────────── */}
        <section className="lg:col-span-4" aria-label="Gift recipients">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Shopping for
            </h2>
            <button
              type="button"
              onClick={() => setEditor({ mode: 'new' })}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={14} /> Add person
            </button>
          </div>

          {!hydrated && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading saved people…</p>
          )}

          {hydrated && recipients.length === 0 && !editor && (
            <div className="rounded-2xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-[#3a3a3a] dark:text-gray-400">
              Nobody saved yet. Add someone and Gift Genie will build a shortlist of searches from
              their age, gender and interests — on this device.
            </div>
          )}

          <ul className="space-y-2">
            {recipients.map((recipient) => {
              const isActive = selected?.id === recipient.id;
              return (
                <li key={recipient.id}>
                  <div
                    className={`rounded-2xl border p-3 transition-colors ${
                      isActive
                        ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/30'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-[#2b2b2b] dark:hover:bg-[#1c1c1c]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(recipient.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {recipient.name}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {AGE_BRACKET_LABELS[ageBracketForAge(recipient.age)]} ·{' '}
                          {GENDER_LABELS[recipient.gender]}
                          {recipient.budget ? ` · under $${recipient.budget}` : ''}
                          {recipient.excludedProviders?.length
                            ? ` · no ${recipient.excludedProviders
                                .map((id) => getRetailerInfo(id as RetailerSource).label)
                                .join(', ')}`
                            : ''}
                        </p>
                        {recipient.interests.length > 0 && (
                          <p className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">
                            {recipient.interests
                              .map((id) => INTERESTS.find((i) => i.id === id)?.label ?? id)
                              .join(', ')}
                          </p>
                        )}
                      </button>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setEditor({ mode: 'edit', id: recipient.id })}
                          aria-label={`Edit ${recipient.name}`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-[#2a2a2a] dark:hover:text-gray-200"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(recipient.id)}
                          aria-label={`Remove ${recipient.name}`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── Ideas / editor ───────────────────────────────────────── */}
        <section className="lg:col-span-8" aria-label="Gift ideas">
          {editor && (
            <RecipientForm
              key={editor.mode === 'edit' ? editor.id : 'new'}
              initial={editing ? draftFrom(editing) : emptyDraft()}
              submitLabel={editor.mode === 'edit' ? 'Save changes' : 'Save person'}
              onCancel={() => setEditor(null)}
              onSubmit={handleSubmit}
            />
          )}

          {!editor && !selected && (
            <div className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-[#2b2b2b] dark:text-gray-400">
              Add a person to get started.
            </div>
          )}

          {!editor && selected && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Ideas for {selected.name}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {AGE_BRACKET_LABELS[ageBracketForAge(selected.age)]} ·{' '}
                    {GENDER_LABELS[selected.gender]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => requestIdeas(selected)}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Searching…
                    </>
                  ) : activeRun ? (
                    <>
                      <RefreshCw size={16} /> Refresh ideas
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> Get gift ideas
                    </>
                  )}
                </button>
              </div>

              {/* Controls: semantic opt-in + free text + type filter */}
              <div className="mb-4 space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-[#2b2b2b]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadSemanticModel()}
                    disabled={semantic.status === 'loading'}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      semantic.status === 'ready'
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-[#3a3a3a] dark:text-gray-300'
                    }`}
                  >
                    <BrainCircuit size={14} />
                    {semantic.status === 'ready'
                      ? `Semantic search on (${semantic.backend})`
                      : semantic.status === 'loading'
                        ? `Loading model… ${Math.round(semantic.progress * 100)}%`
                        : semantic.status === 'failed'
                          ? 'Semantic search unavailable — using keywords'
                          : 'Enable semantic search (~23 MB, once)'}
                  </button>

                  <label className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 dark:border-[#3a3a3a] dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={allowParts}
                      onChange={(event) => {
                        setAllowParts(event.target.checked);
                        if (activeRun) rerank(activeRun, { allowParts: event.target.checked });
                      }}
                      className="accent-blue-600"
                    />
                    <SlidersHorizontal size={13} />
                    Show replacement parts
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Anything else about them? (optional — used for semantic matching only)
                  </span>
                  <input
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder="e.g. cozy baking afternoons, tiny apartment kitchen"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
                  />
                </label>

                {semantic.status === 'failed' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    The local model could not load ({semantic.error}). Keyword matching is being
                    used instead — nothing is sent to a server either way.
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
                </p>
              )}

              {!activeRun && !busy && (
                <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-[#3a3a3a] dark:text-gray-400">
                  Gift Genie will compile this profile into a few searches locally, then rank what
                  comes back by budget fit, meaning and what you have saved or dismissed before.
                </div>
              )}

              {activeRun && (
                <IdeasResult
                  run={activeRun}
                  saved={saved}
                  dismissed={dismissed}
                  onOpen={setOpenProduct}
                  onInteract={interact}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {openProduct && (
        <ProductModal
          key={openProduct.id}
          product={openProduct}
          isOpen
          onClose={() => setOpenProduct(null)}
        />
      )}
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────────

function IdeasResult({
  run,
  saved,
  dismissed,
  onOpen,
  onInteract,
}: {
  run: Run;
  saved: Set<string>;
  dismissed: Set<string>;
  onOpen: (product: UnifiedProduct) => void;
  onInteract: (idea: RankedIdea, action: LedgerAction) => void;
}) {
  const { brief, response, result } = run;
  // A single "not for them" removes the card at once; the ledger only hides
  // whole searches/interests after repeated evidence.
  const ideas = result.ideas.filter(
    (idea) => !dismissed.has(idea.product.product.canonicalId)
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-[#2b2b2b]">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Searched for
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {brief.intents.map((entry) => (
            <li
              key={entry.intent.id}
              className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 dark:bg-[#242424] dark:text-gray-300"
            >
              <span className="font-medium">{entry.interestLabel}</span>
              <span className="text-gray-400 dark:text-gray-500"> · {entry.intent.query}</span>
            </li>
          ))}
          {run.semanticSearches > 0 && (
            <li className="rounded-full bg-violet-50 px-3 py-1 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              + {run.semanticSearches} semantic {run.semanticSearches === 1 ? 'match' : 'matches'}
            </li>
          )}
        </ul>

        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Trend data: Walmart bestseller ordering, sampled {response.momentumSampledAt.slice(0, 10)}.
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Budget ceiling ${brief.budget.max.toFixed(0)} (
          {brief.budget.source === 'recipient' ? 'your limit' : 'typical for this age'}) · layers:{' '}
          {Object.entries(brief.coverage)
            .filter(([, count]) => count > 0)
            .map(([family]) => FAMILY_LABELS[family] ?? family)
            .join(', ')}
          {brief.excludedProviders.length > 0
            ? ` · skipping ${brief.excludedProviders
                .map((id) => getRetailerInfo(id as RetailerSource).label)
                .join(', ')}`
            : ''}
        </p>

        {brief.droppedInterests.length > 0 && (
          <ul className="mt-2 space-y-1">
            {brief.droppedInterests.map((dropped) => (
              <li key={dropped.id} className="text-xs text-amber-600 dark:text-amber-400">
                {dropped.reason}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Ranked locally · {result.duplicatesRemoved} duplicate
          {result.duplicatesRemoved === 1 ? '' : 's'} removed ·{' '}
          {result.hidden.replacementParts} replacement part
          {result.hidden.replacementParts === 1 ? '' : 's'} hidden ·{' '}
          {result.hidden.ageExcluded} age-inappropriate · {result.hidden.dismissed} dismissed
          earlier
        </p>
      </div>

      {response.providersUnavailable.length > 0 && (
        <ul className="space-y-1">
          {response.providersUnavailable.map((entry) => (
            <li key={entry.providerId} className="text-xs text-gray-500 dark:text-gray-400">
              {getRetailerInfo(entry.providerId as RetailerSource).label}: {entry.detail}
            </li>
          ))}
        </ul>
      )}

      {result.bundles.length > 0 && <Bundles bundles={result.bundles} onOpen={onOpen} />}

      {ideas.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-[#2b2b2b] dark:text-gray-400">
          Nothing came back once parts and dismissed items were filtered out. Try adding an
          interest, raising the budget, or toggling replacement parts on.
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {ideas.length} ideas from {response.intents.filter((i) => i.resultCount > 0).length}{' '}
            searches in {(response.timingMs / 1000).toFixed(1)}s
          </p>
          <div className={RESULTS_GRID_CLASS}>
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.product.product.canonicalId}
                idea={idea}
                saved={saved.has(idea.product.product.canonicalId)}
                dismissed={dismissed.has(idea.product.product.canonicalId)}
                onOpen={onOpen}
                onInteract={onInteract}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  saved,
  dismissed,
  onOpen,
  onInteract,
}: {
  idea: RankedIdea;
  saved: boolean;
  dismissed: boolean;
  onOpen: (product: UnifiedProduct) => void;
  onInteract: (idea: RankedIdea, action: LedgerAction) => void;
}) {
  const product = useMemo(() => rankedProductToUnified(idea.product), [idea.product]);
  const showType = idea.productType !== 'main';

  return (
    <div className="min-w-0">
      <ProductCard product={product} rank={idea.position} ranked={idea.product} onClick={() => onOpen(product)} />
      <p className="mt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400" title={idea.why}>
        <span className="font-medium text-gray-600 dark:text-gray-300">{idea.intentLabel}</span> —{' '}
        {idea.why}
        {showType && (
          <span className="ml-1.5 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-[#2a2a2a] dark:text-gray-300">
            {PRODUCT_TYPE_LABELS[idea.productType]}
          </span>
        )}
      </p>
      <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500" title={idea.budget.reason}>
        {idea.budget.reason}
        {idea.semantic !== null ? ` · ${Math.round(idea.semantic * 100)}% match` : ''}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onInteract(idea, 'saved')}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
            saved
              ? 'bg-blue-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-[#2a2a2a]'
          }`}
        >
          <Bookmark size={11} /> {saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => onInteract(idea, 'dismissed')}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
            dismissed
              ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-[#2a2a2a]'
          }`}
        >
          <ThumbsDown size={11} /> Not for them
        </button>
      </div>
    </div>
  );
}

function Bundles({
  bundles,
  onOpen,
}: {
  bundles: Bundle[];
  onOpen: (product: UnifiedProduct) => void;
}) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        Pair them up
      </p>
      <ul className="mt-2 space-y-3">
        {bundles.map((bundle) => (
          <li key={bundle.id}>
            <p className="text-xs font-medium text-violet-800 dark:text-violet-200">{bundle.label}</p>
            <p className="text-[11px] text-violet-700/80 dark:text-violet-300/80">{bundle.rationale}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {bundle.items.map((item) => (
                <button
                  key={item.product.product.canonicalId}
                  type="button"
                  onClick={() => onOpen(rankedProductToUnified(item.product))}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] text-gray-700 shadow-sm hover:bg-gray-50 dark:bg-[#1c1c1c] dark:text-gray-200"
                >
                  {item.product.product.title.slice(0, 44)}
                  {item.price ? ` · $${item.price.toFixed(0)}` : ''}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Recipient form ─────────────────────────────────────────────────────

function RecipientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);

  const toggleInterest = (id: InterestId) => {
    setDraft((current) => ({
      ...current,
      interests: current.interests.includes(id)
        ? current.interests.filter((entry) => entry !== id)
        : [...current.interests, id],
    }));
  };

  const groups = useMemo(() => {
    const map = new Map<InterestGroup, typeof INTERESTS>();
    for (const interest of INTERESTS) {
      const list = map.get(interest.group) ?? [];
      list.push(interest);
      map.set(interest.group, list);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
      className="mb-6 rounded-2xl border border-gray-200 p-5 dark:border-[#2b2b2b]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {submitLabel === 'Save person' ? 'New gift recipient' : 'Edit recipient'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-[#2a2a2a]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Name</span>
          <input
            required
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="e.g. Priya"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Age</span>
          <input
            required
            type="number"
            min={0}
            max={120}
            value={draft.age}
            onChange={(event) => setDraft({ ...draft, age: event.target.value })}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Gender</span>
          <select
            value={draft.gender}
            onChange={(event) => setDraft({ ...draft, gender: event.target.value as Gender })}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          >
            {(Object.keys(GENDER_LABELS) as Gender[]).map((gender) => (
              <option key={gender} value={gender}>
                {GENDER_LABELS[gender]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Budget (optional)
          </span>
          <input
            type="number"
            min={1}
            step="1"
            value={draft.budget}
            onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
            placeholder="Leave empty for a typical amount"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
          Interests ({draft.interests.length} selected)
        </legend>
        <div className="space-y-3">
          {groups.map(([group, list]) => (
            <div key={group}>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {INTEREST_GROUP_LABELS[group] ?? group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((interest) => {
                  const active = draft.interests.includes(interest.id);
                  return (
                    <button
                      key={interest.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleInterest(interest.id)}
                      title={interest.teaser}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-gray-400 dark:border-[#3a3a3a] dark:text-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      {interest.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
          Leave out these retailers (optional)
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_IDS.map((id) => {
            const active = draft.excludedProviders.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    excludedProviders: active
                      ? current.excludedProviders.filter((entry) => entry !== id)
                      : [...current.excludedProviders, id],
                  }))
                }
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'border-red-400 bg-red-50 text-red-700 line-through dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400 dark:border-[#3a3a3a] dark:text-gray-300 dark:hover:border-gray-500'
                }`}
              >
                {getRetailerInfo(id as RetailerSource).label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#242424]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
