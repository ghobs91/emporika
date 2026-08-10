// ── Real WebLLM adapter ─────────────────────────────────────────────────
//
// Spawns a dedicated Web Worker running @mlc-ai/web-llm for browser-local
// inference. Implements the WebLLMAdapter interface.

import type { WebLLMAdapter, WebLLMStatus, WebLLMState } from './types';
import type { SearchPlan, LocalPlannerInput, ResultExplanationInput, SearchExplanation } from '@/search/types';
import { buildPlanningPrompt, buildRepairPrompt, buildExplanationPrompt } from './prompts';
import { validatePlan } from '@/search/schemas';

// ── Worker message types ──────────────────────────────────────────────

type WorkerMessage =
  | { type: 'init'; modelId: string }
  | { type: 'generate'; id: number; prompt: string; temperature?: number }
  | { type: 'abort'; id: number };

type WorkerResponse =
  | { type: 'progress'; progress: number; text: string }
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'aborted'; id: number };

// ── Adapter ───────────────────────────────────────────────────────────

export class RealWebLLMAdapter implements WebLLMAdapter {
  private worker: Worker | null = null;
  private state: WebLLMState = 'idle';
  private modelId: string | null = null;
  private errorMessage: string | null = null;
  private pendingRequests: Map<number, {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  }> = new Map();
  private nextId = 0;

  /** Check if WebGPU is supported in this browser. */
  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'gpu' in navigator;
  }

  async status(): Promise<WebLLMStatus> {
    return {
      available: this.state === 'ready',
      supported: RealWebLLMAdapter.isSupported(),
      state: this.state,
      modelId: this.modelId ?? undefined,
      error: this.errorMessage ?? undefined,
    };
  }

  async initialize(options?: {
    preferredModel?: string;
    signal?: AbortSignal;
    onProgress?: (progress: number, text: string) => void;
  }): Promise<void> {
    const modelId = options?.preferredModel || 'Qwen3-1.7B-q4f16_1-MLC';

    // Check WebGPU support
    if (!RealWebLLMAdapter.isSupported()) {
      this.state = 'error';
      this.errorMessage = 'WebGPU not supported in this browser';
      throw new Error(this.errorMessage);
    }

    this.state = 'loading';
    this.modelId = modelId;
    this.errorMessage = null;

    // Spawn the worker
    try {
      this.worker = new Worker(
        new URL('./worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;

        switch (msg.type) {
          case 'progress':
            options?.onProgress?.(msg.progress, msg.text);
            break;

          case 'ready':
            this.state = 'ready';
            break;

          case 'error':
            this.state = 'error';
            this.errorMessage = msg.error;
            // Reject all pending requests
            for (const [, req] of this.pendingRequests) {
              req.reject(new Error(msg.error));
            }
            this.pendingRequests.clear();
            break;

          case 'result': {
            const req = this.pendingRequests.get(msg.id);
            if (req) {
              this.pendingRequests.delete(msg.id);
              req.resolve(msg.text);
            }
            break;
          }

          case 'aborted': {
            const req = this.pendingRequests.get(msg.id);
            if (req) {
              this.pendingRequests.delete(msg.id);
              req.reject(new DOMException('Aborted', 'AbortError'));
            }
            break;
          }
        }
      };

      this.worker.onerror = (err) => {
        this.state = 'error';
        this.errorMessage = err.message || 'Worker error';
      };

      // Tell the worker to load the model
      this.worker.postMessage({ type: 'init', modelId } satisfies WorkerMessage);

      // Wait for the worker to signal ready or error
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (this.state === 'ready') {
            resolve();
          } else if (this.state === 'error') {
            reject(new Error(this.errorMessage || 'Model failed to load'));
          } else {
            setTimeout(check, 200);
          }
        };
        check();

        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    } catch (err) {
      this.state = 'error';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async createSearchPlan(
    input: LocalPlannerInput,
    signal?: AbortSignal
  ): Promise<{ source: 'webllm'; plan: SearchPlan }> {
    if (!this.worker || this.state !== 'ready') {
      throw new Error('WebLLM engine not ready');
    }

    const prompt = buildPlanningPrompt(input.query, input.availableProviders);

    // Generate with retry on validation failure
    let rawOutput: string;
    try {
      rawOutput = await this.generate(prompt, signal);
    } catch (err) {
      throw new Error(`WebLLM planning failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      // Not valid JSON — try one repair
      try {
        const repairPrompt = buildRepairPrompt(input.query, rawOutput, ['Output is not valid JSON']);
        const repaired = await this.generate(repairPrompt, signal);
        parsed = JSON.parse(repaired);
      } catch {
        throw new Error('WebLLM output was not valid JSON after repair retry');
      }
    }

    const result = validatePlan(parsed);
    if (!result.valid) {
      // Try one repair with specific validation errors
      try {
        const repairPrompt = buildRepairPrompt(input.query, rawOutput, result.errors);
        const repaired = await this.generate(repairPrompt, signal);
        const repairedParsed = JSON.parse(repaired);
        const repairedResult = validatePlan(repairedParsed);

        if (!repairedResult.valid) {
          throw new Error(`Plan validation failed after repair: ${repairedResult.errors.join('; ')}`);
        }
        return { source: 'webllm', plan: repairedResult.plan };
      } catch (err) {
        if (err instanceof Error && err.message.includes('Plan validation failed')) throw err;
        throw new Error(`Plan validation failed: ${result.errors.join('; ')}`);
      }
    }

    return { source: 'webllm', plan: result.plan };
  }

  async explainResults(
    input: ResultExplanationInput,
    signal?: AbortSignal
  ): Promise<{ source: 'webllm'; explanation: SearchExplanation }> {
    if (!this.worker || this.state !== 'ready') {
      throw new Error('WebLLM engine not ready');
    }

    const prompt = buildExplanationPrompt({
      canonicalIntent: input.canonicalIntent,
      productCount: input.products.length,
      topProducts: input.products.slice(0, 5).map(p => ({
        title: p.product.title,
        rank: p.rank,
        score: p.productScore,
        reasons: p.reasonsToChoose,
        tradeoffs: p.tradeoffs,
        uncertainty: p.uncertaintyFlags,
      })),
      metadata: {
        providersSearched: input.metadata.providersSearched,
        warnings: input.metadata.providersFailed.map(f => `${f.providerId}: ${f.errorType}`),
      },
    });

    const text = await this.generate(prompt, signal);

    return {
      source: 'webllm',
      explanation: {
        summary: text,
        perProduct: [],
        caveats: ['Generated by local AI model — verify all claims against structured results above.'],
      },
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private generate(prompt: string, signal?: AbortSignal): Promise<string> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized'));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pendingRequests.set(id, { resolve, reject });

      this.worker!.postMessage({
        type: 'generate',
        id,
        prompt,
        temperature: 0.1,
      } satisfies WorkerMessage);

      // Handle abort
      if (signal) {
        if (signal.aborted) {
          this.pendingRequests.delete(id);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          this.pendingRequests.delete(id);
          this.worker?.postMessage({ type: 'abort', id } satisfies WorkerMessage);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }
}
