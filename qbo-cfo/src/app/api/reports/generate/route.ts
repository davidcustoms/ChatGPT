import { z } from 'zod';
import { companyIdSchema, handler, parseBody, periodSchema } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { runMonthlyForCompany } from '@/lib/jobs/monthly';
import { generateMonthlyReport } from '@/lib/reports/generate';
import { lastClosedMonth, monthPeriodOf } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  companyId: companyIdSchema,
  period: periodSchema.optional(),
  /** When true, re-syncs the month from QuickBooks before generating. */
  sync: z.boolean().default(false),
  skipAi: z.boolean().default(false),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const period = body.period ? monthPeriodOf(`${body.period}-01`) : lastClosedMonth();

    if (body.sync && !company.isDemo) {
      const run = await runMonthlyForCompany({
        companyId: company.id,
        period,
        requestedBy: user.id,
      });
      return { ok: run.status !== 'failed', ...run };
    }

    const { reportId, warning } = await generateMonthlyReport({
      companyId: company.id,
      period,
      requestedBy: user.id,
      generatedBy: 'manual',
      skipAi: body.skipAi,
    });
    return { ok: true, reportId, period: period.start, warning };
  });
}
