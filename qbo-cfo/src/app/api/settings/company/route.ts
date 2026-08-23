import { z } from 'zod';
import { companyIdSchema, handler, parseBody, sanitizeText } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { updateCompanySettings } from '@/lib/db/repositories/companies';
import { recordAudit } from '@/lib/db/repositories/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  companyId: companyIdSchema,
  name: z.string().min(1).max(200).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  currencyCode: z.string().length(3).optional(),
  trackingDimension: z.enum(['auto', 'location', 'class', 'none']).optional(),
  materialityAmount: z.number().min(0).max(10_000_000).optional(),
  materialityPct: z.number().min(0).max(1).optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    await updateCompanySettings(company.id, {
      ...(body.name ? { name: sanitizeText(body.name, 200) } : {}),
      ...(body.fiscalYearStartMonth ? { fiscalYearStartMonth: body.fiscalYearStartMonth } : {}),
      ...(body.currencyCode ? { currencyCode: body.currencyCode.toUpperCase() } : {}),
      ...(body.trackingDimension ? { trackingDimension: body.trackingDimension } : {}),
      ...(body.materialityAmount !== undefined ? { materialityAmount: body.materialityAmount } : {}),
      ...(body.materialityPct !== undefined ? { materialityPct: body.materialityPct } : {}),
    });
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'settings.company_updated',
      metadata: { fields: Object.keys(body).filter((k) => k !== 'companyId') },
    });
    return { ok: true };
  });
}
