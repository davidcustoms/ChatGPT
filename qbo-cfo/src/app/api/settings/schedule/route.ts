import { z } from 'zod';
import { companyIdSchema, handler, parseBody } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { saveSchedule } from '@/lib/db/repositories/companies';
import { recordAudit } from '@/lib/db/repositories/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  companyId: companyIdSchema,
  enabled: z.boolean().optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timezone: z.string().max(64).optional(),
  retentionMonths: z.number().int().min(12).max(120).optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    await saveSchedule(company.id, {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.dayOfMonth !== undefined ? { dayOfMonth: body.dayOfMonth } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      ...(body.retentionMonths !== undefined ? { retentionMonths: body.retentionMonths } : {}),
    });
    await recordAudit({ companyId: company.id, userId: user.id, action: 'settings.schedule_updated' });
    return { ok: true };
  });
}
