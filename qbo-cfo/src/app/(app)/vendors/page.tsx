import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { getVendorSpend, getVendorSpendRange } from '@/lib/db/repositories/metrics';
import { newVendorsInPeriod } from '@/lib/db/repositories/transactions';
import { pctChange, round2 } from '@/lib/finance/math';
import { monthLabel, priorMonth, yearToDate } from '@/lib/util/dates';
import { formatCurrency } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/metric';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';

export const dynamic = 'force-dynamic';

export default async function VendorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Vendors" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;
  const prior = priorMonth(period);
  const ytd = yearToDate(period, company.fiscalYearStartMonth);

  const [current, previous, ytdRows, newVendors] = await Promise.all([
    getVendorSpend(company.id, period),
    getVendorSpend(company.id, prior),
    getVendorSpendRange(company.id, ytd.start, period.start),
    newVendorsInPeriod(company.id, period),
  ]);

  const priorByName = new Map(previous.map((v) => [v.vendorName, v.amount]));
  const ytdByName = new Map<string, number>();
  for (const row of ytdRows) {
    ytdByName.set(row.vendorName, round2((ytdByName.get(row.vendorName) ?? 0) + row.amount));
  }
  const newNames = new Set(newVendors.map((v) => v.vendorName));

  const rows = current.slice(0, 20).map((v) => {
    const prev = priorByName.get(v.vendorName) ?? null;
    return {
      vendorName: v.vendorName,
      current: v.amount,
      previous: prev,
      changeAmount: prev === null ? null : round2(v.amount - prev),
      changePct: prev === null ? null : pctChange(v.amount, prev),
      ytd: ytdByName.get(v.vendorName) ?? v.amount,
      txnCount: v.txnCount,
      isNew: newNames.has(v.vendorName),
      flagged:
        prev !== null &&
        pctChange(v.amount, prev) !== null &&
        (pctChange(v.amount, prev) as number) >= 0.5 &&
        v.amount - prev >= company.materialityAmount,
    };
  });

  return (
    <>
      <PageHeader
        title="Vendor spending"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top 20 vendors — {monthLabel(period)}</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                title="No vendor transactions"
                description="No vendor transactions are stored for this period. Vendor analysis needs transaction-level data, which is imported with each month's sync."
              />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Vendor</TH>
                      <TH className="text-right">Current month</TH>
                      <TH className="text-right">Previous month</TH>
                      <TH className="text-right">Change</TH>
                      <TH className="text-right">% change</TH>
                      <TH className="text-right">Year to date</TH>
                      <TH className="text-right">Txns</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((v) => (
                      <TR key={v.vendorName}>
                        <TD className="max-w-[16rem] truncate font-medium">{v.vendorName}</TD>
                        <TD className="text-right tnum">
                          {formatCurrency(v.current, { currency: company.currencyCode })}
                        </TD>
                        <TD className="text-right tnum text-ink-muted">
                          {formatCurrency(v.previous, { currency: company.currencyCode })}
                        </TD>
                        <TD className="text-right">
                          <Delta value={v.changeAmount} format="currency" currency={company.currencyCode} invert />
                        </TD>
                        <TD className="text-right">
                          <Delta value={v.changePct} invert />
                        </TD>
                        <TD className="text-right tnum">
                          {formatCurrency(v.ytd, { currency: company.currencyCode })}
                        </TD>
                        <TD className="text-right tnum text-ink-muted">{v.txnCount}</TD>
                        <TD className="space-x-1 whitespace-nowrap">
                          {v.isNew ? <Badge variant="info">New</Badge> : null}
                          {v.flagged ? <Badge variant="warning">Unusual increase</Badge> : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <CategoryBarChart
                title="Spend by vendor"
                description={monthLabel(period)}
                data={rows.slice(0, 10).map((v) => ({ label: v.vendorName, value: v.current }))}
                valueLabel="Spend"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>New vendors this month</CardTitle>
            </CardHeader>
            <CardContent>
              {newVendors.length === 0 ? (
                <p className="text-sm text-ink-muted">No first-time vendors appeared in {monthLabel(period)}.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {newVendors.slice(0, 12).map((v) => (
                    <li key={v.vendorName} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{v.vendorName}</span>
                      <span className="tnum font-medium">
                        {formatCurrency(v.amount, { currency: company.currencyCode })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
