import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { getLocationMetrics } from '@/lib/db/repositories/metrics';
import { rankStores } from '@/lib/finance/locations';
import { monthLabel, priorMonth, sameMonthLastYear } from '@/lib/util/dates';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';
import { StoreComparisonChart } from '@/components/charts/store-chart';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';
import { SERIES } from '@/components/charts/palette';
import { StoreTable } from './store-table';

export const dynamic = 'force-dynamic';

export default async function StoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Store performance" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;
  const [current, prior, lastYear] = await Promise.all([
    getLocationMetrics(company.id, period),
    getLocationMetrics(company.id, priorMonth(period)),
    getLocationMetrics(company.id, sameMonthLastYear(period)),
  ]);

  if (current.length === 0) {
    return (
      <>
        <PageHeader
          title="Store performance"
          actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
        />
        <EmptyState
          title="No location or class data"
          description="This QuickBooks company does not use Locations (Departments) or Classes for the selected month, so per-store results cannot be produced. Enable one of them in QuickBooks and re-sync, or set the tracking dimension in Settings → Company."
        />
      </>
    );
  }

  const rows = rankStores(current, prior, lastYear);
  const dimensionLabel = current[0]?.dimension === 'class' ? 'Class' : 'Location';

  return (
    <>
      <PageHeader
        title="Store performance"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
      />

      <InfoNotice className="mb-4">
        Store Contribution Before Corporate Overhead. Shared corporate costs (administration, professional fees,
        head-office software) are not allocated to individual stores, so contribution is not the same as store net
        profit. Segments come from the QuickBooks {dimensionLabel} dimension for {monthLabel(period)}.
      </InfoNotice>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <StoreTable
            rows={rows.map((s) => ({
              store: s.dimensionName,
              rank: s.rank,
              revenue: s.netSales,
              momPct: s.revenueMoM,
              yoyPct: s.revenueYoY,
              grossProfit: s.grossProfit,
              grossMargin: s.grossMargin,
              payroll: s.payrollExpense,
              payrollPct: s.payrollPct,
              operatingExpenses: s.operatingExpenses,
              contributionProfit: s.contributionProfit,
              contributionMargin: s.contributionMargin,
            }))}
            currency={company.currencyCode}
          />
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <StoreComparisonChart
              title="Revenue and gross profit by store"
              data={rows.map((s) => ({
                label: s.dimensionName,
                revenue: s.netSales,
                grossProfit: s.grossProfit,
              }))}
              series={[
                { key: 'revenue', label: 'Revenue', color: SERIES.primary },
                { key: 'grossProfit', label: 'Gross profit', color: SERIES.secondary },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <CategoryBarChart
              title="Gross margin by store"
              data={rows.map((s) => ({ label: s.dimensionName, value: s.grossMargin ?? 0 }))}
              valueLabel="Gross margin"
              valueFormat="percent"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <CategoryBarChart
              title="Payroll as % of revenue by store"
              data={rows.map((s) => ({ label: s.dimensionName, value: s.payrollPct ?? 0 }))}
              valueLabel="Payroll % of revenue"
              valueFormat="percent"
              color={SERIES.secondary}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <CategoryBarChart
              title="Contribution profit by store"
              description="Before corporate overhead."
              data={rows.map((s) => ({ label: s.dimensionName, value: s.contributionProfit }))}
              valueLabel="Contribution"
            />
          </CardContent>
        </Card>
      </div>

    </>
  );
}
