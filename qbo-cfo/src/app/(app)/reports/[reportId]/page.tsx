import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserPage } from '@/lib/auth/guards';
import { userCanAccessCompany } from '@/lib/db/repositories/companies';
import { getInsights, getReport } from '@/lib/db/repositories/reports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { ReportView } from '@/components/report/report-view';
import type { ReportPayload } from '@/lib/reports/types';

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

  const payload = report.payload as ReportPayload;
  // Insights are stored separately so they can be regenerated without rebuilding
  // the deterministic payload.
  const insights = await getInsights(reportId);
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
      <ReportView payload={merged} />
    </>
  );
}
