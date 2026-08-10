// ── WebLLM-specific types ──────────────────────────────────────────────

import type { SearchPlan, LocalPlannerInput, ResultExplanationInput, SearchExplanation } from '@/search/types';

/** Status of the local WebLLM engine. */
export type WebLLMState = 'idle' | 'loading' | 'ready' | 'error';

/** Model configuration for WebLLM. */
export interface WebLLMModelConfig {
  /** Default model ID used for planning and explanation. */
  defaultModel: string;
  /** Lower-memory fallback model ID. */
  lowMemoryModel: string;
  /** Optional enhanced model for higher-quality planning. */
  enhancedModel?: string;
  /** Enable/disable WebLLM entirely. */
  enabled: boolean;
}

/** WebLLM status response from the adapter. */
export interface WebLLMStatus {
  available: boolean;
  supported: boolean;
  state: WebLLMState;
  modelId?: string;
  error?: string;
}

/** The WebLLM adapter interface — browser-side. */
export interface WebLLMAdapter {
  /** Get current engine status. */
  status(): Promise<WebLLMStatus>;

  /** Initialize the model (lazy, called on first search). */
  initialize(options?: {
    preferredModel?: string;
    signal?: AbortSignal;
    onProgress?: (progress: number, text: string) => void;
  }): Promise<void>;

  /** Generate a SearchPlan from a natural-language query. */
  createSearchPlan(
    input: LocalPlannerInput,
    signal?: AbortSignal,
  ): Promise<{ source: 'webllm'; plan: SearchPlan }>;

  /** Generate a natural-language explanation of ranked results. */
  explainResults(
    input: ResultExplanationInput,
    signal?: AbortSignal,
  ): Promise<{ source: 'webllm'; explanation: SearchExplanation }>;
}

/** Default model configuration (overridable via env vars). */
export function getDefaultModelConfig(): WebLLMModelConfig {
  return {
    defaultModel: process.env.NEXT_PUBLIC_WEBLLM_DEFAULT_MODEL || 'Qwen3-1.7B-q4f16_1-MLC',
    lowMemoryModel: process.env.NEXT_PUBLIC_WEBLLM_LOW_MEMORY_MODEL || 'Qwen3-4B-q4f16_1-MLC',
    enhancedModel: process.env.NEXT_PUBLIC_WEBLLM_ENHANCED_MODEL || 'Qwen3-8B-q4f16_1-MLC',
    enabled: process.env.NEXT_PUBLIC_WEBLLM_ENABLED !== 'false',
  };
}
