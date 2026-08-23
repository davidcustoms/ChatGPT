import { z } from 'zod';
import { companyIdSchema, handler, parseBody, sanitizeText } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { getBranding, saveBranding } from '@/lib/db/repositories/companies';
import { recordAudit } from '@/lib/db/repositories/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  companyId: companyIdSchema,
  businessName: z.string().max(200).nullable().optional(),
  // Data URLs only: the logo is embedded, never fetched from a third party.
  logoDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a base64 image data URL.')
    .max(400_000)
    .nullable()
    .optional(),
  reportTitleTemplate: z.string().max(200).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #1e3a5f.').optional(),
  footerText: z.string().max(300).nullable().optional(),
  confidential: z.boolean().optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const existing = await getBranding(company.id);
    await saveBranding(company.id, {
      businessName:
        body.businessName === undefined
          ? existing.businessName
          : body.businessName && sanitizeText(body.businessName, 200),
      logoDataUrl: body.logoDataUrl === undefined ? existing.logoDataUrl : body.logoDataUrl,
      reportTitleTemplate: body.reportTitleTemplate
        ? sanitizeText(body.reportTitleTemplate, 200)
        : existing.reportTitleTemplate,
      primaryColor: body.primaryColor ?? existing.primaryColor,
      footerText:
        body.footerText === undefined ? existing.footerText : body.footerText && sanitizeText(body.footerText, 300),
      confidential: body.confidential ?? existing.confidential,
    });
    await recordAudit({ companyId: company.id, userId: user.id, action: 'settings.branding_updated' });
    return { ok: true };
  });
}
