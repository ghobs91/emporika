// ── Search module barrel export ─────────────────────────────────────────

export * from './types';
export * from './schemas';
export * from './errors';
export * from './planner';
export * from './orchestrator';

// Pipeline
export { normalizeCandidate, normalizeProviderResults } from './normalize';
export { resolveEntities } from './entity-resolution';
export { computeOfferComparability, areOfferPricesComparable, assessVariantComparability } from './offer-normalize';
export { applyHardFilters } from './filter';
export { rankProducts } from './ranker';

// Providers
export { providerAdapters, getProvider, getAvailableProviders } from './providers/adapter';
export { getCapabilities, supportsDetailEnrichment, PROVIDER_CAPABILITIES } from './providers/capabilities';

// Telemetry
export { createTelemetry } from './telemetry';
