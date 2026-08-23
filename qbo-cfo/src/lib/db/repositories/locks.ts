import { randomToken } from '../../crypto';
import { query, queryOne } from '../pool';
import { logger } from '../../logger';

/**
 * Cross-process sync locking.
 *
 * Without this, a scheduled run and a manual refresh can import the same
 * company-month simultaneously. Upserts make that safe for stored rows, but it
 * doubles the QuickBooks API cost and can interleave a partial sync with a
 * report build. Locks carry an expiry so a crashed process cannot block a
 * company permanently.
 */

const DEFAULT_TTL_SECONDS = 900;

export interface SyncLock {
  companyId: string;
  lockKey: string;
  ownerToken: string;
  expiresAt: string;
}

/** Attempts to take a lock. Returns null when another process already holds it. */
export async function acquireLock(
  companyId: string,
  lockKey: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<SyncLock | null> {
  const ownerToken = randomToken(16);
  const row = await queryOne<{ owner_token: string; expires_at: Date }>(
    `INSERT INTO sync_locks (company_id, lock_key, owner_token, acquired_at, expires_at)
     VALUES ($1, $2, $3, now(), now() + ($4 || ' seconds')::interval)
     ON CONFLICT (company_id, lock_key) DO UPDATE
       SET owner_token = EXCLUDED.owner_token,
           acquired_at = now(),
           expires_at  = EXCLUDED.expires_at
       -- Only steal a lock that has already expired.
       WHERE sync_locks.expires_at < now()
     RETURNING owner_token, expires_at`,
    [companyId, lockKey, ownerToken, String(ttlSeconds)],
  );
  if (!row) return null;
  return {
    companyId,
    lockKey,
    ownerToken: row.owner_token,
    expiresAt: row.expires_at.toISOString(),
  };
}

/** Releases a lock, but only if this process still owns it. */
export async function releaseLock(lock: SyncLock): Promise<void> {
  await query('DELETE FROM sync_locks WHERE company_id = $1 AND lock_key = $2 AND owner_token = $3', [
    lock.companyId,
    lock.lockKey,
    lock.ownerToken,
  ]);
}

/** Extends a long-running lock so a slow but healthy sync is not stolen. */
export async function renewLock(lock: SyncLock, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `UPDATE sync_locks SET expires_at = now() + ($4 || ' seconds')::interval
      WHERE company_id = $1 AND lock_key = $2 AND owner_token = $3
      RETURNING TRUE AS ok`,
    [lock.companyId, lock.lockKey, lock.ownerToken, String(ttlSeconds)],
  );
  return Boolean(row?.ok);
}

/**
 * Runs `fn` while holding the lock. Returns `{ skipped: true }` without running
 * when another process holds it, so a duplicate scheduler firing is a no-op
 * rather than a second import.
 */
export async function withLock<T>(
  companyId: string,
  lockKey: string,
  fn: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<{ skipped: true } | { skipped: false; result: T }> {
  const lock = await acquireLock(companyId, lockKey, ttlSeconds);
  if (!lock) {
    logger.warn('sync lock already held, skipping', { companyId, lockKey });
    return { skipped: true };
  }
  try {
    return { skipped: false, result: await fn() };
  } finally {
    await releaseLock(lock).catch(() => undefined);
  }
}

export async function purgeExpiredLocks(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (DELETE FROM sync_locks WHERE expires_at < now() - interval '1 hour' RETURNING 1)
     SELECT COUNT(*)::text AS count FROM deleted`,
  );
  return Number(rows[0]?.count ?? 0);
}
