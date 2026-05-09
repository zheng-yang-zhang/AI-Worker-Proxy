export class ProxyError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

export interface ErrorResponsePayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createErrorResponse(error: unknown): ErrorResponsePayload {
  if (error instanceof ProxyError) {
    return {
      status: error.statusCode,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: {
          message: error.message,
          type: 'proxy_error',
          code: error.code,
        },
      }),
    };
  }

  // Generic error
  const message = error instanceof Error ? error.message : 'Unknown error occurred';
  return {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      error: {
        message,
        type: 'internal_error',
      },
    }),
  };
}

export function getErrorStatusCode(error: unknown): number | undefined {
  if (!isObjectLike(error)) {
    return undefined;
  }

  const directStatusCode = error.statusCode;
  if (typeof directStatusCode === 'number') {
    return directStatusCode;
  }

  const directStatus = error.status;
  if (typeof directStatus === 'number') {
    return directStatus;
  }

  if (isObjectLike(error.response) && typeof error.response.status === 'number') {
    return error.response.status;
  }

  if (isObjectLike(error.cause)) {
    return getErrorStatusCode(error.cause);
  }

  return undefined;
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (isObjectLike(error)) {
    if (typeof error.message === 'string' && error.message) {
      return error.message;
    }

    if (typeof error.error === 'string' && error.error) {
      return error.error;
    }

    if (isObjectLike(error.error) && typeof error.error.message === 'string' && error.error.message) {
      return error.error.message;
    }
  }

  return 'Unknown error';
}

function getErrorCode(error: unknown): string | undefined {
  if (!isObjectLike(error)) {
    return undefined;
  }

  if (typeof error.code === 'string' && error.code) {
    return error.code.toLowerCase();
  }

  if (isObjectLike(error.error) && typeof error.error.code === 'string' && error.error.code) {
    return error.error.code.toLowerCase();
  }

  return undefined;
}

function messageIncludes(error: unknown, parts: string[]): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return parts.some((part) => message.includes(part));
}

export function isRateLimitError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  const errorCode = getErrorCode(error);

  return (
    statusCode === 429 ||
    errorCode === 'rate_limit_exceeded' ||
    messageIncludes(error, ['rate limit', 'too many requests'])
  );
}

export function isAuthError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  const errorCode = getErrorCode(error);

  return (
    statusCode === 401 ||
    statusCode === 403 ||
    errorCode === 'invalid_api_key' ||
    errorCode === 'authentication_error' ||
    messageIncludes(error, [
      'invalid api key',
      'incorrect api key',
      'expired api key',
      'unauthorized',
      'forbidden',
      'authentication',
      'invalid token',
    ])
  );
}

export function isQuotaError(error: unknown): boolean {
  const errorCode = getErrorCode(error);

  return (
    errorCode === 'insufficient_quota' ||
    messageIncludes(error, [
      'insufficient quota',
      'quota exceeded',
      'quota',
      'credit balance',
      'insufficient credits',
      'billing',
      'exhausted',
    ])
  );
}

export function isRetryableError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  const errorCode = getErrorCode(error);

  return (
    isRateLimitError(error) ||
    statusCode === 408 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    (isObjectLike(error) && error.name === 'AbortError') ||
    errorCode === 'etimedout' ||
    errorCode === 'econnreset' ||
    errorCode === 'eai_again' ||
    errorCode === 'fetch_failed' ||
    messageIncludes(error, [
      'timeout',
      'timed out',
      'overloaded',
      'service unavailable',
      'temporarily unavailable',
      'gateway timeout',
      'connection reset',
      'socket hang up',
      'network error',
      'fetch failed',
    ])
  );
}

export function shouldRotateApiKey(error: unknown): boolean {
  return isAuthError(error) || isQuotaError(error) || isRetryableError(error);
}

export function normalizeFailure(
  error: unknown,
  fallbackMessage = 'Unknown error',
  fallbackStatusCode = 500
): { message: string; statusCode: number } {
  const message = getErrorMessage(error) || fallbackMessage;
  const statusCode = getErrorStatusCode(error) ?? fallbackStatusCode;

  return {
    message,
    statusCode,
  };
}
