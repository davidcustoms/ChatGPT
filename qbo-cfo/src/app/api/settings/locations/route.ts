import { z } from 'zod';
import { companyIdSchema, handler, parseBody, sanitizeText } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { updateLocationSettings } from '@/lib/db/repositories/masterdata';
import { recordAudit } from '@/lib/db/repositories/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  companyId: companyIdSchema,
  qboId: z.string().min(1).max(64),
  displayName: z.string().max(120).nullable().optional(),
  isStore: z.boolean().optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    await updateLocationSettings(company.id, body.qboId, {
      displayName: body.displayName ? sanitizeText(body.displayName, 120) : body.displayName ?? null,
      ...(body.isStore !== undefined ? { isStore: body.isStore } : {}),
    });
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'settings.location_updated',
      entityId: body.qboId,
    });
    return { ok: true };
  });
}
