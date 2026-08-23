import { getAging } from '@/lib/db/repositories/metrics';
import { safeDivide } from '@/lib/finance/math';
import type { PageContext } from '@/lib/page-context';
import { monthLabel, priorMonth } from '@/lib/util/dates';
import { formatCurrency, formatPercent } from '@/lib/util/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta, MetricCard } from '@/components/ui/metric';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';

/** Shared A/R and A/P page: identical structure, different sign of the money. */
export async function AgingPage({
  ctx,
  kind,
  demoEnabled,
}: {
  ctx: PageContext;
  kind: 'receivable' | 'payable';
  demoEnabled: boolean;
}) {
  const title = kind === 'receivable' ? 'Accounts receivable' : 'Accounts payable';
  const entityLabel = kind === 'receivable' ? 'Customer' : 'Vendor';

  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title={title} />
        <NoDataState demoEnabled={demoEnabled} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const period = ctx.period;
  const [aging, priorAging] = await Promise.all([
    getAging(company.id, kind, period.end),
    getAging(company.id, kind, priorMonth(period).end),
  ]);

  if (!aging) {
    return (
      <>
        <PageHeader
          title={title}
          actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
        />
        <EmptyState
          title={`No aging captured as of ${period.end}`}
          description="QuickBooks did not return an aging summary for this period, or the month has not been synced yet."
        />
      </>
    );
  }

  const money = (v: number | null) => formatCurrency(v, { currency: company.currencyCode });
  const t = aging.total;
  const p = priorAging?.total ?? null;

  const buckets = [
    { label: 'Current', value: t.current, prior: p?.current ?? null },
    { label: '1–30 days', value: t.days1to30, prior: p?.days1to30 ?? null },
    { label: '31–60 days', value: t.days31to60, prior: p?.days31to60 ?? null },
    { label: '61–90 days', value: t.days61to90, prior: p?.days61to90 ?? null },
    { label: 'Over 90 days', value: t.days90Plus, prior: p?.days90Plus ?? null },
  ];

  const entities = aging.entities.slice().sort((a, b) => b.total - a.total);

  return (
    <>
      <PageHeader
        title={title}
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={<PeriodPicker periods={ctx.availablePeriods} active={period.start.slice(0, 7)} />}
      />

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label={`Total ${kind === 'receivable' ? 'A/R' : 'A/P'}`}
          value={t.total}
          currency={company.currencyCode}
          changePct={p ? (p.total === 0 ? null : (t.total - p.total) / Math.abs(p.total)) : null}
          invert
        />
        {buckets.map((b) => (
          <MetricCard
            key={b.label}
            label={b.label}
            value={b.value}
            currency={company.currencyCode}
            changePct={b.prior === null || b.prior === 0 ? null : (b.value - b.prior) / Math.abs(b.prior)}
            invert
          />
        ))}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <CategoryBarChart
              title={`${kind === 'receivable' ? 'Receivables' : 'Payables'} by age`}
              description={`As of ${period.end}`}
              data={buckets.map((b) => ({ label: b.label, value: b.value }))}
              valueLabel="Amount"
              ordinal
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {kind === 'receivable' ? 'Largest overdue balances' : 'Largest vendors owed'} —{' '}
              {monthLabel(period)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {entities.length === 0 ? (
              <EmptyState title="Nothing outstanding" description={`No ${kind} balances as of ${period.end}.`} />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>{entityLabel}</TH>
                      <TH className="text-right">Current</TH>
                      <TH className="text-right">1–30</TH>
                      <TH className="text-right">31–60</TH>
                      <TH className="text-right">61–90</TH>
                      <TH className="text-right">Over 90</TH>
                      <TH className="text-right">Total</TH>
                      <TH className="text-right">% overdue</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {entities.slice(0, 40).map((e) => {
                      const overdue = e.days31to60 + e.days61to90 + e.days90Plus;
                      return (
                        <TR key={e.entityName}>
                          <TD className="max-w-[16rem] truncate font-medium">{e.entityName}</TD>
                          <TD className="text-right tnum">{money(e.current)}</TD>
                          <TD className="text-right tnum">{money(e.days1to30)}</TD>
                          <TD className="text-right tnum">{money(e.days31to60)}</TD>
                          <TD className="text-right tnum">{money(e.days61to90)}</TD>
                          <TD className="text-right tnum font-medium">{money(e.days90Plus)}</TD>
                          <TD className="text-right tnum">{money(e.total)}</TD>
                          <TD className="text-right tnum text-ink-muted">
                            {formatPercent(safeDivide(overdue, e.total))}
                          </TD>
                        </TR>
                      );
                    })}
                    <TR className="bg-surface-muted/70 font-semibold">
                      <TD>Total</TD>
                      <TD className="text-right tnum">{money(t.current)}</TD>
                      <TD className="text-right tnum">{money(t.days1to30)}</TD>
                      <TD className="text-right tnum">{money(t.days31to60)}</TD>
                      <TD className="text-right tnum">{money(t.days61to90)}</TD>
                      <TD className="text-right tnum">{money(t.days90Plus)}</TD>
                      <TD className="text-right tnum">{money(t.total)}</TD>
                      <TD className="text-right">
                        <Delta
                          value={p ? (p.total === 0 ? null : (t.total - p.total) / Math.abs(p.total)) : null}
                          invert
                        />
                      </TD>
                    </TR>
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
