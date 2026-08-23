/** Application error taxonomy. Every failure is typed so the UI can offer the
 *  right recovery action (reconnect, retry, fix mapping, contact support). */

export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'QBO_NOT_CONNECTED'
  | 'QBO_TOKEN_EXPIRED'
  | 'QBO_RATE_LIMITED'
  | 'QBO_TIMEOUT'
  | 'QBO_API_ERROR'
  | 'QBO_REPORT_UNAVAILABLE'
  | 'QBO_EMPTY_PERIOD'
  | 'MAPPING_INVALID'
  | 'DATABASE_ERROR'
  | 'AI_UNAVAILABLE'
  | 'AI_ERROR'
  | 'PDF_ERROR'
  | 'EXCEL_ERROR'
  | 'PARTIAL_SYNC'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    opts: { status?: number; retryable?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? defaultStatus(code);
    this.retryable = opts.retryable ?? defaultRetryable(code);
    this.details = opts.details;
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'MAPPING_INVALID':
      return 400;
    case 'QBO_RATE_LIMITED':
      return 429;
    case 'QBO_NOT_CONNECTED':
    case 'QBO_TOKEN_EXPIRED':
      return 409;
    case 'QBO_TIMEOUT':
      return 504;
    default:
      return 500;
  }
}

function defaultRetryable(code: AppErrorCode): boolean {
  return (
    code === 'QBO_RATE_LIMITED' ||
    code === 'QBO_TIMEOUT' ||
    code === 'QBO_API_ERROR' ||
    code === 'DATABASE_ERROR' ||
    code === 'AI_ERROR' ||
    code === 'PARTIAL_SYNC'
  );
}

/** Human-readable, action-oriented message for the UI. */
export function userMessage(err: unknown): string {
  if (err instanceof AppError) {
    switch (err.code) {
      case 'QBO_NOT_CONNECTED':
        return 'QuickBooks is not connected for this company. Connect it in Settings → QuickBooks.';
      case 'QBO_TOKEN_EXPIRED':
        return 'The QuickBooks connection has expired. Reconnect it in Settings → QuickBooks.';
      case 'QBO_RATE_LIMITED':
        return 'QuickBooks is rate limiting requests. The sync will retry automatically.';
      case 'AI_UNAVAILABLE':
        return 'AI analysis is not configured. Set OPENAI_API_KEY to enable CFO commentary.';
      default:
        return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

export function toErrorPayload(err: unknown): {
  error: { code: AppErrorCode; message: string; retryable: boolean; details?: unknown };
  status: number;
} {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: userMessage(err),
        retryable: err.retryable,
        details: err.details,
      },
      status: err.status,
    };
  }
  return {
    error: {
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
      retryable: false,
    },
    status: 500,
  };
}
