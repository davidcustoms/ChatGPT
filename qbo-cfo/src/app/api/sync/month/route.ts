import { z } from 'zod';
import { companyIdSchema, handler, parseBody, periodSchema } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { syncSingleMonth } from '@/lib/qbo/sync';
import { lastClosedMonth, monthPeriodOf } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  companyId: companyIdSchema,
  period: periodSchema.optional(),
});

/** Refreshes a single reporting month from QuickBooks. */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const period = body.period ? monthPeriodOf(`${body.period}-01`) : lastClosedMonth();
    const result = await syncSingleMonth({
      companyId: company.id,
      period,
      requestedBy: user.id,
      triggeredBy: 'manual',
    });
    return { ok: true, period: period.start, ...result };
  });
}
