import { Pool, types as pgTypes, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';

/**
 * A single pooled Postgres connection reused across hot reloads in dev.
 * `pg` returns NUMERIC as string by default to avoid float precision loss;
 * we parse those explicitly at the repository boundary instead of globally,
 * so nothing silently becomes an imprecise float.
 */

/**
 * DATE columns must never become JS `Date` objects.
 *
 * By default `pg` parses a DATE into a `Date` at **local** midnight. Read back
 * with `toISOString()` anywhere east of UTC, `2026-07-01` becomes
 * `2026-06-30` -- every reporting period would silently shift a day, and a
 * month boundary would shift the whole month. A report labelled "July" would
 * be June's numbers.
 *
 * A calendar date has no timezone. `period_start`, `period_end`, `txn_date`
 * and `as_of_date` are calendar dates, so they stay the strings Postgres
 * already formats them as, which is exactly the `YYYY-MM-DD` the rest of the
 * application works in (see `src/lib/util/dates.ts`).
 *
 * TIMESTAMPTZ is deliberately left alone: those are absolute instants and the
 * default `Date` parsing is correct for them.
 */
const DATE_OID = 1082;
// `pg`'s TypeId union does not name the date[] OID, so it is cast.
const DATE_ARRAY_OID = 1182 as Parameters<typeof pgTypes.setTypeParser>[0];

pgTypes.setTypeParser(DATE_OID, (value: string): string => value);
pgTypes.setTypeParser(DATE_ARRAY_OID, (value: string): string[] =>
  value === '{}'
    ? []
    : value
        .replace(/^\{|\}$/g, '')
        .split(',')
        .map((v) => v.replace(/^"|"$/g, '')),
);

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

/**
 * Renders a DATE column as `YYYY-MM-DD`.
 *
 * With the type parser above, DATE already arrives as that string and this is
 * a slice. The `Date` branch is a backstop for a value that reached us some
 * other way (a driver without the parser registered, a hand-built object in a
 * test): such a Date was constructed at **local** midnight, so its calendar
 * date is read with the local accessors, not the UTC ones. Using
 * `getUTCDate()` here is what produced the off-by-one this guards against.
 */
export function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}
