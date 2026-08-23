import { query, queryOne } from '../pool';
import { hashPassword, verifyPassword } from '../../crypto';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  last_login_at: Date | null;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
  role?: string;
}): Promise<PublicUser> {
  const rows = await query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, COALESCE($4, 'owner'))
     RETURNING *`,
    [
      input.email.toLowerCase().trim(),
      hashPassword(input.password),
      input.displayName ?? null,
      input.role ?? null,
    ],
  );
  return toPublicUser(rows[0] as UserRow);
}

export async function verifyCredentials(email: string, password: string): Promise<UserRow | null> {
  const user = await findUserByEmail(email);
  if (!user || !user.is_active) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

export async function markLogin(userId: string): Promise<void> {
  await query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [userId]);
}

export async function countUsers(): Promise<number> {
  const row = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  return Number(row?.count ?? 0);
}
