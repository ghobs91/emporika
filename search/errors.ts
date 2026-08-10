// ── Search-specific error types ─────────────────────────────────────────

export class SearchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly publicMessage: string = message
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

export class ProviderSearchError extends SearchError {
  constructor(
    message: string,
    public readonly providerId: string,
    statusCode: number = 502
  ) {
    super(message, 'PROVIDER_SEARCH_ERROR', statusCode);
    this.name = 'ProviderSearchError';
  }
}

export class PlanValidationError extends SearchError {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message, 'PLAN_VALIDATION_ERROR', 400);
    this.name = 'PlanValidationError';
  }
}

export class ClarificationRequiredError extends SearchError {
  constructor(
    public readonly field: string,
    public readonly question: string,
    public readonly reason: string
  ) {
    super('Clarification required', 'CLARIFICATION_REQUIRED', 200);
    this.name = 'ClarificationRequiredError';
  }
}

export class AllProvidersFailedError extends SearchError {
  constructor(
    message: string,
    public readonly providerErrors: Array<{ providerId: string; error: string }>
  ) {
    super(message, 'ALL_PROVIDERS_FAILED', 502);
    this.name = 'AllProvidersFailedError';
  }
}
