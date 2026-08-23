import { handler } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { getConnectionForCompany, getTokens } from '@/lib/db/repositories/connections';
import { latestJob } from '@/lib/db/repositories/jobs';
import { listReports } from '@/lib/db/repositories/reports';

export const dynamic = 'force-dynamic';

/** Connection status for the settings page and onboarding wizard. */
export async function GET(request: Request) {
  return handler(async () => {
    const url = new URL(request.url);
    const { company } = await requireCompany(url.searchParams.get('company'));
    const connection = await getConnectionForCompany(company.id);
    if (!connection) {
      return { connected: false, company: { id: company.id, name: company.name, isDemo: company.isDemo } };
    }
    const tokens = await getTokens(connection.id);
    const [job, reports] = await Promise.all([latestJob(company.id), listReports(company.id, 1)]);

    return {
      connected: connection.status === 'connected',
      company: { id: company.id, name: company.name, isDemo: company.isDemo },
      connection: {
        realmId: connection.realmId,
        environment: connection.environment,
        status: connection.status,
        companyName: connection.companyName,
        legalName: connection.legalName,
        country: connection.country,
        lastSyncAt: connection.lastSyncAt,
        lastReportAt: connection.lastReportAt,
        lastError: connection.lastError,
        connectedAt: connection.connectedAt,
      },
      token: tokens
        ? {
            // Never return token material -- only its lifecycle state.
            accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt?.toISOString() ?? null,
            refreshFailureCount: tokens.refreshFailureCount,
            healthy: tokens.accessTokenExpiresAt.getTime() > Date.now() || tokens.refreshFailureCount === 0,
          }
        : null,
      lastJob: job,
      lastReport: reports[0] ?? null,
    };
  });
}
