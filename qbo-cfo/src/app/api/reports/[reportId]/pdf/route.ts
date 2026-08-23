import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { userCanAccessCompany, getBranding } from '@/lib/db/repositories/companies';
import { getReport } from '@/lib/db/repositories/reports';
import { recordAudit } from '@/lib/db/repositories/audit';
import { AppError, toErrorPayload } from '@/lib/errors';
import { renderReportPdf } from '@/lib/reports/pdf';
import { normalizeReportPayload } from '@/lib/reports/migrate';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(
  _request: Request,
  context: { params: Promise<{ reportId: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { reportId } = await context.params;
    const report = await getReport(reportId);
    if (!report) throw new AppError('NOT_FOUND', 'Report not found.');
    if (!(await userCanAccessCompany(user.id, report.companyId))) {
      throw new AppError('FORBIDDEN', 'You do not have access to this report.');
    }
    if (report.status !== 'completed' || !report.payload) {
      throw new AppError('VALIDATION', 'This report has not finished generating yet.');
    }

    const branding = await getBranding(report.companyId);
    const buffer = await renderReportPdf(normalizeReportPayload(report.payload), branding);

    await recordAudit({
      companyId: report.companyId,
      userId: user.id,
      action: 'report.exported_pdf',
      entityType: 'report',
      entityId: reportId,
    });

    const filename = `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const { error, status } = toErrorPayload(err);
    return NextResponse.json({ error }, { status });
  }
}
