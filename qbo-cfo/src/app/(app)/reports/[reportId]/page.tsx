import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserPage } from '@/lib/auth/guards';
import { userCanAccessCompany } from '@/lib/db/repositories/companies';
import { getInsights, getReport } from '@/lib/db/repositories/reports';
import { listVersionSummaries } from '@/lib/db/repositories/report-versions';
import { checkReportStaleness } from '@/lib/reports/staleness';
import { formatDateTime } from '@/lib/util/format';
import { RegenerateBanner } from './regenerate-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { ReportView } from '@/components/report/report-view';
import type { ReportPayload } from '@/lib/reports/types';
import { normalizeReportPayload } from '@/lib/reports/migrate';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const user = await requireUserPage();
  const report = await getReport(reportId);
  if (!report) notFound();
  if (!(await userCanAccessCompany(user.id, report.companyId))) notFound();

  if (report.status !== 'completed' || !report.payload) {
    return (
      <>
        <PageHeader title={report.title} />
        {report.status === 'failed' ? (
          <ErrorNotice
            title="Report generation failed"
            message={report.errorMessage ?? 'The report could not be generated.'}
            action={
              <Button variant="outline" asChild>
                <Link href="/reports">Back to reports</Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
            <p className="text-sm text-ink">
              This report is <Badge variant="info">{report.status}</Badge>. Refresh in a moment.
            </p>
          </div>
        )}
      </>
    );
  }

  const payload = normalizeReportPayload(report.payload);
  // Insights are stored separately so they can be regenerated without rebuilding
  // the deterministic payload.
  const [insights, staleness, versions] = await Promise.all([
    getInsights(reportId),
    checkReportStaleness({ reportId, companyId: report.companyId, period: report.period }),
    listVersionSummaries(reportId),
  ]);
  const merged: ReportPayload = {
    ...payload,
    insights: insights.length > 0 ? insights : payload.insights,
    executiveSummary: report.executiveSummary ?? payload.executiveSummary,
  };

  return (
    <>
      <PageHeader
        title={report.title}
        description={
          <span className="text-sm text-ink-muted">
            {merged.companyName} · Data through {merged.dataThrough} · Source: {merged.sourceSystem}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/reports/${reportId}/pdf`}>Download PDF</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/reports/${reportId}/xlsx`}>Download Excel</a>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/reports">All reports</Link>
            </Button>
          </>
        }
      />
      {staleness?.stale ? (
        <RegenerateBanner
          companyId={report.companyId}
          period={report.period.start.slice(0, 7)}
          message={staleness.message ?? 'The underlying data has changed since this report was generated.'}
          generatedAt={staleness.generatedAt}
          version={staleness.version}
        />
      ) : null}

      {versions.length > 1 ? (
        <details className="mb-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-navy-800">
            Version history ({versions.length} versions)
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap gap-x-3 border-b border-border pb-1.5 last:border-0">
                <span className="font-medium text-ink">Version {v.version}</span>
                <span>{formatDateTime(v.generatedAt)}</span>
                <span>{v.generatedBy}</span>
                <span>{v.accountingMethod} basis</span>
                <span>score {v.confidenceScore ?? '—'}/100</span>
                <span>app {v.appVersion}</span>
                <span>prompt {v.aiPromptVersion}</span>
                <span>mapping v{v.mappingVersion ?? '—'}</span>
                <span className="font-mono">{v.sourceFingerprint.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ReportView payload={merged} />
    </>
  );
}
