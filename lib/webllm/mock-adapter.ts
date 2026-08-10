// ── Mock WebLLM adapter ─────────────────────────────────────────────────
//
// Used for development and testing when WebGPU is unavailable or WebLLM
// is not needed. Always falls back to deterministic planning.

import type { WebLLMAdapter, WebLLMStatus, WebLLMState } from './types';
import type { SearchPlan, LocalPlannerInput, ResultExplanationInput, SearchExplanation } from '@/search/types';
import { createFallbackPlan } from '@/search/planner';

/**
 * Mock adapter that always reports WebLLM as unavailable.
 * This ensures the app works without WebGPU support.
 */
export class MockWebLLMAdapter implements WebLLMAdapter {
  private state: WebLLMState = 'idle';

  async status(): Promise<WebLLMStatus> {
    return {
      available: false,
      supported: false,
      state: this.state,
      error: undefined,
    };
  }

  async initialize(_options?: {
    preferredModel?: string;
    signal?: AbortSignal;
    onProgress?: (progress: number, text: string) => void;
  }): Promise<void> {
    this.state = 'error';
    // Simulate attempting to load, then failing gracefully
    _options?.onProgress?.(0, 'Checking WebGPU support...');
    // Immediately report that WebLLM is not available
    _options?.onProgress?.(1, 'WebGPU not available — using fast search mode');
  }

  async createSearchPlan(
    input: LocalPlannerInput,
    _signal?: AbortSignal
  ): Promise<{ source: 'webllm'; plan: SearchPlan }> {
    // Even the mock adapter falls back to deterministic planning
    // but reports the source correctly
    throw new Error('WebLLM not available');
  }

  async explainResults(
    _input: ResultExplanationInput,
    _signal?: AbortSignal
  ): Promise<{ source: 'webllm'; explanation: SearchExplanation }> {
    throw new Error('WebLLM not available');
  }
}

/** Singleton for the mock adapter. */
export const mockWebLLMAdapter = new MockWebLLMAdapter();
