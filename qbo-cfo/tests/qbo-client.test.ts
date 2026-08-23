import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickBooksClient } from '@/lib/qbo/client';
import { refreshAccessToken, exchangeCodeForTokens, buildAuthorizeUrl } from '@/lib/qbo/oauth';
import { AppError } from '@/lib/errors';
import { resetEnvCache } from '@/lib/env';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const noSleep = () => Promise.resolve();

function client(fetchImpl: typeof fetch, onUnauthorized?: () => Promise<string | null>) {
  return new QuickBooksClient({
    realmId: '123',
    accessToken: 'initial-token',
    environment: 'sandbox',
    fetchImpl,
    sleepImpl: noSleep,
    ...(onUnauthorized ? { onUnauthorized } : {}),
  });
}

describe('read-only enforcement', () => {
  it('refuses to build a URL for a mutating endpoint', async () => {
    const spy = vi.fn();
    await expect(client(spy as unknown as typeof fetch).request('purchase?operation=create')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses batch and delete endpoints', async () => {
    const c = client(vi.fn() as unknown as typeof fetch);
    await expect(c.request('batch')).rejects.toBeInstanceOf(AppError);
    await expect(c.request('bill?operation=delete')).rejects.toBeInstanceOf(AppError);
  });

  it('only permits SELECT statements', async () => {
    const c = client(vi.fn() as unknown as typeof fetch);
    await expect(c.query('UPDATE Bill SET TotalAmt = 0')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.query('DELETE FROM Bill')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('issues GET requests only', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init);
      return jsonResponse({ ok: true });
    });
    await client(fetchImpl as unknown as typeof fetch).request('companyinfo/123');
    expect(seen[0]?.method).toBe('GET');
  });
});

describe('retry and rate limiting', () => {
  it('retries a 429 and succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
      return jsonResponse({ QueryResponse: { Account: [] } });
    });
    const result = await client(fetchImpl as unknown as typeof fetch).request('query');
    expect(result).toEqual({ QueryResponse: { Account: [] } });
    expect(calls).toBe(2);
  });

  it('gives up on persistent rate limiting with a typed error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    await expect(client(fetchImpl as unknown as typeof fetch).request('query')).rejects.toMatchObject({
      code: 'QBO_RATE_LIMITED',
    });
  });

  it('retries server errors', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? new Response('', { status: 503 }) : jsonResponse({ ok: true });
    });
    await client(fetchImpl as unknown as typeof fetch).request('reports/ProfitAndLoss');
    expect(calls).toBe(3);
  });

  it('surfaces the Intuit fault message on a 400', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ Fault: { Error: [{ Message: 'Invalid date', Detail: 'start_date is malformed' }] } }),
          { status: 400 },
        ),
    );
    await expect(client(fetchImpl as unknown as typeof fetch).request('reports/ProfitAndLoss')).rejects.toThrow(
      /Invalid date/,
    );
  });

  it('converts a network failure into a typed timeout error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    await expect(client(fetchImpl as unknown as typeof fetch).request('query')).rejects.toMatchObject({
      code: 'QBO_TIMEOUT',
    });
  });
});

describe('token refresh on 401', () => {
  it('refreshes once and retries with the new token', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)['Authorization'] as string;
      seen.push(auth);
      if (auth.endsWith('initial-token')) return new Response('', { status: 401 });
      return jsonResponse({ ok: true });
    });
    const onUnauthorized = vi.fn(async () => 'refreshed-token');
    const result = await client(fetchImpl as unknown as typeof fetch, onUnauthorized).request('companyinfo/123');
    expect(result).toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['Bearer initial-token', 'Bearer refreshed-token']);
  });

  it('does not loop when the refresh fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const onUnauthorized = vi.fn(async () => null);
    await expect(
      client(fetchImpl as unknown as typeof fetch, onUnauthorized).request('companyinfo/123'),
    ).rejects.toMatchObject({ code: 'QBO_TOKEN_EXPIRED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('pagination', () => {
  it('pages until a short page is returned', async () => {
    const page = (n: number) => ({ QueryResponse: { Account: Array.from({ length: n }, (_, i) => ({ Id: String(i) })) } });
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return jsonResponse(call === 1 ? page(200) : page(37));
    });
    const rows = await client(fetchImpl as unknown as typeof fetch).queryAll<{ Id: string }>('Account');
    expect(rows).toHaveLength(237);
    expect(call).toBe(2);
  });
});

describe('OAuth token handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetEnvCache();
    process.env['INTUIT_CLIENT_ID'] = 'test-client';
    process.env['INTUIT_CLIENT_SECRET'] = 'test-secret';
    process.env['INTUIT_REDIRECT_URI'] = 'http://localhost:3000/api/quickbooks/callback';
  });

  it('builds an authorize URL carrying the state and least-privilege scopes', () => {
    const url = new URL(buildAuthorizeUrl('state-value'));
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('response_type')).toBe('code');
    // Exactly one scope: nothing here reads an id_token or calls userinfo, so
    // openid/profile/email would ask for the owner's identity for no reason.
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(url.searchParams.get('scope')).not.toContain('payment');
    expect(url.searchParams.get('scope')).not.toContain('openid');
  });

  it('converts relative expiries into absolute instants', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
        token_type: 'bearer',
        scope: 'com.intuit.quickbooks.accounting',
      }),
    ) as unknown as typeof fetch;

    const before = Date.now();
    const tokens = await refreshAccessToken('old-refresh-token');
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.accessTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000 - 50);
    expect(tokens.refreshTokenExpiresAt?.getTime()).toBeGreaterThan(before + 8_726_000_000 - 50);
    globalThis.fetch = originalFetch;
  });

  it('reports an expired grant as a reconnect-required error', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'Token expired' }, { status: 400 }),
    ) as unknown as typeof fetch;

    await expect(refreshAccessToken('stale')).rejects.toMatchObject({ code: 'QBO_TOKEN_EXPIRED' });
    globalThis.fetch = originalFetch;
  });

  it('rejects a token response that is missing a token', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ access_token: 'only-access' })) as unknown as typeof fetch;
    await expect(exchangeCodeForTokens('code')).rejects.toBeInstanceOf(AppError);
    globalThis.fetch = originalFetch;
  });
});
