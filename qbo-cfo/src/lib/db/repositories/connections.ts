import { query, queryOne, withTransaction } from '../pool';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../../crypto';
import type { IntuitTokenResponse } from '../../qbo/oauth';

export interface ConnectionRow {
  id: string;
  company_id: string;
  realm_id: string;
  environment: 'sandbox' | 'production';
  status: 'connected' | 'disconnected' | 'error' | 'revoked';
  qbo_company_name: string | null;
  qbo_legal_name: string | null;
  qbo_country: string | null;
  qbo_fiscal_year_start_month: number | null;
  last_error: string | null;
  last_sync_at: Date | null;
  last_report_at: Date | null;
  connected_at: Date;
  disconnected_at: Date | null;
}

export interface Connection {
  id: string;
  companyId: string;
  realmId: string;
  environment: 'sandbox' | 'production';
  status: ConnectionRow['status'];
  companyName: string | null;
  legalName: string | null;
  country: string | null;
  fiscalYearStartMonth: number | null;
  lastError: string | null;
  lastSyncAt: string | null;
  lastReportAt: string | null;
  connectedAt: string;
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    companyId: row.company_id,
    realmId: row.realm_id,
    environment: row.environment,
    status: row.status,
    companyName: row.qbo_company_name,
    legalName: row.qbo_legal_name,
    country: row.qbo_country,
    fiscalYearStartMonth: row.qbo_fiscal_year_start_month,
    lastError: row.last_error,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastReportAt: row.last_report_at?.toISOString() ?? null,
    connectedAt: row.connected_at.toISOString(),
  };
}

export async function getConnectionForCompany(companyId: string): Promise<Connection | null> {
  const row = await queryOne<ConnectionRow>(
    `SELECT * FROM quickbooks_connections
      WHERE company_id = $1 AND status <> 'disconnected'
      ORDER BY connected_at DESC LIMIT 1`,
    [companyId],
  );
  return row ? toConnection(row) : null;
}

export async function listConnections(companyId: string): Promise<Connection[]> {
  const rows = await query<ConnectionRow>(
    'SELECT * FROM quickbooks_connections WHERE company_id = $1 ORDER BY connected_at DESC',
    [companyId],
  );
  return rows.map(toConnection);
}

/** Creates (or reconnects) a company↔realm connection and stores its tokens. */
export async function upsertConnectionWithTokens(input: {
  companyId: string;
  realmId: string;
  environment: 'sandbox' | 'production';
  tokens: IntuitTokenResponse;
}): Promise<Connection> {
  return withTransaction(async (client) => {
    const conn = await client.query<ConnectionRow>(
      `INSERT INTO quickbooks_connections (company_id, realm_id, environment, status, connected_at)
       VALUES ($1,$2,$3,'connected', now())
       ON CONFLICT (company_id, realm_id) DO UPDATE SET
         status = 'connected',
         environment = EXCLUDED.environment,
         last_error = NULL,
         disconnected_at = NULL,
         connected_at = now(),
         updated_at = now()
       RETURNING *`,
      [input.companyId, input.realmId, input.environment],
    );
    const row = conn.rows[0] as ConnectionRow;
    await client.query(
      `INSERT INTO oauth_tokens
         (connection_id, access_token_encrypted, refresh_token_encrypted,
          access_token_expires_at, refresh_token_expires_at, token_type, scopes, last_refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (connection_id) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
         token_type = EXCLUDED.token_type,
         scopes = EXCLUDED.scopes,
         refresh_failure_count = 0,
         last_refreshed_at = now(),
         updated_at = now()`,
      [
        row.id,
        encryptSecret(input.tokens.accessToken),
        encryptSecret(input.tokens.refreshToken),
        input.tokens.accessTokenExpiresAt,
        input.tokens.refreshTokenExpiresAt,
        input.tokens.tokenType,
        input.tokens.scopes,
      ],
    );
    return toConnection(row);
  });
}

export interface StoredTokens {
  connectionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  refreshFailureCount: number;
}

export async function getTokens(connectionId: string): Promise<StoredTokens | null> {
  const row = await queryOne<{
    connection_id: string;
    access_token_encrypted: string;
    refresh_token_encrypted: string;
    access_token_expires_at: Date;
    refresh_token_expires_at: Date | null;
    refresh_failure_count: number;
  }>('SELECT * FROM oauth_tokens WHERE connection_id = $1', [connectionId]);
  if (!row) return null;
  return {
    connectionId: row.connection_id,
    accessToken: decryptSecret(row.access_token_encrypted),
    refreshToken: decryptSecret(row.refresh_token_encrypted),
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
    refreshFailureCount: row.refresh_failure_count,
  };
}

