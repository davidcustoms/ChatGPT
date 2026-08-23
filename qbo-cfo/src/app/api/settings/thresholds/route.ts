import { z } from 'zod';
import { companyIdSchema, handler, parseBody } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { saveThreshold } from '@/lib/db/repositories/anomalies';
import { RULE_BY_KEY } from '@/lib/finance/anomaly-rules';
import { recordAudit } from '@/lib/db/repositories/audit';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const schema = z.object({
  companyId: companyIdSchema,
  ruleKey: z.string().min(1).max(64),
  enabled: z.boolean().optional(),
  params: z.record(z.string(), z.number().finite()).optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const rule = RULE_BY_KEY.get(body.ruleKey);
    if (!rule) throw new AppError('VALIDATION', `Unknown anomaly rule: ${body.ruleKey}`);

    // Only parameters the rule declares may be overridden.
    const params = body.params
      ? Object.fromEntries(Object.entries(body.params).filter(([k]) => k in rule.params))
      : undefined;

    await saveThreshold(company.id, body.ruleKey, {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(params ? { params } : {}),
    });
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'settings.threshold_updated',
      entityId: body.ruleKey,
      metadata: { enabled: body.enabled, params },
    });
    return { ok: true };
  });
}
