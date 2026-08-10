// ── Structured telemetry / logging for search requests ──────────────────

export interface SearchTelemetry {
  requestId: string;
  startTime: number;

  log(phase: string, details: Record<string, unknown>): void;
  error(phase: string, error: unknown): void;
  finish(): SearchTimingSummary;
}

export interface SearchTimingSummary {
  requestId: string;
  totalMs: number;
  phases: Record<string, number>;
  providerErrors: Array<{ providerId: string; errorType: string }>;
  candidateCounts: {
    total: number;
    perProvider: Record<string, number>;
  };
}

let requestCounter = 0;

export function createTelemetry(): SearchTelemetry {
  const requestId = `search-${Date.now()}-${++requestCounter}`;
  const startTime = performance.now();
  const phases: Record<string, number> = {};
  const phaseStarts: Record<string, number> = {};
  const providerErrors: Array<{ providerId: string; errorType: string }> = [];
  const perProvider: Record<string, number> = {};

  const log = (phase: string, details: Record<string, unknown>) => {
    const now = performance.now();
    if (phaseStarts[phase]) {
      phases[phase] = (phases[phase] || 0) + (now - phaseStarts[phase]);
      delete phaseStarts[phase];
    }

    // Only log in development; in production this would go to a proper logger
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[${requestId}] ${phase}:`,
        JSON.stringify({ ...details, elapsed: (now - startTime).toFixed(0) + 'ms' })
      );
    }
  };

  return {
    requestId,
    startTime,

    log(phase: string, details: Record<string, unknown>) {
      log(phase, details);
    },

    error(phase: string, error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      providerErrors.push({ providerId: phase, errorType: err.name });
      if (process.env.NODE_ENV === 'development') {
        console.error(`[${requestId}] ERROR ${phase}:`, err.message);
      }
    },

    finish(): SearchTimingSummary {
      const now = performance.now();
      // Close any open phase timers
      for (const phase of Object.keys(phaseStarts)) {
        phases[phase] = (phases[phase] || 0) + (now - phaseStarts[phase]);
      }

      return {
        requestId,
        totalMs: Math.round(now - startTime),
        phases,
        providerErrors,
        candidateCounts: {
          total: Object.values(perProvider).reduce((a, b) => a + b, 0),
          perProvider,
        },
      };
    },
  };
}
