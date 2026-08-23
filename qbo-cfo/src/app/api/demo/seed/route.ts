import { z } from 'zod';
import { handler, parseBody } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { seedDemoCompany } from '@/lib/demo/seed';
import { generateMonthlyReport } from '@/lib/reports/generate';
import { latestMetricsPeriod } from '@/lib/db/repositories/metrics';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  months: z.number().int().min(6).max(36).default(24),
  generateReport: z.boolean().default(true),
});

/** Creates the synthetic demo company so the product can be shown without QuickBooks. */
export async function POST(request: Request) {
  return handler(async () => {
    const user = await requireUser();
    if (!env().DEMO_MODE) {
      throw new AppError('FORBIDDEN', 'Demo mode is disabled. Set DEMO_MODE=true to enable it.');
    }
    const body = await parseBody(request, schema);
    const { companyId, months } = await seedDemoCompany({ userId: user.id, months: body.months });

    let reportId: string | null = null;
    if (body.generateReport) {
      const period = await latestMetricsPeriod(companyId);
      if (period) {
        const result = await generateMonthlyReport({
          companyId,
          period,
          requestedBy: user.id,
          generatedBy: 'manual',
        });
        reportId = result.reportId;
      }
    }

    return { ok: true, companyId, months, reportId };
  });
}