export async function saveRefreshedTokens(
  connectionId: string,
  tokens: IntuitTokenResponse,
): Promise<void> {
  await query(
    `UPDATE oauth_tokens SET
       access_token_encrypted = $2,
       refresh_token_encrypted = $3,
       access_token_expires_at = $4,
       refresh_token_expires_at = $5,
       refresh_failure_count = 0,
       last_refreshed_at = now(),
       updated_at = now()
     WHERE connection_id = $1`,
    [
      connectionId,
      encryptSecret(tokens.accessToken),
      encryptSecret(tokens.refreshToken),
      tokens.accessTokenExpiresAt,
      tokens.refreshTokenExpiresAt,
    ],
  );
}

export async function recordRefreshFailure(connectionId: string, message: string): Promise<void> {
  await query(
    `UPDATE oauth_tokens SET refresh_failure_count = refresh_failure_count + 1, updated_at = now()
      WHERE connection_id = $1`,
    [connectionId],
  );
  await query(
    `UPDATE quickbooks_connections SET status = 'error', last_error = $2, updated_at = now()
      WHERE id = $1`,
    [connectionId, message.slice(0, 500)],
  );
}

export async function updateConnectionCompanyInfo(
  connectionId: string,
  info: {
    companyName?: string | null;
    legalName?: string | null;
    country?: string | null;
    fiscalYearStartMonth?: number | null;
  },
): Promise<void> {
  await query(
    `UPDATE quickbooks_connections SET
       qbo_company_name = COALESCE($2, qbo_company_name),
       qbo_legal_name = COALESCE($3, qbo_legal_name),
       qbo_country = COALESCE($4, qbo_country),
       qbo_fiscal_year_start_month = COALESCE($5, qbo_fiscal_year_start_month),
       status = 'connected', last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [
      connectionId,
      info.companyName ?? null,
      info.legalName ?? null,
      info.country ?? null,
      info.fiscalYearStartMonth ?? null,
    ],
  );
}

export async function markSynced(connectionId: string): Promise<void> {
  await query(
    'UPDATE quickbooks_connections SET last_sync_at = now(), updated_at = now() WHERE id = $1',
    [connectionId],
  );
}

export async function markReported(companyId: string): Promise<void> {
  await query(
    'UPDATE quickbooks_connections SET last_report_at = now(), updated_at = now() WHERE company_id = $1',
    [companyId],
  );
}

export async function disconnect(connectionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM oauth_tokens WHERE connection_id = $1', [connectionId]);
    await client.query(
      `UPDATE quickbooks_connections
          SET status = 'disconnected', disconnected_at = now(), updated_at = now()
        WHERE id = $1`,
      [connectionId],
    );
  });
}

// --------------------------------------------------------------------------
// OAuth state (CSRF protection)
// --------------------------------------------------------------------------

export async function createOAuthState(input: {
  userId: string;
  companyId?: string | null;
  redirectTo?: string | null;
  ttlMinutes?: number;
}): Promise<string> {
  const state = randomToken(24);
  await query(
    `INSERT INTO oauth_states (state, user_id, company_id, redirect_to, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
    [
      sha256(state),
      input.userId,
      input.companyId ?? null,
      input.redirectTo ?? null,
      String(input.ttlMinutes ?? 15),
    ],
  );
  return state;
}

/** Single-use state consumption; returns null if invalid, expired or replayed. */
export async function consumeOAuthState(
  state: string,
): Promise<{ userId: string; companyId: string | null; redirectTo: string | null } | null> {
  const row = await queryOne<{ user_id: string; company_id: string | null; redirect_to: string | null }>(
    `UPDATE oauth_states SET consumed_at = now()
      WHERE state = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING user_id, company_id, redirect_to`,
    [sha256(state)],
  );
  if (!row) return null;
  return { userId: row.user_id, companyId: row.company_id, redirectTo: row.redirect_to };
}

export async function purgeExpiredOAuthStates(): Promise<void> {
  await query("DELETE FROM oauth_states WHERE expires_at < now() - interval '1 day'");
}
