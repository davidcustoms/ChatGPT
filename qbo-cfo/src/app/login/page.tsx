import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { countUsers } from '@/lib/db/repositories/users';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  let isFirstRun = false;
  let dbError: string | null = null;
  try {
    isFirstRun = (await countUsers()) === 0;
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Database unavailable';
  }

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-navy-500">
            QuickBooks Online
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-800">
            CFO Reporting Agent
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Read-only financial intelligence for multi-location retail.
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-sm">
          {dbError ? (
            <div className="rounded-md border border-negative/30 bg-negative-soft p-3 text-xs text-negative">
              <p className="font-semibold">Database unavailable</p>
              <p className="mt-1">
                {dbError}. Check DATABASE_URL and run <code>npm run db:migrate</code>.
              </p>
            </div>
          ) : (
            <LoginForm isFirstRun={isFirstRun} />
          )}
        </div>
        <p className="mt-5 text-center text-xs text-ink-subtle">
          This application never writes to QuickBooks. It reads accounting data only.
        </p>
      </div>
    </main>
  );
}
