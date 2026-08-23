import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPool } from './pool';
import { hashPassword } from '../crypto';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Idempotent schema application. The schema file is written with
 * CREATE TABLE IF NOT EXISTS throughout, so re-running is safe.
 */
export async function runMigrations(schemaPath?: string): Promise<void> {
  const file = schemaPath ?? path.join(process.cwd(), 'db', 'schema.sql');
  const sql = await readFile(file, 'utf8');
  const client = await getPool().connect();
  try {
    await client.query(sql);
    logger.info('schema applied', { file });
  } finally {
    client.release();
  }
}

/** Creates the bootstrap owner account if the users table is empty. */
export async function ensureOwnerUser(): Promise<{ created: boolean; email: string }> {
  const e = env();
  const email = e.OWNER_EMAIL.toLowerCase().trim();
  const pool = getPool();
  const existing = await pool.query('SELECT id FROM users LIMIT 1');
  if (existing.rowCount && existing.rowCount > 0) {
    return { created: false, email };
  }
  if (!e.OWNER_PASSWORD) {
    throw new Error('OWNER_PASSWORD must be set to bootstrap the first owner account.');
  }
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (email) DO NOTHING`,
    [email, hashPassword(e.OWNER_PASSWORD), 'Owner'],
  );
  logger.info('bootstrap owner created', { email });
  return { created: true, email };
}
