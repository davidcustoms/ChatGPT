'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSession, destroySession, requestContext } from '@/lib/auth/session';
import { recordAudit, recordAuthFailure, recentAuthFailureCount } from '@/lib/db/repositories/audit';
import { countUsers, createUser, verifyCredentials } from '@/lib/db/repositories/users';
import { logger } from '@/lib/logger';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const MAX_FAILURES_PER_WINDOW = 8;

export interface AuthState {
  error: string | null;
}

/** Sign in, or create the first owner account when the database is empty. */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }
  const { email, password } = parsed.data;
  const ctx = await requestContext();

  // Simple throttle on repeated failures for the same address.
  if ((await recentAuthFailureCount(email)) >= MAX_FAILURES_PER_WINDOW) {
    await recordAuthFailure({ email, reason: 'rate_limited', ...ctx, ipAddress: ctx.ip });
    return { error: 'Too many failed attempts. Wait a few minutes and try again.' };
  }

  const existingUsers = await countUsers();
  if (existingUsers === 0) {
    // Bootstrap: the first sign-in creates the owner account.
    const user = await createUser({ email, password, displayName: 'Owner', role: 'owner' });
    await createSession(user.id);
    await recordAudit({ userId: user.id, action: 'auth.owner_created', ipAddress: ctx.ip, userAgent: ctx.userAgent });
    logger.info('bootstrap owner created via login form', { email });
    redirect('/dashboard');
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    await recordAuthFailure({ email, reason: 'invalid_credentials', ipAddress: ctx.ip, userAgent: ctx.userAgent });
    await recordAudit({
      action: 'auth.login_failed',
      outcome: 'failure',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { email },
    });
    return { error: 'Email or password is incorrect.' };
  }

  await createSession(user.id);
  await recordAudit({
    userId: user.id,
    action: 'auth.login',
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
  });
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/login');
}
