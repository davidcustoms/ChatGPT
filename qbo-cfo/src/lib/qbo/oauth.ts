import {
  INTUIT_AUTHORIZE_URL,
  INTUIT_REVOKE_URL,
  INTUIT_SCOPES,
  INTUIT_TOKEN_URL,
  env,
  isQuickBooksConfigured,
} from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';

/**
 * Intuit OAuth 2.0 (authorization code grant).
 *
 * The client secret is used only here, server-side. `state` is generated and
 * validated against the database (see repositories/oauth.ts) so a callback
 * cannot be replayed or forged.
 */

export interface IntuitTokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry instants, computed from the relative values Intuit returns. */
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  tokenType: string;
  scopes: string[];
}

export function buildAuthorizeUrl(state: string): string {
  if (!isQuickBooksConfigured()) {
    throw new AppError(
      'QBO_NOT_CONNECTED',
      'QuickBooks is not configured. Set INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET and INTUIT_REDIRECT_URI.',
    );
  }
  const e = env();
  const url = new URL(INTUIT_AUTHORIZE_URL);
  url.searchParams.set('client_id', e.INTUIT_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INTUIT_SCOPES.join(' '));
  url.searchParams.set('redirect_uri', e.INTUIT_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

function basicAuthHeader(): string {
  const e = env();
  return `Basic ${Buffer.from(`${e.INTUIT_CLIENT_ID}:${e.INTUIT_CLIENT_SECRET}`).toString('base64')}`;
}

interface RawTokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<IntuitTokenResponse> {
  let response: Response;
  try {
    response = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new AppError('QBO_TIMEOUT', 'Could not reach the Intuit token service.', { cause: err });
  }

  const json = (await response.json().catch(() => ({}))) as RawTokenBody;

  if (!response.ok || !json.access_token || !json.refresh_token) {
    // Never log the raw body -- it may contain a token on partial failures.
    logger.warn('intuit token exchange failed', {
      status: response.status,
      error: json.error,
      description: json.error_description,
    });
    const expired = json.error === 'invalid_grant';
    throw new AppError(
      expired ? 'QBO_TOKEN_EXPIRED' : 'QBO_API_ERROR',
      expired
        ? 'The QuickBooks authorization has expired or been revoked. Please reconnect.'
        : `Intuit rejected the token request (${json.error ?? response.status}).`,
    );
  }

  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(now + (json.expires_in ?? 3600) * 1000),
    refreshTokenExpiresAt: json.x_refresh_token_expires_in
      ? new Date(now + json.x_refresh_token_expires_in * 1000)
      : null,
    tokenType: json.token_type ?? 'bearer',
    scopes: json.scope ? json.scope.split(' ') : INTUIT_SCOPES,
  };
}

export async function exchangeCodeForTokens(code: string): Promise<IntuitTokenResponse> {
  const e = env();
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: e.INTUIT_REDIRECT_URI,
    }),
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<IntuitTokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  );
}

/** Best-effort revoke on disconnect; failures are logged, never fatal. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(INTUIT_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch (err) {
    logger.warn('intuit token revoke failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
