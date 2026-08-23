import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { userCanAccessCompany } from '@/lib/db/repositories/companies';
import { getReport } from '@/lib/db/repositories/reports';
import { recordAudit } from '@/lib/db/repositories/audit';
import { AppError, toErrorPayload } from '@/lib/errors';
import { renderReportWorkbook } from '@/lib/reports/excel';
import type { ReportPayload } from '@/lib/reports/types';

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

    const buffer = await renderReportWorkbook(report.payload as ReportPayload);
    await recordAudit({
      companyId: report.companyId,
      userId: user.id,
      action: 'report.exported_xlsx',
      entityType: 'report',
      entityId: reportId,
    });

    const filename = `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const { error, status } = toErrorPayload(err);
    return NextResponse.json({ error }, { status });
  }
}
