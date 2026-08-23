import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';

/**
 * A single pooled Postgres connection reused across hot reloads in dev.
 * `pg` returns NUMERIC as string by default to avoid float precision loss;
 * we parse those explicitly at the repository boundary instead of globally,
 * so nothing silently becomes an imprecise float.
 */

declare global {
  // eslint-disable-next-line no-var
  var __qboCfoPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__qboCfoPool) {
    const connectionString = env().DATABASE_URL;
    globalThis.__qboCfoPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
    globalThis.__qboCfoPool.on('error', (err) => {
      logger.error('postgres pool error', { message: err.message });
    });
  }
  return globalThis.__qboCfoPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await getPool().query<T>(text, params as never[]);
    return result.rows;
  } catch (err) {
    logger.error('database query failed', {
      message: err instanceof Error ? err.message : String(err),
      sql: text.slice(0, 200),
    });
    throw new AppError('DATABASE_ERROR', 'A database error occurred.', { cause: err });
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback failures are already fatal for this transaction */
    }
    if (err instanceof AppError) throw err;
    logger.error('transaction failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw new AppError('DATABASE_ERROR', 'A database transaction failed.', { cause: err });
  } finally {
    client.release();
  }
}

/** NUMERIC columns arrive as strings; convert at the repository boundary. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Date columns come back as JS Date at UTC midnight; render as YYYY-MM-DD. */
export function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}
