import Link from 'next/link';
import { getPageContext, param, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { listReports } from '@/lib/db/repositories/reports';
import { getSchedule } from '@/lib/db/repositories/companies';
import { monthLabel, monthPeriodOf } from '@/lib/util/dates';
import { formatDateTime } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { NoDataState } from '@/components/layout/no-data';
import { GenerateReportPanel } from './generate-panel';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'positive' | 'warning' | 'negative' | 'info' | 'default'> = {
  completed: 'positive',
  failed: 'negative',
  pending: 'default',
  syncing: 'info',
  analyzing: 'info',
  generating: 'info',
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);

  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Reports" description="Monthly CFO reports, generated from stored QuickBooks data." />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const [reports, schedule] = await Promise.all([listReports(company.id, 36), getSchedule(company.id)]);
  const requestedPeriod = param(sp, 'period');
  const defaultPeriod = requestedPeriod ?? ctx.period.start.slice(0, 7);

  return (
    <>
      <PageHeader
        title="Reports"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Generate a report</CardTitle>
          </CardHeader>
          <CardContent>
            <GenerateReportPanel
              companyId={company.id}
              periods={ctx.availablePeriods}
              defaultPeriod={defaultPeriod}
              canSync={!company.isDemo}
            />
            <p className="mt-4 border-t border-border pt-3 text-xs text-ink-muted">
              Scheduled generation is {schedule.enabled ? 'on' : 'off'}
              {schedule.enabled ? `, running on day ${schedule.dayOfMonth} of each month` : ''}.{' '}
              <Link className="text-navy-700 underline-offset-2 hover:underline" href="/settings/report">
                Change schedule
              </Link>
              .
              {schedule.lastRunAt ? ` Last run ${formatDateTime(schedule.lastRunAt)} (${schedule.lastRunStatus}).` : ''}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Report history</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <EmptyState
                title="No reports yet"
                description="Generate your first monthly CFO report from the panel on the left."
              />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Period</TH>
                      <TH>Title</TH>
                      <TH>Status</TH>
                      <TH>Confidence</TH>
                      <TH>Generated</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {reports.map((r) => (
                      <TR key={r.id}>
                        <TD className="whitespace-nowrap">{monthLabel(monthPeriodOf(r.period.start))}</TD>
                        <TD className="max-w-[22rem] truncate">{r.title}</TD>
                        <TD>
                          <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
                        </TD>
                        <TD>{r.confidence ? <Badge variant="outline">{r.confidence}</Badge> : '—'}</TD>
                        <TD className="whitespace-nowrap text-xs text-ink-muted">
                          {formatDateTime(r.completedAt ?? r.createdAt)}
                          {r.generatedBy === 'scheduled' ? ' · scheduled' : ''}
                        </TD>
                        <TD className="text-right">
                          {r.status === 'completed' ? (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/reports/${r.id}`}>Open</Link>
                            </Button>
                          ) : r.status === 'failed' ? (
                            <span className="text-xs text-negative" title={r.errorMessage ?? undefined}>
                              {r.errorMessage?.slice(0, 60) ?? 'Failed'}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-muted">In progress</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
