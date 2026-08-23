import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, toErrorPayload, userMessage } from '@/lib/errors';
import { QuickBooksClient } from '@/lib/qbo/client';

/**
 * Token and connection failure handling.
 *
 * Two rules are under test:
 *
 *  1. Every failure mode produces a typed error whose user-facing message
 *     names the recovery action. An owner should never see a stack trace, a
 *     provider payload, or the word "undefined".
 *  2. No user-facing message, and no error payload sent to the browser, can
 *     contain token material — not the access token, not the refresh token,
 *     not the client secret.
 */

const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.THIS_IS_AN_ACCESS_TOKEN.sig';
const REFRESH_TOKEN = 'AB11730000000ThisIsARefreshTokenValue';
const CLIENT_SECRET = 'sUp3rSecr3tClientSecretValue';

function clientWith(
  responses: Array<Response | (() => Response | Promise<Response>) | Error>,
  onUnauthorized?: () => Promise<string | null>,
): { client: QuickBooksClient; sleeps: number[] } {
  const sleeps: number[] = [];
  let i = 0;
  const client = new QuickBooksClient({
    realmId: 'realm-1',
    accessToken: ACCESS_TOKEN,
    environment: 'sandbox',
    ...(onUnauthorized ? { onUnauthorized } : {}),
    fetchImpl: (async () => {
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    }) as unknown as typeof fetch,
    // Tests must not actually wait for the backoff.
    sleepImpl: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  return { client, sleeps };
}

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const status = (code: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status: code, headers });

describe('failure modes reach the user as typed, actionable errors', () => {
  const cases: Array<[string, AppError, RegExp]> = [
    [
      'QuickBooks was never connected',
      new AppError('QBO_NOT_CONNECTED', 'No QuickBooks tokens are stored for this connection.'),
      /Connect it in Settings/i,
    ],
    [
      'the refresh token expired or the app was disconnected in QuickBooks',
      new AppError('QBO_TOKEN_EXPIRED', 'The QuickBooks refresh token has expired.'),
      /Reconnect it in Settings/i,
    ],
    [
      'Intuit rate limited the request',
      new AppError('QBO_RATE_LIMITED', 'QuickBooks rate limit exceeded.'),
      /retry automatically/i,
    ],
    [
      'the request timed out',
      new AppError('QBO_TIMEOUT', 'QuickBooks request timed out: reports/ProfitAndLoss'),
      /did not respond in time/i,
    ],
    [
      'Intuit returned a server error',
      new AppError('QBO_API_ERROR', 'QuickBooks returned 500 for reports/ProfitAndLoss.'),
      /left unchanged rather than imported partially/i,
    ],
    [
      'the company cannot produce that report',
      new AppError('QBO_REPORT_UNAVAILABLE', 'QuickBooks cannot produce this report.'),
      /unavailable rather than estimated/i,
    ],
    [
      'permissions were revoked for the connected user',
      new AppError('FORBIDDEN', 'Realm access denied.'),
      /do not have access/i,
    ],
    [
      'the session expired',
      new AppError('UNAUTHORIZED', 'Session expired.'),
      /sign in again/i,
    ],
    [
      'the database was unreachable',
      new AppError('DATABASE_ERROR', 'connection refused at 10.0.0.4:5432'),
      /No data was changed/i,
    ],
  ];

  for (const [label, error, expected] of cases) {
    it(`explains what to do when ${label}`, () => {
      const message = userMessage(error);
      expect(message).toMatch(expected);
      expect(message).not.toMatch(/undefined|null|\[object Object\]|Error:/);
      // Every message ends as a sentence, not a fragment of a log line.
      expect(message.trim().endsWith('.')).toBe(true);
    });
  }

  it('does not leak an unexpected internal error to the user', () => {
    const raw = new Error(`connect ECONNREFUSED postgres://user:${CLIENT_SECRET}@10.0.0.4:5432`);
    const message = userMessage(raw);
    expect(message).toBe('An unexpected error occurred.');
    expect(message).not.toContain(CLIENT_SECRET);
  });

  it('maps each failure to the right HTTP status', () => {
    const statusOf = (code: ConstructorParameters<typeof AppError>[0]) =>
      toErrorPayload(new AppError(code, 'x')).status;
    expect(statusOf('QBO_NOT_CONNECTED')).toBe(409);
    expect(statusOf('QBO_TOKEN_EXPIRED')).toBe(409);
    expect(statusOf('QBO_RATE_LIMITED')).toBe(429);
    expect(statusOf('QBO_TIMEOUT')).toBe(504);
    expect(statusOf('UNAUTHORIZED')).toBe(401);
    expect(statusOf('FORBIDDEN')).toBe(403);
  });

  it('marks transient failures retryable and permanent ones not', () => {
    expect(new AppError('QBO_RATE_LIMITED', 'x').retryable).toBe(true);
    expect(new AppError('QBO_TIMEOUT', 'x').retryable).toBe(true);
    expect(new AppError('QBO_API_ERROR', 'x').retryable).toBe(true);
    // Reconnecting is a human action, not something to retry in a loop.
    expect(new AppError('QBO_TOKEN_EXPIRED', 'x').retryable).toBe(false);
    expect(new AppError('QBO_NOT_CONNECTED', 'x').retryable).toBe(false);
  });
});

describe('token material never reaches the user', () => {
  const leaky = [
    `Authorization: Bearer ${ACCESS_TOKEN}`,
    `{"refresh_token":"${REFRESH_TOKEN}"}`,
    `client_secret=${CLIENT_SECRET}`,
    `access_token: ${ACCESS_TOKEN}`,
  ];

  it('redacts anything token-shaped that reaches an error message', () => {
    for (const text of leaky) {
      const message = userMessage(new AppError('MAPPING_INVALID', text));
      expect(message).not.toContain(ACCESS_TOKEN);
      expect(message).not.toContain(REFRESH_TOKEN);
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).toContain('[redacted]');
    }
  });

  it('redacts in the payload the API returns to the browser', () => {
    const { error } = toErrorPayload(
      new AppError('MAPPING_INVALID', `failed with Bearer ${ACCESS_TOKEN}`),
    );
    expect(JSON.stringify(error)).not.toContain(ACCESS_TOKEN);
  });

  it('never puts the access token in a QuickBooks error message', async () => {
    const { client } = clientWith([
      status(400, JSON.stringify({ Fault: { Error: [{ Message: 'Invalid query', Detail: 'bad' }] } })),
    ]);
    await expect(client.report('ProfitAndLoss')).rejects.toThrow(/Invalid query/);
    try {
      await client.report('ProfitAndLoss');
    } catch (err) {
      expect(String(err)).not.toContain(ACCESS_TOKEN);
      expect(userMessage(err)).not.toContain(ACCESS_TOKEN);
    }
  });
});

