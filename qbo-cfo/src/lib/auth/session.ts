import { cookies, headers } from 'next/headers';
import { randomToken, sha256 } from '../crypto';
import { query, queryOne } from '../db/pool';
import { findUserById, markLogin, toPublicUser, type PublicUser } from '../db/repositories/users';
import { AppError } from '../errors';

/**
 * Opaque, database-backed sessions.
 *
 * The cookie holds a random token; only its SHA-256 is stored, so a database
 * leak cannot be replayed as a login. Cookies are HttpOnly + SameSite=Lax and
 * Secure outside development.
 */

export const SESSION_COOKIE = 'qbo_cfo_session';
const SESSION_TTL_HOURS = 12;

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const hdrs = await headers();
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [
      userId,
      sha256(token),
      hdrs.get('user-agent')?.slice(0, 300) ?? null,
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      String(SESSION_TTL_HOURS),
    ],
  );
  await markLogin(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }
  store.delete(SESSION_COOKIE);
}

/** Returns the signed-in user, or null. Never throws for anonymous callers. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [sha256(token)],
  );
  if (!row) return null;
  const user = await findUserById(row.user_id);
  if (!user || !user.is_active) return null;
  return toPublicUser(user);
}

/** Route-handler guard: throws 401 rather than redirecting. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.');
  return user;
}

export async function purgeExpiredSessions(): Promise<void> {
  await query('DELETE FROM sessions WHERE expires_at < now()');
}

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const hdrs = await headers();
  return {
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent')?.slice(0, 300) ?? null,
  };
}
