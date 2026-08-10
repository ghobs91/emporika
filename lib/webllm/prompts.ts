// ── Versioned WebLLM prompts ───────────────────────────────────────────
//
// These prompts are kept in source control so they can be versioned,
// tested, and iterated on without changing the adapter code.

/** Prompt version tag — bump when prompts change. */
export const PROMPT_VERSION = 'v1.0.0';

/** System prompt for search planning. */
export const PLANNING_SYSTEM_PROMPT = `You are a retailer-neutral shopping-query planner. Return only JSON conforming exactly to the requested SearchPlan schema.

You plan searches across multiple retail catalogs: Shopify Global Catalog, eBay, Best Buy, Walmart, and Costco.

Interpret the shopper's request into concise discovery queries, hard constraints, and transparent ranking criteria. Generate no more than five concise retailer-neutral search queries.

Do not claim that a product exists. Do not assume inventory, retailer pricing, product specifications, delivery, shipping, pickup, returns, warranties, seller quality, discounts, or retailer coverage.

Do not select a retailer unless the shopper explicitly asks to include or exclude it. Do not output API calls, tool names, URLs, credentials, executable code, raw provider arguments, or commentary.

Use a clarification only when the missing answer would materially change search constraints or ranking. Return JSON only.`;

/** Planning prompt template. {query} and {providers} are interpolated at runtime. */
export function buildPlanningPrompt(
  query: string,
  availableProviders: string[]
): string {
  return `${PLANNING_SYSTEM_PROMPT}

Available providers: ${availableProviders.join(', ')}.

Shopper request: "${query}"

Return a valid SearchPlan JSON object with version "1", canonicalIntent, searches (1-5 entries), sourceStrategy, hardFilters, ranking (1-8 criteria, weights sum to 1.0), optional clarification, and confidence (0-1).`;
}

/** Compact repair message sent when a previous plan failed validation. */
export function buildRepairPrompt(
  originalQuery: string,
  originalOutput: string,
  validationErrors: string[]
): string {
  return `Your previous SearchPlan JSON was invalid. Fix the errors and return only the corrected JSON.

Original request: "${originalQuery}"

Your invalid output:
${originalOutput}

Validation errors:
${validationErrors.map(e => `- ${e}`).join('\n')}

Return only the corrected JSON SearchPlan. Do not add commentary or markdown code fences.`;
}

/** System prompt for result explanation. */
export const EXPLANATION_SYSTEM_PROMPT = `You explain pre-ranked federated shopping results. Use only the structured facts supplied in the input.

Do not alter product order, offer order, score values, or ranking. Do not introduce products, sellers, retailers, prices, product features, shipping information, return policies, ratings, availability claims, or comparisons absent from the structured input.

Do not claim that a result is best everywhere, cheapest everywhere, or universally best. Qualify price and retailer comparisons as applying only to the searched sources. Clearly mention material uncertainty, including missing delivery evidence, different conditions, non-comparable variants, or incomplete product details.

Return concise, shopper-friendly text only.`;

/** Build an explanation prompt from ranked results. */
export function buildExplanationPrompt(input: {
  canonicalIntent: string;
  productCount: number;
  topProducts: Array<{
    title: string;
    rank: number;
    score: number;
    reasons: string[];
    tradeoffs: string[];
    uncertainty: string[];
  }>;
  metadata: {
    providersSearched: string[];
    warnings: string[];
  };
}): string {
  return `${EXPLANATION_SYSTEM_PROMPT}

The shopper searched for: "${input.canonicalIntent}"

Searched sources: ${input.metadata.providersSearched.join(', ')}.
${input.metadata.warnings.length > 0 ? `Warnings: ${input.metadata.warnings.join('; ')}` : ''}

Top ${input.topProducts.length} of ${input.productCount} results:

${input.topProducts.map(p => `
#${p.rank}: ${p.title} (score: ${p.score.toFixed(2)})
  Reasons: ${p.reasons.join(', ')}
  Tradeoffs: ${p.tradeoffs.join(', ') || 'None'}
  Uncertainty: ${p.uncertainty.join(', ') || 'None'}
`).join('\n')}

Write a concise, honest summary of what was found, highlighting the top results, noting important tradeoffs and uncertainties, and never overclaiming.`;
}
