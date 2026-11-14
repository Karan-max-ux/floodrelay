export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isConflict: boolean;
  public readonly isNotFound: boolean;
  public readonly isNetworkError: boolean;

  constructor(params: {
    message: string;
    statusCode: number;
    code?: string;
    details?: unknown;
    isNetworkError?: boolean;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.statusCode = params.statusCode;
    this.code = params.code || (params.statusCode === 409 ? 'CONFLICT' : 'API_ERROR');
    this.details = params.details;
    this.isConflict = params.statusCode === 409;
    this.isNotFound = params.statusCode === 404;
    this.isNetworkError = Boolean(params.isNetworkError);
  }
}

/**
 * Checks whether an error represents an intentional fetch or DOM abort.
 */
export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.message && /aborted/i.test(err.message)) return true;
  }
  if (
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    err.name === 'AbortError'
  ) {
    return true;
  }
  return false;
}
