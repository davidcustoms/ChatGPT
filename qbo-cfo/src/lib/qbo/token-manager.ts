import { AppError } from '../errors';
import { logger } from '../logger';
import { event } from '../observability';
import {
  getConnectionForCompany,
  getTokens,
  recordRefreshFailure,
  saveRefreshedTokens,
  type Connection,
} from '../db/repositories/connections';
import { recordAudit } from '../db/repositories/audit';
import { refreshAccessToken } from './oauth';
import { QuickBooksClient } from './client';

/** Refresh when the access token has less than this long to live. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Returns a valid access token for a connection, refreshing it when needed.
 * A failed refresh marks the connection as errored so the UI can prompt the
 * owner to reconnect instead of the sync silently failing forever.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const tokens = await getTokens(connectionId);
  if (!tokens) {
    throw new AppError('QBO_NOT_CONNECTED', 'No QuickBooks tokens are stored for this connection.');
  }

  if (tokens.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }

  if (tokens.refreshTokenExpiresAt && tokens.refreshTokenExpiresAt.getTime() < Date.now()) {
    await recordRefreshFailure(connectionId, 'Refresh token expired');
    throw new AppError(
      'QBO_TOKEN_EXPIRED',
      'The QuickBooks refresh token has expired. Please reconnect QuickBooks.',
    );
  }

  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    await saveRefreshedTokens(connectionId, refreshed);
    await recordAudit({ action: 'quickbooks.token_refreshed', entityType: 'connection', entityId: connectionId });
    event('qbo.token_refreshed', { connectionId });
    return refreshed.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token refresh failed';
    event('qbo.token_refresh_failed', { connectionId, reason: message });
    await recordRefreshFailure(connectionId, message);
    await recordAudit({
      action: 'quickbooks.token_refresh_failed',
      entityType: 'connection',
      entityId: connectionId,
      outcome: 'failure',
      metadata: { message },
    });
    throw err instanceof AppError
      ? err
      : new AppError('QBO_TOKEN_EXPIRED', 'Could not refresh the QuickBooks token.', { cause: err });
  }
}

/** Builds a client bound to a company's active connection. */
export async function clientForCompany(
  companyId: string,
): Promise<{ client: QuickBooksClient; connection: Connection }> {
  const connection = await getConnectionForCompany(companyId);
  if (!connection) {
    throw new AppError('QBO_NOT_CONNECTED', 'QuickBooks is not connected for this company.');
  }
  const accessToken = await getValidAccessToken(connection.id);
  const client = new QuickBooksClient({
    realmId: connection.realmId,
    accessToken,
    environment: connection.environment,
    onUnauthorized: async () => {
      try {
        return await getValidAccessToken(connection.id);
      } catch {
        return null;
      }
    },
  });
  return { client, connection };
}
