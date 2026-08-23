import { z } from 'zod';
import { companyIdSchema, handler, parseBody, sanitizeText } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/db/repositories/audit';
import {
  approveMapping,
  createCategory,
  deleteMapping,
  listCategories,
  listMappings,
  upsertMappings,
} from '@/lib/db/repositories/mappings';
import { accountIndex } from '@/lib/db/repositories/masterdata';
import { listAllMetrics } from '@/lib/db/repositories/metrics';
import { recomputeMonth, resolveTrackingDimension } from '@/lib/qbo/sync';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  companyId: companyIdSchema,
  action: z.enum(['set', 'approve', 'delete', 'create-category', 'approve-all']),
  accountQboId: z.string().max(64).optional(),
  categoryKey: z.string().max(64).optional(),
  category: z
    .object({
      key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores.'),
      label: z.string().min(1).max(80),
      section: z.enum([
        'revenue', 'contra_revenue', 'cogs', 'opex', 'other_income', 'other_expense', 'ignore',
      ]),
    })
    .optional(),
  /** Recompute stored months so the change is reflected immediately. */
  recompute: z.boolean().default(true),
});

/**
 * Account mapping changes.
 *
 * A mapping change alters every derived metric, so stored months are
 * recomputed from their existing snapshots -- no QuickBooks call is needed.
 */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);

    switch (body.action) {
      case 'set': {
        if (!body.accountQboId || !body.categoryKey) {
          throw new AppError('VALIDATION', 'accountQboId and categoryKey are required.');
        }
        const accounts = await accountIndex(company.id);
        if (!accounts.has(body.accountQboId)) {
          throw new AppError('MAPPING_INVALID', 'That account does not exist in this company.');
        }
        const categories = await listCategories(company.id);
        if (!categories.some((c) => c.key === body.categoryKey)) {
          throw new AppError('MAPPING_INVALID', 'That management category does not exist.');
        }
        await upsertMappings(company.id, [
          {
            accountQboId: body.accountQboId,
            categoryKey: body.categoryKey,
            confidence: 1,
            source: 'manual',
            approved: true,
            approvedBy: user.id,
          },
        ]);
        break;
      }
      case 'approve': {
        if (!body.accountQboId) throw new AppError('VALIDATION', 'accountQboId is required.');
        await approveMapping(company.id, body.accountQboId, user.id);
        break;
      }
      case 'approve-all': {
        const pending = (await listMappings(company.id)).filter((m) => !m.approved);
        await upsertMappings(
          company.id,
          pending.map((m) => ({
            accountQboId: m.accountQboId,
            categoryKey: m.categoryKey,
            confidence: m.confidence,
            source: 'suggested' as const,
            approved: true,
            suggestedReason: m.suggestedReason,
            approvedBy: user.id,
          })),
        );
        break;
      }
      case 'delete': {
        if (!body.accountQboId) throw new AppError('VALIDATION', 'accountQboId is required.');
        await deleteMapping(company.id, body.accountQboId);
        break;
      }
      case 'create-category': {
        if (!body.category) throw new AppError('VALIDATION', 'category is required.');
        await createCategory(company.id, {
          key: body.category.key,
          label: sanitizeText(body.category.label, 80),
          section: body.category.section,
        });
        break;
      }
    }

    let recomputed = 0;
    if (body.recompute && body.action !== 'create-category') {
      const dimension = await resolveTrackingDimension(company.id, company.trackingDimension);
      const months = await listAllMetrics(company.id, 36);
      for (const m of months) {
        try {
          await recomputeMonth({ companyId: company.id, period: m.period, dimension });
          recomputed += 1;
        } catch (err) {
          logger.warn('recompute after mapping change failed', {
            period: m.period.start,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'settings.mapping_changed',
      entityType: 'account',
      entityId: body.accountQboId ?? null,
      metadata: { action: body.action, categoryKey: body.categoryKey, recomputed },
    });

    return { ok: true, recomputed };
  });
}
