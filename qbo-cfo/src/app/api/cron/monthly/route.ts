import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { constantTimeEquals } from '@/lib/crypto';
import { runMonthlyForAllCompanies, runMonthlyForCompany } from '@/lib/jobs/monthly';
import { purgeExpiredSessions } from '@/lib/auth/session';
import { purgeExpiredOAuthStates } from '@/lib/db/repositories/connections';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/**
 * Scheduled monthly report generation.
 *
 * Protected by a shared secret rather than a user session, because it is
 * called by a scheduler (Vercel Cron, GitHub Actions, systemd timer, ...).
 */
function authorize(request: Request): void {
  const secret = env().CRON_SECRET;
  if (!secret) {
    throw new AppError('FORBIDDEN', 'CRON_SECRET is not configured; the scheduler endpoint is disabled.');
  }
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !constantTimeEquals(provided, secret)) {
    throw new AppError('UNAUTHORIZED', 'Invalid scheduler credentials.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handler(async () => {
    authorize(request);
    const url = new URL(request.url);
    const companyId = url.searchParams.get('company');
    const force = url.searchParams.get('force') === '1';

    await purgeExpiredSessions().catch(() => undefined);
    await purgeExpiredOAuthStates().catch(() => undefined);

    if (companyId) {
      const result = await runMonthlyForCompany({ companyId });
      return { ok: result.status !== 'failed', results: [result] };
    }

    const results = await runMonthlyForAllCompanies({ force });
    logger.info('monthly cron completed', {
      total: results.length,
      failed: results.filter((r) => r.status === 'failed').length,
    });
    return { ok: results.every((r) => r.status !== 'failed'), results };
  });
}

/** GET is supported so schedulers that only issue GET requests still work. */
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
