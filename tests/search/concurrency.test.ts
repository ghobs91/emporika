// ── Bounded-concurrency mapper tests ──────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '@/search/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('mapWithConcurrency', () => {
  it('preserves input order despite varying durations', async () => {
    const result = await mapWithConcurrency(
      [30, 10, 20, 0],
      4,
      async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return ms * 2;
      }
    );
    expect(result).toEqual([60, 20, 40, 0]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('handles empty input and oversized limits', async () => {
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n + 1)).toEqual([2, 3]);
  });

  it('notifies per completed item in completion order', async () => {
    const settled: number[] = [];
    await mapWithConcurrency(
      [30, 0, 10],
      3,
      async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return ms;
      },
      (index) => {
        settled.push(index);
      }
    );
    // Index 1 (0ms) settles before index 2 (10ms) before index 0 (30ms).
    expect(settled).toEqual([1, 2, 0]);
  });
});
