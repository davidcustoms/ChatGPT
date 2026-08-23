import { z } from 'zod';
import { companyIdSchema, handler, parseBody } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { importHistory } from '@/lib/qbo/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  companyId: companyIdSchema,
  months: z.number().int().min(1).max(36).default(24),
});

/** Historical import (12/24/36 months, or a custom count up to 36). */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const result = await importHistory({
      companyId: company.id,
      months: body.months,
      requestedBy: user.id,
      triggeredBy: 'manual',
    });
    return { ok: true, ...result };
  });
}
