import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { userCanAccessCompany } from '@/lib/db/repositories/companies';
import { getReport } from '@/lib/db/repositories/reports';
import { listVersionSummaries } from '@/lib/db/repositories/report-versions';
import { getMappingVersion } from '@/lib/db/repositories/mapping-versions';
import { checkReportStaleness } from '@/lib/reports/staleness';
import { AppError, toErrorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Version history for one report, plus whether the current head still reflects
 * what QuickBooks holds.
 */
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

    const [versions, staleness] = await Promise.all([
      listVersionSummaries(reportId),
      checkReportStaleness({
        reportId,
        companyId: report.companyId,
        period: report.period,
      }),
    ]);

    const mappingVersions = await Promise.all(
      Array.from(new Set(versions.map((v) => v.mappingVersionId).filter(Boolean) as string[])).map(
        (id) => getMappingVersion(id),
      ),
    );
    const mappingByid = new Map(mappingVersions.filter(Boolean).map((m) => [m!.id, m!]));

    return NextResponse.json({
      reportId,
      period: report.period,
      currentVersion: versions[0]?.version ?? 0,
      staleness,
      versions: versions.map((v) => ({
        version: v.version,
        generatedAt: v.generatedAt,
        generatedBy: v.generatedBy,
        accountingMethod: v.accountingMethod,
        confidence: v.confidence,
        confidenceScore: v.confidenceScore,
        appVersion: v.appVersion,
        aiPromptVersion: v.aiPromptVersion,
        aiModel: v.aiModel,
        mappingVersion: v.mappingVersion,
        mappingAccountsCovered: v.mappingVersionId
          ? (mappingByid.get(v.mappingVersionId)?.mappedCount ?? null)
          : null,
        sourceFingerprint: v.sourceFingerprint.slice(0, 12),
        sourceSnapshotCount: v.sourceSnapshotIds.length,
      })),
    });
  } catch (err) {
    const { error, status } = toErrorPayload(err);
    return NextResponse.json({ error }, { status });
  }
}
