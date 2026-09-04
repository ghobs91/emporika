'use client';

// ── Intelligent search hook ────────────────────────────────────────────
//
// Stream-first search flow: tries SSE progressive results
// (POST /api/search?stream=1) and falls back to the batched POST when the
// stream ends without a `final` event (proxies that buffer SSE, aborts).
// WebLLM initialization stays non-blocking and only enhances later searches.

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  SearchApiResponse,
  SearchStatus as SearchStatusType,
  ShopperPreferences,
  RankedProduct,
  ProviderId,
  SearchMetadata,
} from '@/search/types';
import { getWebLLMClient } from '@/lib/webllm/client';
import type { RetailerSource } from '@/types/unified';

export type { SearchStatusType, SearchApiResponse };

/**
 * How many ranked results to request per search. The server caps at 120
 * (schema limit); the UI paginates this list locally so we never re-hit
 * retailer APIs just to show the next page.
 */
const MAX_RESULTS = 120;

export interface IntelligentSearchState {
  response: SearchApiResponse | null;
  isLoading: boolean;
  /** True while progressive (partial) results are shown and providers are still running. */
  streaming: boolean;
  query: string;
  webllmStatus: {
    status: 'idle' | 'loading' | 'ready' | 'fast' | 'error' | 'disabled';
    progress: number;
    error?: string;
  };
  aiEnabled: boolean;
}

interface StreamPartialFrame {
  results: RankedProduct[];
  providersDone: ProviderId[];
  providersPending: ProviderId[];
  totalCandidates: number;
}

function errorResponse(query: string, message: string): SearchApiResponse {
  return {
    status: 'error' as SearchStatusType,
    query,
    metadata: {
      plannerSource: 'fallback',
      providersSearched: [],
      providersFailed: [],
      totalCandidates: 0,
      entityResolutionCounts: { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 },
      filtersApplied: [],
      timingMs: { planning: 0, search: 0, entityResolution: 0, ranking: 0, total: 0 },
    },
    error: message,
  };
}

function partialMetadata(frame: StreamPartialFrame): SearchMetadata {
  return {
    plannerSource: 'fallback',
    providersSearched: frame.providersDone,
    providersFailed: [],
    totalCandidates: frame.totalCandidates,
    entityResolutionCounts: { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unmatched: 0 },
    filtersApplied: [],
    timingMs: { planning: 0, search: 0, entityResolution: 0, ranking: 0, total: 0 },
  };
}

