import { intuitApiBaseUrl } from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';
import { event } from '../observability';

/**
 * Minimal, strictly read-only QuickBooks Online API client.
 *
 * Hard guarantees enforced here:
 *  - only GET requests are ever issued (`request()` has no method parameter);
 *  - mutating endpoints are rejected before the request is built;
 *  - 429/5xx responses are retried with exponential backoff + jitter and the
 *    Retry-After header is honoured.
 */

const MINOR_VERSION = '75';
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;

/** Endpoint fragments that would mutate the books. Blocked defensively. */
const FORBIDDEN_PATH = /\b(create|update|delete|void|batch|sparse|upload)\b/i;

export interface QboClientOptions {
  realmId: string;
  accessToken: string;
  environment: 'sandbox' | 'production';
  /** Injected by the sync layer so a 401 can trigger a refresh-and-retry. */
  onUnauthorized?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface QboReportParams {
  start_date?: string;
  end_date?: string;
  accounting_method?: 'Accrual' | 'Cash';
  summarize_column_by?: string;
  minorversion?: string;
  [key: string]: string | undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter avoids retry stampedes when several months sync in parallel.
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

export class QuickBooksClient {
  private accessToken: string;
  private readonly realmId: string;
  private readonly baseUrl: string;
  private readonly onUnauthorized?: () => Promise<string | null>;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: QboClientOptions) {
    this.realmId = opts.realmId;
    this.accessToken = opts.accessToken;
    this.baseUrl = intuitApiBaseUrl(opts.environment);
    this.onUnauthorized = opts.onUnauthorized;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleepImpl ?? defaultSleep;
  }

  private buildUrl(path: string, params: Record<string, string | undefined> = {}): string {
    const clean = path.replace(/^\/+/, '');
    if (FORBIDDEN_PATH.test(clean)) {
      throw new AppError(
        'FORBIDDEN',
        `Refusing to call a mutating QuickBooks endpoint: ${clean}. This application is read-only.`,
      );
    }
    const url = new URL(`${this.baseUrl}/v3/company/${this.realmId}/${clean}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    if (!url.searchParams.has('minorversion')) url.searchParams.set('minorversion', MINOR_VERSION);
    return url.toString();
  }

  /** Read-only GET with retry/backoff and one automatic token refresh. */
  async request<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = this.buildUrl(path, params);
    let refreshed = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.doFetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new AppError('QBO_TIMEOUT', `QuickBooks request timed out: ${path}`, { cause: err });
        }
        await this.sleep(backoffDelay(attempt, null));
        continue;
      }

      if (response.status === 401 && this.onUnauthorized && !refreshed) {
        refreshed = true;
        const newToken = await this.onUnauthorized();
        if (!newToken) {
          throw new AppError('QBO_TOKEN_EXPIRED', 'QuickBooks access token could not be refreshed.');
        }
        this.accessToken = newToken;
        continue;
      }

      if (response.status === 429) {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new AppError('QBO_RATE_LIMITED', 'QuickBooks rate limit exceeded. Try again shortly.');
        }
        const delay = backoffDelay(attempt, response.headers.get('Retry-After'));
        event('qbo.rate_limited', { path, attempt, delayMs: delay });
        await this.sleep(delay);
        continue;
      }

      if (response.status >= 500) {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new AppError('QBO_API_ERROR', `QuickBooks returned ${response.status} for ${path}.`);
        }
        await this.sleep(backoffDelay(attempt, response.headers.get('Retry-After')));
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const detail = extractIntuitError(text);
        event('qbo.api_failed', { path, status: String(response.status), reason: detail.slice(0, 200) });
        if (response.status === 400 && /report|unsupported/i.test(detail)) {
          throw new AppError('QBO_REPORT_UNAVAILABLE', `QuickBooks cannot produce this report: ${detail}`);
        }
        throw new AppError('QBO_API_ERROR', `QuickBooks error ${response.status}: ${detail}`, {
          details: { path, status: response.status },
        });
      }

      return (await response.json()) as T;
    }

    throw new AppError('QBO_API_ERROR', `QuickBooks request failed after ${MAX_ATTEMPTS} attempts: ${path}`);
  }

  /** Fetch a QuickBooks report by name (e.g. "ProfitAndLoss"). */
  async report<T>(name: string, params: QboReportParams = {}): Promise<T> {
    return this.request<T>(`reports/${name}`, params as Record<string, string | undefined>);
  }

  /**
   * Run a read-only SQL-like query. Only SELECT statements are permitted.
   * Results are paginated by the caller via STARTPOSITION/MAXRESULTS.
   */
  async query<T>(statement: string): Promise<T> {
    const trimmed = statement.trim();
    if (!/^select\s/i.test(trimmed)) {
      throw new AppError('FORBIDDEN', 'Only SELECT queries may be sent to QuickBooks.');
    }
    return this.request<T>('query', { query: trimmed });
  }

  /** Pages through a QBO entity query, returning every row. */
  async queryAll<T>(entity: string, where = '', pageSize = 200): Promise<T[]> {
    const out: T[] = [];
    let start = 1;
    for (let page = 0; page < 100; page += 1) {
      const statement = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ''} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
      const result = await this.query<{ QueryResponse?: Record<string, unknown> }>(statement);
      const rows = (result.QueryResponse?.[entity] as T[] | undefined) ?? [];
      out.push(...rows);
      if (rows.length < pageSize) break;
      start += pageSize;
    }
    return out;
  }
}

function extractIntuitError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> };
    };
    const first = parsed.Fault?.Error?.[0];
    if (first) return `${first.Message ?? 'Error'}${first.Detail ? ` - ${first.Detail}` : ''}`;
  } catch {
    /* fall through to the raw body */
  }
  return body.slice(0, 300) || 'unknown error';
}
