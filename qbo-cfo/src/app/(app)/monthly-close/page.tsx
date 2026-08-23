import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { getConnectionForCompany } from '@/lib/db/repositories/connections';
import { countUnmappedExpenseAccounts } from '@/lib/db/repositories/mappings';
import { inventorySummary } from '@/lib/db/repositories/masterdata';
import { getAging, getAccountMetrics, getLocationMetrics, getMonthlyMetrics } from '@/lib/db/repositories/metrics';
import { duplicateCandidates, missingDimensionCount } from '@/lib/db/repositories/transactions';
import { listJobs } from '@/lib/db/repositories/jobs';
import { evaluateDataQuality } from '@/lib/finance/data-quality';
import { isUncategorizedAccount } from '@/lib/finance/transaction-review';
import { monthLabel } from '@/lib/util/dates';
import { formatCurrency, formatDateTime } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';

export const dynamic = 'force-dynamic';

const STATUS_BADGE = {
  pass: { variant: 'positive' as const, label: 'OK' },
  warn: { variant: 'warning' as const, label: 'Review' },
  fail: { variant: 'negative' as const, label: 'Blocking' },
};

export default async function MonthlyClosePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Monthly close" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;

  const [metrics, connection, unmappedCount, inventory, accountRows, arAging, apAging, stores, jobs] =
    await Promise.all([
      getMonthlyMetrics(company.id, period),
      getConnectionForCompany(company.id),
      countUnmappedExpenseAccounts(company.id),
      inventorySummary(company.id),
      getAccountMetrics(company.id, period),
      getAging(company.id, 'receivable', period.end),
      getAging(company.id, 'payable', period.end),
      getLocationMetrics(company.id, period),
      listJobs(company.id, 6),
    ]);

  const uncategorizedBalances = accountRows
    .filter((r) => isUncategorizedAccount(r.accountName) && Math.abs(r.amount) > 0)
    .map((r) => ({ accountName: r.accountName, amount: r.amount }));

  const [dimensionCoverage, duplicates] = await Promise.all([
    missingDimensionCount(company.id, period, 'location'),
    duplicateCandidates(company.id, period, company.materialityAmount),
  ]);

  const quality = evaluateDataQuality({
    period,
    metrics,
    expectedCompanyName: company.name,
    connectedCompanyName: connection?.companyName ?? null,
    unmappedExpenseAccountCount: unmappedCount,
    uncategorizedBalances,
    requireLocationData: stores.length > 0 || company.trackingDimension === 'location',
    locationRowCount: stores.length,
    negativeInventoryItems: inventory.negativeQtyItems,
    duplicateSnapshotCount: 0,
    oldReceivables90Plus: arAging?.total.days90Plus ?? null,
    oldPayables90Plus: apAging?.total.days90Plus ?? null,
    missingDimension: dimensionCoverage,
    unreconciledNote: company.isDemo
      ? null
      : 'QuickBooks does not expose bank-reconciliation status through its API. Confirm reconciliations directly in QuickBooks before treating this month as closed.',
  });

  const confidenceVariant =
    quality.confidence === 'high' ? 'positive' : quality.confidence === 'medium' ? 'warning' : 'negative';

  return (
    <>
      <PageHeader
        title={`Monthly close — ${monthLabel(period)}`}
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={
          <>
            <PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />
            <Button asChild variant="outline">
              <Link href={`/reports?company=${company.id}&period=${period.start.slice(0, 7)}`}>
                Generate report
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Report confidence</p>
            <p className="mt-1 text-2xl font-semibold text-navy-800">
              <Badge variant={confidenceVariant} className="px-3 py-1 text-sm">
                {quality.confidence.toUpperCase()}
              </Badge>
            </p>
          </div>
          <p className="max-w-xl text-xs text-ink-muted">
            Confidence reflects the cleanliness of the underlying bookkeeping, not the accuracy of the
            calculations. A blocking check means a report generated now would be incomplete.
          </p>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Close checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {quality.checks.map((c) => {
                const badge = STATUS_BADGE[c.status];
                return (
                  <li key={c.key} className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span className="text-sm font-medium text-ink">{c.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">{c.message}</p>
                    </div>
                    {c.action ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={c.action.href}>{c.action.label}</Link>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Possible duplicates</CardTitle>
            </CardHeader>
            <CardContent>
              {duplicates.length === 0 ? (
                <p className="text-sm text-ink-muted">No duplicate-looking transactions above the materiality threshold.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {duplicates.slice(0, 8).map((d, i) => (
                    <li key={i}>
                      <span className="font-medium">{d.entityName ?? 'Unknown payee'}</span> ×{d.count} at{' '}
                      <span className="tnum">{formatCurrency(d.amount, { currency: company.currencyCode })}</span>
                      <span className="block text-xs text-ink-muted">{d.dates.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent jobs</CardTitle>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <p className="text-sm text-ink-muted">No sync or report jobs have run yet.</p>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Job</TH>
                        <TH>Status</TH>
                        <TH>Finished</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {jobs.map((j) => (
                        <TR key={j.id}>
                          <TD className="text-xs">{j.jobType}</TD>
                          <TD>
                            <Badge
                              variant={
                                j.status === 'completed'
                                  ? 'positive'
                                  : j.status === 'failed'
                                    ? 'negative'
                                    : j.status === 'partial'
                                      ? 'warning'
                                      : 'info'
                              }
                            >
                              {j.status}
                            </Badge>
                          </TD>
                          <TD className="text-xs text-ink-muted">
                            {j.finishedAt ? formatDateTime(j.finishedAt) : 'running'}
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
      </div>
    </>
  );
}
