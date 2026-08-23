import Link from 'next/link';
import { getPageContext, param, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { getAnomalies } from '@/lib/db/repositories/anomalies';
import { getAging, getLocationMetrics, getMetricsRange, getMonthlyMetrics } from '@/lib/db/repositories/metrics';
import { categoryTotalsByPeriod } from '@/lib/db/repositories/metrics';
import { getReportForPeriod } from '@/lib/db/repositories/reports';
import { basisDescription, basisLabel } from '@/lib/finance/basis';
import { aggregateMetrics } from '@/lib/finance/comparisons';
import { computeKpis } from '@/lib/finance/kpi';
import { categoryLabel, CATEGORY_BY_KEY } from '@/lib/finance/categories';
import { pctChange, safeDivide } from '@/lib/finance/math';
import type { MonthlyMetrics } from '@/lib/finance/types';
import {
  monthLabel,
  priorMonth,
  priorYearToDate,
  sameMonthLastYear,
  trailingMonths,
  yearToDate,
} from '@/lib/util/dates';
import { formatCurrency, formatPercent } from '@/lib/util/format';
import { Badge, severityVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric';
import { EmptyState } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { BasisBadge } from '@/components/report/basis-badge';
import { MetricProvenance } from '@/components/report/metric-provenance';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';
import { TrendChart } from '@/components/charts/trend-chart';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';
import { StoreComparisonChart } from '@/components/charts/store-chart';
import { SERIES } from '@/components/charts/palette';
import { ComparisonTable } from './comparison-table';

export const dynamic = 'force-dynamic';

const COMPARISONS = [
  { value: 'mom', label: 'Prior month' },
  { value: 'yoy', label: 'Year over year' },
  { value: 'ytd', label: 'Year to date' },
  { value: 't12', label: 'Trailing 12 months' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);

  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Your financial command centre — what happened, why it matters, and what needs attention."
        />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;
  const compare = param(sp, 'compare') ?? 'mom';
  const periodKey = period.start.slice(0, 7);

  const prior = priorMonth(period);
  const lastYear = sameMonthLastYear(period);
  const ytd = yearToDate(period, company.fiscalYearStartMonth);
  const pytd = priorYearToDate(period, company.fiscalYearStartMonth);
  const t12 = trailingMonths(period, 12);

  const [metrics, priorMetrics, lastYearMetrics, ytdRows, pytdRows, t12Rows] = await Promise.all([
    getMonthlyMetrics(company.id, period),
    getMonthlyMetrics(company.id, prior),
    getMonthlyMetrics(company.id, lastYear),
    getMetricsRange(company.id, ytd.start, period.start),
    getMetricsRange(company.id, pytd.start, pytd.end),
    getMetricsRange(company.id, t12[0]?.start ?? period.start, period.start),
  ]);

  if (!metrics) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title={`No data for ${monthLabel(period)}`}
          description="Choose a different reporting month, or sync this period from QuickBooks."
          action={
            <Button asChild variant="outline">
              <Link href="/settings/quickbooks">Open QuickBooks settings</Link>
            </Button>
          }
        />
      </>
    );
  }

  const [anomalies, arAging, apAging, stores, categoryRows, report] = await Promise.all([
    getAnomalies(company.id, period),
    getAging(company.id, 'receivable', period.end),
    getAging(company.id, 'payable', period.end),
    getLocationMetrics(company.id, period),
    categoryTotalsByPeriod(company.id, period.start, period.start),
    getReportForPeriod(company.id, period),
  ]);

  const kpis = computeKpis({
    current: metrics,
    priorMonth: priorMetrics,
    sameMonthLastYear: lastYearMetrics,
    trailing12: t12Rows,
  });

  const ytdMetrics = aggregateMetrics(ytdRows, ytd);
  const pytdMetrics = aggregateMetrics(pytdRows, pytd);
  const t12Metrics = aggregateMetrics(t12Rows, { start: t12[0]?.start ?? period.start, end: period.end });

  const baseline =
    compare === 'yoy' ? lastYearMetrics : compare === 'ytd' ? pytdMetrics : compare === 't12' ? null : priorMetrics;
  const focus = compare === 'ytd' ? ytdMetrics : compare === 't12' ? t12Metrics : metrics;
  const comparisonLabel =
    compare === 'yoy'
      ? 'vs same month last year'
      : compare === 'ytd'
        ? 'vs prior year to date'
        : compare === 't12'
          ? 'trailing 12 months'
          : 'vs prior month';

  const view = focus ?? metrics;
  const cardChange = (
    pick: (m: MonthlyMetrics) => number | null,
  ): { pct: number | null; amount: number | null } => {
    const current = pick(view);
    const base = baseline ? pick(baseline) : null;
    if (current === null || base === null) return { pct: null, amount: null };
    return { pct: pctChange(current, base), amount: Number((current - base).toFixed(2)) };
  };

  const revenueChange = cardChange((m) => m.netSales);
  const gpChange = cardChange((m) => m.grossProfit);
  const niChange = cardChange((m) => m.netIncome);
  const cashChange = cardChange((m) => m.cash);
  const arChange = cardChange((m) => m.accountsReceivable);
  const apChange = cardChange((m) => m.accountsPayable);

  const trendData = t12Rows.map((m) => ({
    label: monthLabel(m.period, 'short'),
    revenue: m.netSales,
    grossProfit: m.grossProfit,
    netIncome: m.netIncome,
    grossMargin: m.grossMargin,
    cash: m.cash,
    payrollPct: safeDivide(m.payrollExpense, m.netSales),
    advertisingPct: safeDivide(m.advertisingExpense, m.netSales),
  }));

  const expenseBreakdown = categoryRows
    .filter((r) => {
      if (!r.categoryKey) return false;
      const section = CATEGORY_BY_KEY.get(r.categoryKey)?.section;
      return section === 'opex' || section === 'cogs';
    })
    .map((r) => ({ label: categoryLabel(r.categoryKey), value: r.amount }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const agingChart = (aging: Awaited<ReturnType<typeof getAging>>) =>
    aging
      ? [
          { label: 'Current', value: aging.total.current },
          { label: '1–30 days', value: aging.total.days1to30 },
          { label: '31–60 days', value: aging.total.days31to60 },
          { label: '61–90 days', value: aging.total.days61to90 },
          { label: 'Over 90 days', value: aging.total.days90Plus },
        ]
      : [];

  return (
    <>
      <PageHeader
        title={`${monthLabel(period)} overview`}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />
            <BasisBadge
              method={company.accountingMethod}
              label={basisLabel(company.accountingMethod)}
              description={basisDescription(company.accountingMethod)}
            />
          </div>
        }
        actions={
          <>
            <PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />
            <Button asChild variant={report?.status === 'completed' ? 'outline' : 'default'}>
              <Link
                href={
                  report?.status === 'completed'
                    ? `/reports/${report.id}`
                    : `/reports?company=${company.id}&period=${period.start.slice(0, 7)}`
                }
              >
                {report?.status === 'completed' ? 'View monthly report' : 'Generate monthly report'}
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <ComparisonTable options={COMPARISONS} active={compare} />
      </div>

      <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard
          label="Revenue"
          value={view.netSales}
          changePct={revenueChange.pct}
          comparisonLabel={comparisonLabel}
          footer={<MetricProvenance companyId={company.id} period={periodKey} metricKey="net_sales" currency={company.currencyCode} />}
        />
        <MetricCard
          label="Gross Profit"
          value={view.grossProfit}
          changePct={gpChange.pct}
          comparisonLabel={comparisonLabel}
          footer={<MetricProvenance companyId={company.id} period={periodKey} metricKey="gross_profit" currency={company.currencyCode} />}
        />
        <MetricCard
          label="Gross Margin"
          value={view.grossMargin}
          format="percent"
          changePoints={baseline?.grossMargin != null && view.grossMargin != null ? view.grossMargin - baseline.grossMargin : null}
          comparisonLabel={comparisonLabel}
          footer={<MetricProvenance companyId={company.id} period={periodKey} metricKey="gross_margin" currency={company.currencyCode} />}
        />
        <MetricCard
          label="Net Income"
          value={view.netIncome}
          changePct={niChange.pct}
          comparisonLabel={comparisonLabel}
          footer={<MetricProvenance companyId={company.id} period={periodKey} metricKey="net_income" currency={company.currencyCode} />}
        />
        <MetricCard
          label="Cash"
          value={view.cash}
          changePct={cashChange.pct}
          comparisonLabel={comparisonLabel}
          footer={<MetricProvenance companyId={company.id} period={periodKey} metricKey="cash" currency={company.currencyCode} />}
        />
        <MetricCard
          label="Accounts Receivable"
          value={view.accountsReceivable}
          changePct={arChange.pct}
          comparisonLabel={comparisonLabel}
          invert
          href={`/receivables?company=${company.id}&period=${period.start.slice(0, 7)}`}
        />
        <MetricCard
          label="Accounts Payable"
          value={view.accountsPayable}
          changePct={apChange.pct}
          comparisonLabel={comparisonLabel}
          invert
          href={`/payables?company=${company.id}&period=${period.start.slice(0, 7)}`}
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            <TrendChart
              title="Revenue and profit trend"
              description="Trailing 12 months of net revenue, gross profit and net income."
              data={trendData}
              series={[
                { key: 'revenue', label: 'Revenue', color: SERIES.primary, type: 'bar' },
                { key: 'grossProfit', label: 'Gross profit', color: SERIES.secondary },
                { key: 'netIncome', label: 'Net income', color: SERIES.tertiary },
              ]}
              height={280}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[19.5rem] space-y-3 overflow-y-auto scrollbar-thin">
            {anomalies.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No threshold alerts for {monthLabel(period)}. Thresholds are configurable in Settings → Alerts.
              </p>
            ) : (
              <ul className="space-y-3">
                {anomalies.slice(0, 8).map((a, i) => (
                  <li key={`${a.ruleKey}-${i}`} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                      <span className="text-[11px] uppercase tracking-wide text-ink-subtle">{a.category}</span>
                    </div>
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{a.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <TrendChart
              title="Gross margin trend"
              description="Gross profit as a percentage of net revenue."
              data={trendData}
              series={[{ key: 'grossMargin', label: 'Gross margin', color: SERIES.primary, type: 'area' }]}
              valueFormat="percent"
              height={220}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <TrendChart
              title="Cash trend"
              description="Ending cash balance by month."
              data={trendData}
              series={[{ key: 'cash', label: 'Cash', color: SERIES.secondary, type: 'area' }]}
              height={220}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <TrendChart
              title="Payroll and advertising as % of revenue"
              description="Two ratios on one scale — never a second axis."
              data={trendData}
              series={[
                { key: 'payrollPct', label: 'Payroll % of revenue', color: SERIES.primary },
                { key: 'advertisingPct', label: 'Advertising % of revenue', color: SERIES.secondary },
              ]}
              valueFormat="percent"
              height={220}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            {expenseBreakdown.length > 0 ? (
              <CategoryBarChart
                title="Expense breakdown"
                description={`Largest cost categories in ${monthLabel(period)}.`}
                data={expenseBreakdown}
                valueLabel="Amount"
              />
            ) : (
              <p className="text-sm text-ink-muted">
                No mapped expense categories for this month. Map accounts in Settings → Account Mappings.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Working capital</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {[
                ['Current ratio', kpis.currentRatio === null ? 'N/M' : kpis.currentRatio.toFixed(2)],
                ['Quick ratio', kpis.quickRatio === null ? 'N/M' : kpis.quickRatio.toFixed(2)],
                ['Working capital', formatCurrency(kpis.workingCapital)],
                ['Days sales outstanding', kpis.daysSalesOutstanding === null ? 'N/M' : `${kpis.daysSalesOutstanding.toFixed(0)} days`],
                ['Days payable outstanding', kpis.daysPayableOutstanding === null ? 'N/M' : `${kpis.daysPayableOutstanding.toFixed(0)} days`],
                ['Operating expense ratio', formatPercent(kpis.operatingExpenseRatio)],
                ['Trailing 12-month revenue', formatCurrency(kpis.trailing12Revenue)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tnum font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {stores.length > 0 ? (
          <Card className="lg:col-span-3">
            <CardContent className="pt-5">
              <StoreComparisonChart
                title="Store comparison"
                description="Revenue and gross profit by store. Shared corporate overhead is not allocated."
                data={stores.map((s) => ({
                  label: s.dimensionName,
                  revenue: s.netSales,
                  grossProfit: s.grossProfit,
                }))}
                series={[
                  { key: 'revenue', label: 'Revenue', color: SERIES.primary },
                  { key: 'grossProfit', label: 'Gross profit', color: SERIES.secondary },
                ]}
                height={240}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-5">
            {arAging ? (
              <CategoryBarChart
                title="A/R aging"
                description={`Receivables as of ${period.end}.`}
                data={agingChart(arAging)}
                valueLabel="Receivable"
                ordinal
              />
            ) : (
              <p className="text-sm text-ink-muted">No receivables aging captured for this period.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            {apAging ? (
              <CategoryBarChart
                title="A/P aging"
                description={`Payables as of ${period.end}.`}
                data={agingChart(apAging)}
                valueLabel="Payable"
                ordinal
              />
            ) : (
              <p className="text-sm text-ink-muted">No payables aging captured for this period.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Year to date</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {[
                ['Revenue', formatCurrency(ytdMetrics?.netSales ?? null)],
                ['Prior year to date', formatCurrency(pytdMetrics?.netSales ?? null)],
                [
                  'Change',
                  ytdMetrics && pytdMetrics
                    ? formatPercent(pctChange(ytdMetrics.netSales, pytdMetrics.netSales), 1, { signed: true })
                    : 'N/M',
                ],
                ['Gross profit', formatCurrency(ytdMetrics?.grossProfit ?? null)],
                ['Gross margin', formatPercent(ytdMetrics?.grossMargin ?? null)],
                ['Net income', formatCurrency(ytdMetrics?.netIncome ?? null)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tnum font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
