import { z } from 'zod';
import { handler, parseBody, periodSchema, companyIdSchema } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/db/repositories/audit';
import { runLiveValidation } from '@/lib/validation/run';
import { monthPeriodOf } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';
// A full run imports history, generates a report, renders both exports and
// re-syncs. It is slow by nature and must not be cut off half way.
export const maxDuration = 800;

const schema = z.object({
  companyId: companyIdSchema,
  period: periodSchema.optional(),
  historyMonths: z.number().int().min(2).max(36).optional(),
  skipImport: z.boolean().optional(),
});

/**
 * Runs the live production validation.
 *
 * Read-only against QuickBooks. The only writes are to this application's own
 * database, and only what an ordinary sync writes.
 */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);

    const run = await runLiveValidation({
      companyId: company.id,
      userId: user.id,
      ...(body.period ? { period: monthPeriodOf(`${body.period}-01`) } : {}),
      ...(body.historyMonths !== undefined ? { historyMonths: body.historyMonths } : {}),
      ...(body.skipImport !== undefined ? { skipImport: body.skipImport } : {}),
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'validation.live_qbo',
      outcome: run.productionReady ? 'success' : 'failure',
      metadata: {
        period: run.period?.start ?? null,
        productionReady: run.productionReady,
        blockers: run.blockers.length,
        confidenceScore: run.confidenceScore,
      },
    });

    return run as unknown as Record<string, unknown>;
  });
}
