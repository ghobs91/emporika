'use client';

// ── Gift Genie results ──────────────────────────────────────────────────
//
// Presentation + the trend surface. All scoring already happened in
// `lib/gift/rank`; this component only renders the outcome and explains it:
// which layers were searched, which trend terms are active for this cohort,
// what was filtered out, and why each card scored where it did.

import { useMemo } from 'react';
import { Bookmark, Sparkles, ThumbsDown, TrendingUp } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import { RESULTS_GRID_CLASS } from '@/components/ProductGrid';
import { rankedProductToUnified } from '@/lib/ranked-products';
import type { GiftBrief } from '@/search/gift/types';
import type { GiftSearchResponse } from '@/search/gift/request';
import type { Bundle, RankedIdea, RankResult } from '@/lib/gift/rank';
import type { LedgerAction } from '@/lib/gift/ledger';
import { PRODUCT_TYPE_LABELS } from '@/lib/gift/product-type';
import { getRetailerInfo } from '@/lib/retailer';
import type { RetailerSource, UnifiedProduct } from '@/types/unified';

const FAMILY_LABELS: Record<string, string> = {
  age: 'age',
  gender: 'gender',
  combo: 'age + gender',
  interest: 'interests',
  brand: 'brands',
};

export interface GiftRun {
  recipientId: string;
  brief: GiftBrief;
  response: GiftSearchResponse;
  result: RankResult;
  semanticSearches: number;
  semanticMatching: boolean;
}

export interface TrendSurface {
  /** Human cohort label, e.g. "women in their 30s". */
  cohortLabel: string;
  /** ISO timestamp from trends.json. */
  updatedAt: string;
  ageDays: number;
  /** Strongest active term for this cohort, if any. */
  topTerm: string | null;
  source: 'network' | 'cache' | 'none';
}

export default function GiftGenieResults({
  run,
  saved,
  dismissed,
  trend,
  onOpen,
  onInteract,
}: {
  run: GiftRun;
  saved: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
  trend: TrendSurface | null;
  onOpen: (product: UnifiedProduct) => void;
  onInteract: (idea: RankedIdea, action: LedgerAction) => void;
}) {
  const { brief, response, result } = run;

  // A single "not for them" removes the card at once; the ledger only hides
  // whole searches/interests after repeated evidence.
  const ideas = useMemo(
    () => result.ideas.filter((idea) => !dismissed.has(idea.product.product.canonicalId)),
    [result.ideas, dismissed]
  );

  const trendingCount = ideas.filter((idea) => idea.trend).length;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-[#2b2b2b]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Searched for
          </p>
          {trend && trend.source !== 'none' && (
            <TrendPill trend={trend} trendingCount={trendingCount} />
          )}
        </div>

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
          {result.hidden.replacementParts === 1 ? '' : 's'} hidden · {result.hidden.ageExcluded}{' '}
          age-inappropriate · {result.hidden.dismissed} dismissed earlier
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
            {trendingCount > 0 ? ` · ${trendingCount} trend-boosted` : ''}
          </p>
          <div className={RESULTS_GRID_CLASS}>
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.product.product.canonicalId}
                idea={idea}
                saved={saved.has(idea.product.product.canonicalId)}
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

// ── Trend pill ─────────────────────────────────────────────────────────

function TrendPill({ trend, trendingCount }: { trend: TrendSurface; trendingCount: number }) {
  const freshness =
    trend.ageDays <= 1 ? 'updated today' : trend.ageDays <= 7 ? `updated ${trend.ageDays}d ago` : `updated ${trend.ageDays}d ago`;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      title={`Trend manifest for ${trend.cohortLabel}, generated ${trend.updatedAt.slice(0, 10)}`}
    >
      <TrendingUp size={12} />
      Trending
      {trend.topTerm ? <span className="font-normal">· {trend.topTerm}</span> : null}
      {trendingCount > 0 ? (
        <span className="rounded-full bg-amber-100 px-1.5 text-[10px] dark:bg-amber-900/60">
          {trendingCount}
        </span>
      ) : null}
      <span className="font-normal text-amber-600/70 dark:text-amber-400/70">· {freshness}</span>
    </span>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  saved,
  onOpen,
  onInteract,
}: {
  idea: RankedIdea;
  saved: boolean;
  onOpen: (product: UnifiedProduct) => void;
  onInteract: (idea: RankedIdea, action: LedgerAction) => void;
}) {
  const product = useMemo(() => rankedProductToUnified(idea.product), [idea.product]);
  const showType = idea.productType !== 'main';

  return (
    <div className="min-w-0">
      <ProductCard
        product={product}
        rank={idea.position}
        ranked={idea.product}
        onClick={() => onOpen(product)}
      />
      <p className="mt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400" title={idea.why}>
        <span className="font-medium text-gray-600 dark:text-gray-300">{idea.intentLabel}</span> —{' '}
        {idea.why}
        {showType && (
          <span className="ml-1.5 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-[#2a2a2a] dark:text-gray-300">
            {PRODUCT_TYPE_LABELS[idea.productType]}
          </span>
        )}
        {idea.trend && idea.trend.score >= 0.35 && (
          <span
            className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            title={`Semantic match ${Math.round(idea.trend.score * 100)}% with the trend term "${idea.trend.term}"`}
          >
            <TrendingUp size={9} /> {idea.trend.term}
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
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-[#2a2a2a]"
        >
          <ThumbsDown size={11} /> Not for them
        </button>
      </div>
    </div>
  );
}

function Bundles({ bundles, onOpen }: { bundles: Bundle[]; onOpen: (p: UnifiedProduct) => void }) {
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

// ── Trend answer (natural-language question) ───────────────────────────

export function TrendAnswerCard({
  question,
  answer,
  onUseInSearch,
}: {
  question: string;
  answer: {
    summary: string;
    matches: Array<{ term: string; category: string; similarity: number }>;
    resolved: string | null;
    updatedAt: string;
    ageDays: number;
    semantic: boolean;
  };
  onUseInSearch: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          <TrendingUp size={13} /> Trend answer
        </p>
        <span className="text-[10px] text-amber-700/70 dark:text-amber-400/70">
          {answer.semantic ? 'semantic' : 'keyword'} match · manifest {answer.updatedAt.slice(0, 10)}
          {answer.ageDays > 7 ? ` · ${answer.ageDays}d old` : ''}
        </span>
      </div>

      <p className="mt-1.5 text-xs text-amber-900/80 dark:text-amber-200/80">“{question}”</p>
      <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-100">{answer.summary}</p>

      {answer.matches.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {answer.matches.map((match) => (
            <li
              key={`${match.category}:${match.term}`}
              className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
              title={`${match.category} · ${Math.round(match.similarity * 100)}% match`}
            >
              {match.term}
              <span className="ml-1 text-amber-600/60 dark:text-amber-400/60">
                {Math.round(match.similarity * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onUseInSearch}
        className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
      >
        <Sparkles size={11} /> Boost these in the next search
      </button>
    </div>
  );
}