export function useIntelligentSearch() {
  const [state, setState] = useState<IntelligentSearchState>({
    response: null,
    isLoading: false,
    streaming: false,
    query: '',
    webllmStatus: { status: 'idle', progress: 0 },
    aiEnabled: true,
  });

  const abortRef = useRef<AbortController | null>(null);
  const client = getWebLLMClient();

  /** Pre-warm WebLLM in the background (non-blocking). */
  const prewarmWebLLM = useCallback(async () => {
    if (!state.aiEnabled) return;

    // Already ready or already loading
    const currentStatus = await client.getStatus().catch(() => null);
    if (currentStatus?.state === 'ready' || currentStatus?.state === 'loading') return;

    setState(s => ({ ...s, webllmStatus: { status: 'loading', progress: 0 } }));

    try {
      await client.initialize((progress, text) => {
        setState(s => ({
          ...s,
          webllmStatus: { status: progress >= 1 ? 'ready' : 'loading', progress },
        }));
      });

      const status = await client.getStatus();
      setState(s => ({
        ...s,
        webllmStatus: {
          status: status.available ? 'ready' : 'fast',
          progress: 1,
        },
      }));
    } catch {
      setState(s => ({
        ...s,
        webllmStatus: { status: 'fast', progress: 0 },
      }));
    }
  }, [state.aiEnabled, client]);

  // Pre-warm on mount
  useEffect(() => {
    if (state.aiEnabled) {
      // Delay pre-warm slightly so the page renders first
      const timer = setTimeout(() => prewarmWebLLM(), 1000);
      return () => clearTimeout(timer);
    }
  }, [state.aiEnabled, prewarmWebLLM]);

  /** Batched POST search (fallback when streaming is unavailable). */
  const runBatched = useCallback(async (
    payload: Record<string, unknown>,
    signal: AbortSignal,
    query: string,
  ) => {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      setState(s => ({
        ...s,
        isLoading: false,
        streaming: false,
        response: errorResponse(query, error.error || error.details || 'Search failed'),
      }));
      return;
    }

    const data: SearchApiResponse = await response.json();
    setState(s => ({
      ...s,
      isLoading: false,
      streaming: false,
      response: data,
    }));
  }, []);

  /**
   * SSE progressive search. Resolves true once the `final` event lands;
   * any earlier failure (or a stream that ends without `final`) resolves
   * false so the caller can fall back to the batched POST.
   */
  const runStreamed = useCallback(async (
    payload: Record<string, unknown>,
    signal: AbortSignal,
    query: string,
  ): Promise<boolean> => {
    const response = await fetch('/api/search?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) return false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotFinal = false;

    try {
      while (!gotFinal) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          let event = '';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!event || !data) continue;

          if (event === 'partial') {
            const frame = JSON.parse(data) as StreamPartialFrame;
            setState(s => ({
              ...s,
              isLoading: true,
              streaming: true,
              response: {
                status: 'partial_results' as SearchStatusType,
                query,
                results: frame.results,
                metadata: partialMetadata(frame),
              },
            }));
          } else if (event === 'final') {
            gotFinal = true;
            const data_ = JSON.parse(data) as SearchApiResponse;
            setState(s => ({
              ...s,
              isLoading: false,
              streaming: false,
              response: data_,
            }));
          }
          // `provider` events are progress-only; reserved for future UI.
        }
      }
    } finally {
      reader.releaseLock();
    }

    return gotFinal;
  }, []);

  /** Execute an intelligent search. Streams when possible, else batched. */
  const search = useCallback(async (
    query: string,
    preferences?: ShopperPreferences,
    selectedSources?: RetailerSource[],
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState(s => ({
      ...s,
      isLoading: true,
      streaming: false,
      query,
      response: null,
    }));

    const payload = {
      query,
      preferences: {
        ...preferences,
        ...(selectedSources ? { includedProviders: selectedSources } : {}),
        maxResults: MAX_RESULTS,
      },
      // No candidatePlan on first search — WebLLM may not be ready yet
      // Server falls back to deterministic planner
    };

    // Stream first; fall back to batched when the stream dies early.
    // An abort surfaces as a throw — same as the old behavior (no silent fallback).
    let streamed = false;
    try {
      streamed = await runStreamed(payload, controller.signal, query);
    } catch {
      streamed = false;
    }
    if (!streamed && !controller.signal.aborted) {
      await runBatched(payload, controller.signal, query);
    }

    // ── WebLLM enhancement: re-search with a model-generated plan ──
    // Best-effort and non-blocking for the primary results above.
    try {
      const status = await client.getStatus();
      if (status.available && status.state === 'ready' && !controller.signal.aborted) {
        const planResult = await client.createSearchPlan({
          query,
          preferences,
          availableProviders: (selectedSources as import('@/search/types').ProviderId[]) || [],
        });

        if (planResult.source === 'webllm' && planResult.plan) {
          // Re-search with the WebLLM-generated plan
          const enhancedResponse = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              preferences: {
                ...preferences,
                ...(selectedSources ? { includedProviders: selectedSources } : {}),
                maxResults: MAX_RESULTS,
              },
              candidatePlan: planResult.plan,
            }),
            signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
          });

          if (enhancedResponse.ok) {
            const enhancedData: SearchApiResponse = await enhancedResponse.json();
            setState(s => ({
              ...s,
              isLoading: false,
              streaming: false,
              response: enhancedData,
            }));
          }
        }
      }
    } catch {
      // WebLLM enhancement failed — the primary results stand
    }
  }, [client, runBatched, runStreamed]);

  /** Toggle AI-assisted search mode. */
  const toggleAiMode = useCallback(() => {
    setState(s => ({ ...s, aiEnabled: !s.aiEnabled }));
  }, []);

  return {
    state,
    search,
    toggleAiMode,
  };
}
