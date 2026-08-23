import Link from 'next/link';
import { getPageContext, param, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { categoryTotalsByPeriod, getAccountMetrics, getMonthlyMetrics } from '@/lib/db/repositories/metrics';
import { buildExpenseAnalysis } from '@/lib/finance/metrics';
import { CATEGORY_BY_KEY, categoryLabel } from '@/lib/finance/categories';
import { monthLabel, priorMonth, trailingMonths } from '@/lib/util/dates';
import { formatCurrency, formatPercent } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/metric';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { SERIES } from '@/components/charts/palette';
import { DrilldownPanel } from './drilldown-panel';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Expenses" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;
  const prior = priorMonth(period);
  const t12 = trailingMonths(period, 12);
  const selectedCategory = param(sp, 'category') ?? null;

  const [metrics, categoryRows, accountRows] = await Promise.all([
    getMonthlyMetrics(company.id, period),
    categoryTotalsByPeriod(company.id, t12[0]?.start ?? period.start, period.start),
    getAccountMetrics(company.id, period),
  ]);

  const byPeriod = new Map<string, Map<string, number>>();
  for (const row of categoryRows) {
    const bucket = byPeriod.get(row.periodStart) ?? new Map<string, number>();
    if (row.categoryKey) bucket.set(row.categoryKey, row.amount);
    byPeriod.set(row.periodStart, bucket);
  }

  const analysis = buildExpenseAnalysis({
    current: byPeriod.get(period.start) ?? new Map(),
    previous: byPeriod.get(prior.start) ?? null,
    trailing: t12.filter((p) => p.start !== period.start).map((p) => byPeriod.get(p.start) ?? new Map()),
    revenue: metrics?.netSales ?? 0,
    materialityAmount: company.materialityAmount,
    materialityPct: company.materialityPct,
  });

  const trendSeries = t12.map((p) => ({
    label: monthLabel(p, 'short'),
    value: selectedCategory ? (byPeriod.get(p.start)?.get(selectedCategory) ?? 0) : 0,
  }));

  const categoryAccounts = selectedCategory
    ? accountRows.filter((r) => r.categoryKey === selectedCategory)
    : [];

  const unmappedAccounts = accountRows.filter(
    (r) => r.classification === 'Expense' && !r.categoryKey && Math.abs(r.amount) > 0,
  );

  return (
    <>
      <PageHeader
        title="Expense analysis"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
      />

      {metrics && metrics.unmappedOpexAmount > 0 ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-warning/25 bg-warning-soft px-4 py-3 text-xs text-warning">
          {formatPercent(metrics.unmappedOpexPct)} of operating expenses (
          {formatCurrency(metrics.unmappedOpexAmount, { currency: company.currencyCode })}) are not mapped to a
          management category.{' '}
          <Link className="underline underline-offset-2" href="/settings/account-mapping">
            Review account mappings
          </Link>
          .
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Categories in {monthLabel(period)}</CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.length === 0 ? (
              <EmptyState title="No expense categories" description="No mapped expense activity for this month." />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Category</TH>
                      <TH className="text-right">Current</TH>
                      <TH className="text-right">Previous</TH>
                      <TH className="text-right">Difference</TH>
                      <TH className="text-right">% change</TH>
                      <TH className="text-right">% of revenue</TH>
                      <TH className="text-right">T12 average</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {analysis.map((r) => (
                      <TR
                        key={r.categoryKey}
                        className={selectedCategory === r.categoryKey ? 'bg-navy-50/60' : ''}
                      >
                        <TD>
                          <Link
                            href={`/expenses?company=${company.id}&period=${period.start.slice(0, 7)}&category=${r.categoryKey}`}
                            className="text-navy-700 underline-offset-2 hover:underline"
                          >
                            {r.label}
                          </Link>
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-subtle">
                            {CATEGORY_BY_KEY.get(r.categoryKey)?.section ?? 'opex'}
                          </span>
                        </TD>
                        <TD className="text-right tnum">{formatCurrency(r.current, { currency: company.currencyCode })}</TD>
                        <TD className="text-right tnum text-ink-muted">
                          {formatCurrency(r.previous, { currency: company.currencyCode })}
                        </TD>
                        <TD className="text-right">
                          <Delta value={r.changeAmount} format="currency" currency={company.currencyCode} invert />
                        </TD>
                        <TD className="text-right">
                          <Delta value={r.changePct} invert />
                        </TD>
                        <TD className="text-right tnum">{formatPercent(r.pctOfRevenue)}</TD>
                        <TD className="text-right tnum text-ink-muted">
                          {formatCurrency(r.trailing12Average, { currency: company.currencyCode })}
                        </TD>
                        <TD>{r.material ? <Badge variant="warning">Material</Badge> : null}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <CategoryBarChart
              title="Largest categories"
              description={monthLabel(period)}
              data={analysis.slice(0, 10).map((r) => ({ label: r.label, value: r.current }))}
              valueLabel="Amount"
            />
          </CardContent>
        </Card>

        {selectedCategory ? (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>{categoryLabel(selectedCategory)} — detail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <TrendChart
                title={`${categoryLabel(selectedCategory)} over 12 months`}
                data={trendSeries}
                series={[{ key: 'value', label: categoryLabel(selectedCategory), color: SERIES.primary, type: 'bar' }]}
                height={220}
              />
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy-800">Contributing accounts</h3>
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Account</TH>
                        <TH>QuickBooks ID</TH>
                        <TH className="text-right">Amount</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {categoryAccounts.map((a) => (
                        <TR key={a.accountQboId}>
                          <TD>{a.accountName}</TD>
                          <TD className="font-mono text-[11px] text-ink-subtle">{a.accountQboId}</TD>
                          <TD className="text-right tnum">
                            {formatCurrency(a.amount, { currency: company.currencyCode })}
                          </TD>
                        </TR>
                      ))}
                      {categoryAccounts.length === 0 ? (
                        <TR>
                          <TD colSpan={3} className="py-4 text-center text-sm text-ink-muted">
                            No accounts are mapped to this category for {monthLabel(period)}.
                          </TD>
                        </TR>
                      ) : null}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
              <DrilldownPanel
                companyId={company.id}
                period={period.start.slice(0, 7)}
                categoryKey={selectedCategory}
                currency={company.currencyCode}
              />
            </CardContent>
          </Card>
        ) : null}

        {unmappedAccounts.length > 0 ? (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Unmapped expense accounts with activity</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH className="text-right">Amount</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {unmappedAccounts.slice(0, 30).map((a) => (
                      <TR key={a.accountQboId}>
                        <TD>{a.accountName}</TD>
                        <TD className="text-right tnum">
                          {formatCurrency(a.amount, { currency: company.currencyCode })}
                        </TD>
                        <TD className="text-right">
                          <Link
                            className="text-xs text-navy-700 underline-offset-2 hover:underline"
                            href="/settings/account-mapping"
                          >
                            Map this account
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
