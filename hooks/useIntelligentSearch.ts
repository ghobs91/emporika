'use client';

// ── Intelligent search hook ────────────────────────────────────────────
//
// Manages the WebLLM-enhanced search flow. Fires the POST search
// immediately — WebLLM initialization is non-blocking and only
// enhances subsequent searches.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SearchApiResponse, SearchStatus as SearchStatusType, ShopperPreferences } from '@/search/types';
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
  query: string;
  webllmStatus: {
    status: 'idle' | 'loading' | 'ready' | 'fast' | 'error' | 'disabled';
    progress: number;
    error?: string;
  };
  aiEnabled: boolean;
}

export function useIntelligentSearch() {
  const [state, setState] = useState<IntelligentSearchState>({
    response: null,
    isLoading: false,
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

  /** Execute an intelligent search. POST fires immediately. */
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
      query,
      response: null,
    }));

    // Fire the POST search IMMEDIATELY (don't wait for WebLLM)
    const searchPromise = (async () => {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          preferences: {
            ...preferences,
            ...(selectedSources ? { includedProviders: selectedSources } : {}),
            maxResults: MAX_RESULTS,
          },
          // No candidatePlan on first search — WebLLM may not be ready yet
          // Server falls back to deterministic planner
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json();
        setState(s => ({
          ...s,
          isLoading: false,
          response: {
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
            error: error.error || error.details || 'Search failed',
          },
        }));
        return;
      }

      const data: SearchApiResponse = await response.json();

      setState(s => ({
        ...s,
        isLoading: false,
        response: data,
      }));
    })();

    // ── In parallel: try WebLLM planning for a re-ranked result ──
    // If the model is already loaded, we can enhance the results.
    // This is best-effort and won't block.
    try {
      const status = await client.getStatus();
      if (status.available && status.state === 'ready') {
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
              response: enhancedData,
            }));
          }
        }
      }
    } catch {
      // WebLLM enhancement failed — the original results are already showing
    }

    await searchPromise;
  }, [client]);

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
