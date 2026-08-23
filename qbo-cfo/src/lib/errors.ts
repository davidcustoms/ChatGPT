import { redact } from './crypto';

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

/**
 * Human-readable, action-oriented message for the UI.
 *
 * Every code has an explicit sentence written for an owner, not a developer.
 * Two rules hold for all of them:
 *  - no raw provider payload, stack trace or token material ever reaches the
 *    screen (the final `redact` pass is the backstop, not the plan);
 *  - the message names the next action, so a failure is never a dead end.
 */
export function userMessage(err: unknown): string {
  return redact(rawUserMessage(err));
}

function rawUserMessage(err: unknown): string {
  if (err instanceof AppError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        return 'Please sign in again to continue.';
      case 'FORBIDDEN':
        return 'You do not have access to that company.';
      case 'QBO_NOT_CONNECTED':
        return 'QuickBooks is not connected for this company. Connect it in Settings \u2192 QuickBooks.';
      case 'QBO_TOKEN_EXPIRED':
        return 'The QuickBooks connection has expired or was revoked. Reconnect it in Settings \u2192 QuickBooks. No accounting data was changed.';
      case 'QBO_RATE_LIMITED':
        return 'QuickBooks is rate limiting requests. The sync will retry automatically \u2014 no action is needed.';
      case 'QBO_TIMEOUT':
        return 'QuickBooks did not respond in time. The sync will retry; nothing was imported for the affected period.';
      case 'QBO_API_ERROR':
        return 'QuickBooks returned an error for this request. The affected period was left unchanged rather than imported partially. Try the sync again, and reconnect QuickBooks if it keeps failing.';
      case 'QBO_REPORT_UNAVAILABLE':
        return 'QuickBooks cannot produce that report for this company. The related figures are shown as unavailable rather than estimated.';
      case 'QBO_EMPTY_PERIOD':
        return 'QuickBooks reported no activity for that period, so there is nothing to import.';
      case 'PARTIAL_SYNC':
        return 'Some periods could not be imported. The months that succeeded are stored; open the sync history to see what failed and retry it.';
      case 'MAPPING_INVALID':
        return err.message;
      case 'AI_UNAVAILABLE':
        return 'AI analysis is not configured. Set OPENAI_API_KEY to enable CFO commentary. All figures remain available without it.';
      case 'AI_ERROR':
        return 'AI commentary could not be generated. The report\u2019s figures are unaffected and are shown without narrative.';
      case 'PDF_ERROR':
        return 'The PDF could not be produced. The report is still available on screen and as an Excel export.';
      case 'EXCEL_ERROR':
        return 'The Excel workbook could not be produced. The report is still available on screen and as a PDF.';
      case 'DATABASE_ERROR':
        return 'The application could not reach its database. No data was changed. Try again in a moment.';
      case 'INTERNAL':
        return 'An unexpected error occurred. No accounting data was changed.';
      default:
        return err.message;
    }
  }
  // An unexpected throw could carry anything \u2014 a driver message, a URL with
  // credentials in it. Never surface it.
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
