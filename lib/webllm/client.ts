// ── WebLLM client adapter ──────────────────────────────────────────────
//
// This is the browser-side entry point for WebLLM functionality.
// Currently uses the MockWebLLMAdapter (always degrades gracefully).
//
// To enable actual WebLLM with @mlc-ai/web-llm, swap the adapter
// implementation below. The interface remains the same.

import type { WebLLMAdapter, WebLLMStatus, WebLLMModelConfig } from './types';
import type { SearchPlan, LocalPlannerInput, ResultExplanationInput, SearchExplanation } from '@/search/types';
import { MockWebLLMAdapter } from './mock-adapter';
import { RealWebLLMAdapter } from './real-adapter';
import { getDefaultModelConfig } from './types';
import { createFallbackPlan } from '@/search/planner';

/**
 * WebLLM client — singleton that wraps whichever adapter is active.
 * Use `getWebLLMClient()` to access.
 */
class WebLLMClient {
  private adapter: WebLLMAdapter;
  private modelConfig: WebLLMModelConfig;
  private initialized = false;
  private initError: string | null = null;

  constructor() {
    this.modelConfig = getDefaultModelConfig();
    // Auto-detect: use real adapter if WebGPU is supported
    if (this.modelConfig.enabled && RealWebLLMAdapter.isSupported()) {
      this.adapter = new RealWebLLMAdapter();
    } else {
      this.adapter = new MockWebLLMAdapter();
    }
  }


  get config(): WebLLMModelConfig {
    return this.modelConfig;
  }

  /** Check if WebLLM is enabled and potentially available. */
  isEnabled(): boolean {
    return this.modelConfig.enabled;
  }

  /** Get current status from the adapter. */
  async getStatus(): Promise<WebLLMStatus> {
    if (!this.modelConfig.enabled) {
      return {
        available: false,
        supported: false,
        state: 'error',
        error: 'WebLLM is disabled',
      };
    }

    if (this.initError) {
      return {
        available: false,
        supported: false,
        state: 'error',
        error: this.initError,
      };
    }

    try {
      return await this.adapter.status();
    } catch {
      return {
        available: false,
        supported: false,
        state: 'error',
        error: 'Could not check WebLLM status',
      };
    }
  }

  /** Initialize the model (lazy, called on first search). */
  async initialize(onProgress?: (progress: number, text: string) => void): Promise<void> {
    if (this.initialized) return;
    if (!this.modelConfig.enabled) return;

    try {
      await this.adapter.initialize({
        preferredModel: this.modelConfig.defaultModel,
        onProgress,
      });
      this.initialized = true;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : 'Unknown error';
      // Don't throw — the app continues with fallback planning
      console.warn('WebLLM initialization failed:', this.initError);
    }
  }

  /**
   * Generate a SearchPlan from a natural-language query.
   * Falls back to deterministic planning if WebLLM is unavailable or fails.
   */
  async createSearchPlan(
    input: LocalPlannerInput
  ): Promise<{ source: 'webllm' | 'fallback'; plan: SearchPlan }> {
    // Try WebLLM first
    if (this.modelConfig.enabled && this.initialized && !this.initError) {
      try {
        const result = await this.adapter.createSearchPlan(input);
        return { source: 'webllm', plan: result.plan };
      } catch {
        // Fall through to fallback
      }
    }

    // Deterministic fallback
    const plan = createFallbackPlan(
      input.query,
      input.availableProviders,
      input.preferences
    );
    return { source: 'fallback', plan };
  }

  /**
   * Generate a natural-language explanation of results.
   * Falls back to null if WebLLM is unavailable.
   */
  async explainResults(
    input: ResultExplanationInput
  ): Promise<{ source: 'webllm' | 'fallback'; explanation: SearchExplanation } | null> {
    if (this.modelConfig.enabled && this.initialized && !this.initError) {
      try {
        const result = await this.adapter.explainResults(input);
        return { source: 'webllm', explanation: result.explanation };
      } catch {
        return null;
      }
    }

    return null;
  }
}

/** Global singleton. */
let clientInstance: WebLLMClient | null = null;

export function getWebLLMClient(): WebLLMClient {
  if (!clientInstance) {
    clientInstance = new WebLLMClient();
  }
  return clientInstance;
}

// Re-export for convenience
export { createFallbackPlan } from '@/search/planner';
