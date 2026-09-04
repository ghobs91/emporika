// ── Bounded-concurrency mapper ──────────────────────────────────────────
//
// Runs an async function over items with at most `limit` in flight,
// preserving input order in the output. Used to cap retailer fan-out
// (outer: providers) and per-provider query variants (inner: each
// provider's maxConcurrentRequests capability).

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onSettled?: (index: number) => void
): Promise<R[]> {
  const effective = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: effective }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } finally {
        onSettled?.(index);
      }
    }
  });

  await Promise.all(workers);
  return results;
}
