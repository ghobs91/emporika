'use client';

// ── Gift Genie ─────────────────────────────────────────────────────────
//
// Two things happen here and nowhere else in the app:
//   1. A shopper saves people they buy gifts for (name, gender, age,
//      interests). Those profiles live in this browser only.
//   2. Asking for ideas compiles that profile against the checked-in gift
//      index into concrete searches, then shows the interleaved results.
//
// No model runs anywhere in this flow — see `search/gift/index-data.ts`.

import { useCallback, useMemo, useState } from 'react';
import { Gift, Plus, Sparkles, Trash2, Pencil, Loader2, RefreshCw, AlertCircle, X } from 'lucide-react';
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
import { getRetailerInfo } from '@/lib/retailer';
import type { RetailerSource } from '@/types/unified';
import type {
  Gender,
  GiftIdeasResponse,
  GiftRecipient,
  InterestGroup,
  InterestId,
} from '@/search/gift/types';
import type { UnifiedProduct } from '@/types/unified';

const MAX_INTENTS = 6;
const MAX_RESULTS = 36;

const GENDERS: Gender[] = ['woman', 'man', 'nonbinary', 'unspecified'];

interface Draft {
  name: string;
  gender: Gender;
  age: string;
  interests: InterestId[];
  budget: string;
  /** Retailers to skip for this person. */
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

const FAMILY_LABELS: Record<string, string> = {
  age: 'age',
  gender: 'gender',
  combo: 'age + gender',
  interest: 'interests',
  brand: 'brands',
};

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

export default function GiftGenie() {
  const { recipients, add, update, remove } = useGiftRecipients();
  const hydrated = useHydrated();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);
  const [ideas, setIdeas] = useState<Record<string, GiftIdeasResponse>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<UnifiedProduct | null>(null);

  const selected = useMemo(
    () => recipients.find((r) => r.id === selectedId) ?? recipients[0] ?? null,
    [recipients, selectedId]
  );

  const requestIdeas = useCallback(async (recipient: GiftRecipient) => {
    setBusyId(recipient.id);
    setError(null);
    try {
      const response = await fetch('/api/gift/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient,
          maxIntents: MAX_INTENTS,
          maxResults: MAX_RESULTS,
        }),
      });
      const payload = (await response.json()) as GiftIdeasResponse & { details?: string[] };
      if (!response.ok) {
        setError(
          [payload.error ?? 'Gift search failed', ...(payload.details ?? [])].join(' — ')
        );
        return;
      }
      setIdeas((current) => ({ ...current, [recipient.id]: payload }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Gift search failed');
    } finally {
      setBusyId(null);
    }
  }, []);

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
          // Interests or age may have changed, so the old ideas are stale.
          setIdeas((current) => {
            const copy = { ...current };
            delete copy[next.id];
            return copy;
          });
        }
      } else {
        const created = add(values);
        setSelectedId(created.id);
        setEditor(null);
      }
    },
    [add, editor, recipients, update]
  );

  const handleDelete = useCallback(
    (id: string) => {
      remove(id);
      setIdeas((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
      if (selectedId === id) setSelectedId(null);
    },
    [remove, selectedId]
  );

  const editing = editor?.mode === 'edit' ? recipients.find((r) => r.id === editor.id) : undefined;
  const activeIdeas = selected ? ideas[selected.id] : undefined;
  const isLoading = selected ? busyId === selected.id : false;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
            <Gift size={22} />
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
              Gift Genie
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Save who you are shopping for. Ideas are matched from a built-in gift index — no AI
              guesswork, and nothing about these people leaves your browser.
            </p>
          </div>
        </div>
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
              their age, gender and interests.
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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Searching…
                    </>
                  ) : activeIdeas ? (
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

              {error && (
                <p
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
                </p>
              )}

              {!activeIdeas && !isLoading && (
                <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-[#3a3a3a] dark:text-gray-400">
                  Gift Genie will run a few targeted searches from this profile and interleave the
                  results into one list.
                </div>
              )}

              {activeIdeas && <IdeasResult response={activeIdeas} onOpen={setOpenProduct} />}
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

// ── Ideas list ─────────────────────────────────────────────────────────

function IdeasResult({
  response,
  onOpen,
}: {
  response: GiftIdeasResponse;
  onOpen: (product: UnifiedProduct) => void;
}) {
  const { brief, ideas, intents, providersUnavailable } = response;

  return (
    <div className="space-y-5">
      {/* What the brief resolved to — this is the explanation of the result. */}
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
        </ul>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Budget ceiling ${brief.budget.max.toFixed(0)} (
          {brief.budget.source === 'recipient' ? 'your limit' : 'typical for this age'})
          {' · '}
          layers:{' '}
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
      </div>

      {providersUnavailable.length > 0 && (
        <ul className="space-y-1">
          {providersUnavailable.map((entry) => (
            <li key={entry.providerId} className="text-xs text-gray-500 dark:text-gray-400">
              {entry.providerId}: {entry.detail}
            </li>
          ))}
        </ul>
      )}

      {ideas.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-[#2b2b2b] dark:text-gray-400">
          No gift ideas came back for this profile. Try adding an interest, or raising the budget.
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {ideas.length} ideas from {intents.filter((i) => i.resultCount > 0).length} searches in{' '}
            {(response.timingMs / 1000).toFixed(1)}s
          </p>
          <div className={RESULTS_GRID_CLASS}>
            {ideas.map((idea) => (
              <GiftIdeaCard
                key={`${idea.intentId}:${idea.product.product.canonicalId}`}
                idea={idea}
                onOpen={onOpen}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── One idea ───────────────────────────────────────────────────────────

/**
 * A product card plus the line that explains why it is here. The card shape
 * is the same one normal search results use, so gift ideas stay visually and
 * behaviourally consistent with the rest of the app.
 */
function GiftIdeaCard({
  idea,
  onOpen,
}: {
  idea: GiftIdeasResponse['ideas'][number];
  onOpen: (product: UnifiedProduct) => void;
}) {
  const product = useMemo(() => rankedProductToUnified(idea.product), [idea.product]);

  return (
    <div className="min-w-0">
      <ProductCard
        product={product}
        rank={idea.position}
        ranked={idea.product}
        onClick={() => onOpen(product)}
      />
      <p
        className="mt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400"
        title={idea.why}
      >
        <span className="font-medium text-gray-600 dark:text-gray-300">{idea.interestLabel}</span>{' '}
        — {idea.why}
      </p>
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
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Name
          </span>
          <input
            required
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="e.g. Priya"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Age
          </span>
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
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Gender
          </span>
          <select
            value={draft.gender}
            onChange={(event) => setDraft({ ...draft, gender: event.target.value as Gender })}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
          >
            {GENDERS.map((gender) => (
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
        <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          Saved with this person, so their gift searches stay off these retailers.
        </p>
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