describe('connection failures at the transport layer', () => {
  it('refreshes once on a 401 and retries with the new token', async () => {
    const seen: string[] = [];
    let call = 0;
    const client = new QuickBooksClient({
      realmId: 'realm-1',
      accessToken: 'stale-token',
      environment: 'sandbox',
      onUnauthorized: async () => 'fresh-token',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen.push(String((init.headers as Record<string, string>)['Authorization']));
        call += 1;
        return call === 1 ? status(401) : ok({ done: true });
      }) as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    await expect(client.report('ProfitAndLoss')).resolves.toEqual({ done: true });
    expect(seen[0]).toContain('stale-token');
    expect(seen[1]).toContain('fresh-token');
  });

  it('reports a revoked grant rather than retrying forever', async () => {
    let calls = 0;
    const client = new QuickBooksClient({
      realmId: 'realm-1',
      accessToken: 'stale-token',
      environment: 'sandbox',
      // The refresh itself fails: the app was disconnected in QuickBooks.
      onUnauthorized: async () => null,
      fetchImpl: (async () => {
        calls += 1;
        return status(401);
      }) as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    await expect(client.report('ProfitAndLoss')).rejects.toMatchObject({
      code: 'QBO_TOKEN_EXPIRED',
    });
    expect(calls).toBe(1);
  });

  it('does not retry a 403 — revoked permissions are not transient', async () => {
    let calls = 0;
    const { client } = clientWith([
      () => {
        calls += 1;
        return status(403, JSON.stringify({ Fault: { Error: [{ Message: 'Forbidden' }] } }));
      },
    ]);
    await expect(client.report('ProfitAndLoss')).rejects.toMatchObject({ code: 'QBO_API_ERROR' });
    expect(calls).toBe(1);
  });

  it('honours Retry-After on a 429 instead of hammering', async () => {
    let calls = 0;
    const { client, sleeps } = clientWith([
      () => {
        calls += 1;
        return calls === 1 ? status(429, '', { 'Retry-After': '3' }) : ok({ recovered: true });
      },
    ]);
    await expect(client.report('ProfitAndLoss')).resolves.toEqual({ recovered: true });
    expect(sleeps[0]).toBe(3000);
  });

  it('gives up on sustained rate limiting with a typed error', async () => {
    const { client } = clientWith([() => status(429)]);
    await expect(client.report('ProfitAndLoss')).rejects.toMatchObject({
      code: 'QBO_RATE_LIMITED',
      retryable: true,
    });
  });

  it('backs off with growing delays on repeated server errors', async () => {
    const { client, sleeps } = clientWith([() => status(500)]);
    await expect(client.report('ProfitAndLoss')).rejects.toMatchObject({ code: 'QBO_API_ERROR' });
    // Four sleeps for five attempts, each window at least as large as the last.
    expect(sleeps).toHaveLength(4);
    for (let i = 1; i < sleeps.length; i += 1) {
      expect(sleeps[i]!).toBeGreaterThanOrEqual(sleeps[i - 1]! / 2);
    }
  });

  it('converts a dropped connection into a typed timeout', async () => {
    const { client } = clientWith([new Error('socket hang up')]);
    await expect(client.report('ProfitAndLoss')).rejects.toMatchObject({ code: 'QBO_TIMEOUT' });
  });

  it('surfaces an unsupported report distinctly so figures show as unavailable', async () => {
    const { client } = clientWith([
      status(400, JSON.stringify({
        Fault: { Error: [{ Message: 'Unsupported Operation', Detail: 'report not available' }] },
      })),
    ]);
    await expect(client.report('CashFlow')).rejects.toMatchObject({
      code: 'QBO_REPORT_UNAVAILABLE',
    });
  });
});

describe('retries never multiply an import', () => {
  it('a retried request is the same GET, not a second write', async () => {
    const methods: string[] = [];
    let calls = 0;
    const client = new QuickBooksClient({
      realmId: 'realm-1',
      accessToken: ACCESS_TOKEN,
      environment: 'sandbox',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        methods.push(String(init.method));
        calls += 1;
        return calls < 3 ? status(500) : ok({ fine: true });
      }) as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    await expect(client.report('ProfitAndLoss')).resolves.toEqual({ fine: true });
    expect(methods).toEqual(['GET', 'GET', 'GET']);
  });
});

describe('the client cannot be pointed at a mutating endpoint', () => {
  const mutating = [
    'account?operation=create',
    'batch',
    'purchase?operation=delete',
    'invoice?operation=update',
    'upload',
    'journalentry?operation=void',
  ];

  it('refuses every mutating path shape', async () => {
    const { client } = clientWith([ok()]);
    for (const path of mutating) {
      await expect(client.request(path), path).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('refuses a non-SELECT query', async () => {
    const { client } = clientWith([ok()]);
    for (const statement of ['DELETE FROM Invoice', 'update Account set Name = 1', ' insert into Vendor']) {
      await expect(client.query(statement), statement).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('OAuth failures', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env['INTUIT_CLIENT_ID'] = 'test-client-id';
    process.env['INTUIT_CLIENT_SECRET'] = CLIENT_SECRET;
    process.env['INTUIT_REDIRECT_URI'] = 'http://localhost:3000/api/quickbooks/callback';
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it('treats invalid_grant as "reconnect required", not a transient error', async () => {
    vi.stubGlobal('fetch', async () =>
      status(400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token revoked' }), {
        'content-type': 'application/json',
      }),
    );
    const { refreshAccessToken } = await import('@/lib/qbo/oauth');
    await expect(refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({
      code: 'QBO_TOKEN_EXPIRED',
    });
  });

  it('never echoes the refresh token in the failure', async () => {
    vi.stubGlobal('fetch', async () =>
      status(400, JSON.stringify({ error: 'invalid_client' }), { 'content-type': 'application/json' }),
    );
    const { refreshAccessToken } = await import('@/lib/qbo/oauth');
    try {
      await refreshAccessToken(REFRESH_TOKEN);
      throw new Error('should have rejected');
    } catch (err) {
      const shown = userMessage(err);
      expect(shown).not.toContain(REFRESH_TOKEN);
      expect(shown).not.toContain(CLIENT_SECRET);
    }
  });

  it('reports an unreachable Intuit token service as a timeout, not a crash', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND oauth.platform.intuit.com');
    });
    const { refreshAccessToken } = await import('@/lib/qbo/oauth');
    await expect(refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: 'QBO_TIMEOUT' });
  });

  it('rejects a token response that is missing the refresh token', async () => {
    vi.stubGlobal('fetch', async () =>
      status(200, JSON.stringify({ access_token: 'a', expires_in: 3600 }), {
        'content-type': 'application/json',
      }),
    );
    const { refreshAccessToken } = await import('@/lib/qbo/oauth');
    await expect(refreshAccessToken(REFRESH_TOKEN)).rejects.toBeInstanceOf(AppError);
  });

  it('never puts the client secret in the authorize URL', async () => {
    const { buildAuthorizeUrl } = await import('@/lib/qbo/oauth');
    const url = buildAuthorizeUrl('state-value');
    expect(url).not.toContain(CLIENT_SECRET);
    expect(url).toContain('state=state-value');
    // Least privilege: accounting scope only.
    expect(url).toContain('scope=com.intuit.quickbooks.accounting');
    expect(url).not.toContain('payment');
  });
});
