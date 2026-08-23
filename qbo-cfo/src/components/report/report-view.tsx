import Link from 'next/link';
import { Badge, severityVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard, Delta } from '@/components/ui/metric';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { InfoNotice, WarningNotice } from '@/components/ui/states';
import { BasisBadge } from '@/components/report/basis-badge';
import { CoveragePanel } from '@/components/report/coverage-panel';
import { MetricProvenance } from '@/components/report/metric-provenance';
import { QualityScoreCard } from '@/components/report/quality-score';
import { TrendChart } from '@/components/charts/trend-chart';
import { CategoryBarChart } from '@/components/charts/category-bar-chart';
import { SERIES } from '@/components/charts/palette';
import { formatCurrency, formatDate, formatPercent, formatPoints } from '@/lib/util/format';
import type { ReportPayload } from '@/lib/reports/types';

/** Headline card key -> provenance metric key. */
const HEADLINE_METRIC_KEYS: Record<string, string> = {
  revenue: 'net_sales',
  gross_profit: 'gross_profit',
  gross_margin: 'gross_margin',
  operating_expenses: 'operating_expenses',
  net_income: 'net_income',
  net_margin: 'net_margin',
  cash: 'cash',
  ar: 'accounts_receivable',
  ap: 'accounts_payable',
};

/** Renders a completed report payload. Purely presentational — no computation. */
export function ReportView({ payload }: { payload: ReportPayload }) {
  const cur = payload.currency;
  const money = (v: number | null | undefined) => formatCurrency(v, { currency: cur });

  return (
    <div className="space-y-6">
      <ReportMeta payload={payload} />

      <Section id="executive-summary" title="A. Executive Summary">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {payload.headline.map((h) => (
            <MetricCard
              key={h.key}
              label={h.label}
              value={h.value}
              format={h.format}
              currency={cur}
              changePct={h.format === 'percent' ? undefined : h.changePct}
              changePoints={h.format === 'percent' ? h.changePoints : undefined}
              comparisonLabel={h.comparisonLabel}
              footer={
                HEADLINE_METRIC_KEYS[h.key] ? (
                  <MetricProvenance
                    companyId={payload.companyId}
                    period={payload.period.start.slice(0, 7)}
                    metricKey={HEADLINE_METRIC_KEYS[h.key] as string}
                    currency={cur}
                  />
                ) : null
              }
            />
          ))}
        </div>
        {payload.executiveSummary && payload.executiveSummary !== payload.observations.join(' ') ? (
          <p className="mb-4 text-sm leading-relaxed text-ink">{payload.executiveSummary}</p>
        ) : null}
        <h3 className="mb-2 text-sm font-semibold text-navy-800">Key observations</h3>
        <ul className="space-y-1.5">
          {payload.observations.map((o, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-navy-500" />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="profit-and-loss" title="B. Profit &amp; Loss">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH className="text-right">Current month</TH>
                <TH className="text-right">Previous month</TH>
                <TH className="text-right">Change $</TH>
                <TH className="text-right">Change %</TH>
                <TH className="text-right">Same month last year</TH>
                <TH className="text-right">YoY %</TH>
              </TR>
            </THead>
            <TBody>
              {payload.pnlRows.map((r) => (
                <TR key={r.key} className={r.emphasis === 'total' ? 'bg-surface-muted/70 font-semibold' : ''}>
                  <TD className={r.emphasis === 'subtotal' ? 'font-medium' : ''}>{r.label}</TD>
                  <TD className="text-right tnum">
                    {r.kind === 'percent' ? formatPercent(r.current) : money(r.current)}
                  </TD>
                  <TD className="text-right tnum text-ink-muted">
                    {r.kind === 'percent' ? formatPercent(r.previous) : money(r.previous)}
                  </TD>
                  <TD className="text-right">
                    {r.kind === 'percent' ? (
                      <Delta value={r.changeAmount} format="points" />
                    ) : (
                      <Delta value={r.changeAmount} format="currency" currency={cur} />
                    )}
                  </TD>
                  <TD className="text-right">
                    {r.kind === 'percent' ? <span className="text-ink-subtle">—</span> : <Delta value={r.changePct} />}
                  </TD>
                  <TD className="text-right tnum text-ink-muted">
                    {r.kind === 'percent' ? formatPercent(r.lastYear) : money(r.lastYear)}
                  </TD>
                  <TD className="text-right">
                    {r.kind === 'percent' ? <span className="text-ink-subtle">—</span> : <Delta value={r.yoyPct} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Section>

      <Section id="expense-analysis" title="C. Expense Analysis">
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
              {payload.expenseAnalysis.slice(0, 24).map((r) => (
                <TR key={r.categoryKey}>
                  <TD>
                    <Link
                      className="text-navy-700 underline-offset-2 hover:underline"
                      href={`/expenses?company=${payload.companyId}&period=${payload.period.start.slice(0, 7)}&category=${r.categoryKey}`}
                    >
                      {r.label}
                    </Link>
                  </TD>
                  <TD className="text-right tnum">{money(r.current)}</TD>
                  <TD className="text-right tnum text-ink-muted">{money(r.previous)}</TD>
                  <TD className="text-right">
                    <Delta value={r.changeAmount} format="currency" currency={cur} invert />
                  </TD>
                  <TD className="text-right">
                    <Delta value={r.changePct} invert />
                  </TD>
                  <TD className="text-right tnum">{formatPercent(r.pctOfRevenue)}</TD>
                  <TD className="text-right tnum text-ink-muted">{money(r.trailing12Average)}</TD>
                  <TD>{r.material ? <Badge variant="warning">Material</Badge> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Section>

      <Section id="balance-sheet" title="D. Balance Sheet">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH className="text-right">As of {formatDate(payload.period.end)}</TH>
                <TH className="text-right">Prior month</TH>
                <TH className="text-right">Change</TH>
              </TR>
            </THead>
            <TBody>
              {payload.balanceSheetRows.map((r) => (
                <TR key={r.key} className={r.emphasis === 'total' ? 'bg-surface-muted/70 font-semibold' : ''}>
                  <TD className={r.emphasis === 'subtotal' ? 'font-medium' : ''}>{r.label}</TD>
                  <TD className="text-right tnum">{money(r.current)}</TD>
                  <TD className="text-right tnum text-ink-muted">{money(r.previous)}</TD>
                  <TD className="text-right">
                    <Delta value={r.changeAmount} format="currency" currency={cur} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Section>

      <Section id="cash" title="E. Cash Position">
        <div className="grid gap-4 md:grid-cols-2">
          <dl className="space-y-2 text-sm">
            {[
              ['Beginning cash', money(payload.cashPosition.beginningCash)],
              ['Ending cash', money(payload.cashPosition.endingCash)],
              ['Increase / (decrease)', money(payload.cashPosition.netChange)],
              ...(payload.cashPosition.cashFlowStatementAvailable
                ? ([
                    ['Operating cash flow', money(payload.cashPosition.operating)],
                    ['Investing cash flow', money(payload.cashPosition.investing)],
                    ['Financing cash flow', money(payload.cashPosition.financing)],
                  ] as Array<[string, string]>)
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="tnum font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <InfoNotice>{payload.cashPosition.note}</InfoNotice>
        </div>
      </Section>

      <Section id="receivables" title="F. Accounts Receivable">
        <AgingBlock
          aging={payload.arAging}
          currency={cur}
          emptyMessage="No receivables aging was captured for this period."
          topLabel="Largest overdue balances"
          top={payload.topOverdueReceivables}
          entityLabel="Customer"
        />
      </Section>

      <Section id="payables" title="G. Accounts Payable">
        <AgingBlock
          aging={payload.apAging}
          currency={cur}
          emptyMessage="No payables aging was captured for this period."
          topLabel="Largest vendors owed"
          top={payload.topPayables}
          entityLabel="Vendor"
        />
      </Section>

      <Section id="vendors" title="H. Vendor Spending">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH className="text-right">Current month</TH>
                <TH className="text-right">Previous month</TH>
                <TH className="text-right">Change</TH>
                <TH className="text-right">Year to date</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {payload.vendorSpend.map((v) => (
                <TR key={v.vendorName}>
                  <TD>{v.vendorName}</TD>
                  <TD className="text-right tnum">{money(v.current)}</TD>
                  <TD className="text-right tnum text-ink-muted">{money(v.previous)}</TD>
                  <TD className="text-right">
                    <Delta value={v.changeAmount} format="currency" currency={cur} invert />
                  </TD>
                  <TD className="text-right tnum">{money(v.yearToDate)}</TD>
                  <TD>{v.flagged ? <Badge variant="warning">Unusual</Badge> : null}</TD>
                </TR>
              ))}
              {payload.vendorSpend.length === 0 ? (
                <TR>
                  <TD colSpan={6} className="py-6 text-center text-sm text-ink-muted">
                    No vendor transactions were captured for this period.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </TableWrap>
      </Section>

      <Section id="stores" title={`I. Store Analysis — ${payload.storeContributionLabel}`}>
        <InfoNotice className="mb-3">{payload.storeNote}</InfoNotice>
        {payload.stores.length > 0 ? (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Rank</TH>
                  <TH>Store</TH>
                  <TH className="text-right">Revenue</TH>
                  <TH className="text-right">MoM</TH>
                  <TH className="text-right">YoY</TH>
                  <TH className="text-right">Gross profit</TH>
                  <TH className="text-right">Gross margin</TH>
                  <TH className="text-right">Payroll</TH>
                  <TH className="text-right">Payroll %</TH>
                  <TH className="text-right">Operating expenses</TH>
                  <TH className="text-right">Contribution</TH>
                  <TH className="text-right">Contribution %</TH>
                </TR>
              </THead>
              <TBody>
                {payload.stores.map((s) => (
                  <TR key={s.dimensionName}>
                    <TD className="tnum text-ink-muted">{s.rank}</TD>
                    <TD className="font-medium">{s.dimensionName}</TD>
                    <TD className="text-right tnum">{money(s.netSales)}</TD>
                    <TD className="text-right"><Delta value={s.revenueMoM} /></TD>
                    <TD className="text-right"><Delta value={s.revenueYoY} /></TD>
                    <TD className="text-right tnum">{money(s.grossProfit)}</TD>
                    <TD className="text-right tnum">{formatPercent(s.grossMargin)}</TD>
                    <TD className="text-right tnum">{money(s.payrollExpense)}</TD>
                    <TD className="text-right tnum">{formatPercent(s.payrollPct)}</TD>
                    <TD className="text-right tnum">{money(s.operatingExpenses)}</TD>
                    <TD className="text-right tnum font-medium">{money(s.contributionProfit)}</TD>
                    <TD className="text-right tnum">{formatPercent(s.contributionMargin)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : (
          <p className="text-sm text-ink-muted">
            No location or class breakdown is available for this period.
          </p>
        )}
      </Section>

      <Section id="trends" title="J. 12-Month Trends">
        <div className="grid gap-6 lg:grid-cols-2">
          <TrendChart
            title="Revenue, gross profit and net income"
            data={payload.trends.map((t) => ({
              label: t.label,
              revenue: t.revenue,
              grossProfit: t.grossProfit,
              netIncome: t.netIncome,
            }))}
            series={[
              { key: 'revenue', label: 'Revenue', color: SERIES.primary, type: 'bar' },
              { key: 'grossProfit', label: 'Gross profit', color: SERIES.secondary },
              { key: 'netIncome', label: 'Net income', color: SERIES.tertiary },
            ]}
          />
          <TrendChart
            title="Gross margin"
            data={payload.trends.map((t) => ({ label: t.label, grossMargin: t.grossMargin }))}
            series={[{ key: 'grossMargin', label: 'Gross margin', color: SERIES.primary, type: 'area' }]}
            valueFormat="percent"
          />
          <TrendChart
            title="Operating expenses"
            data={payload.trends.map((t) => ({ label: t.label, operatingExpenses: t.operatingExpenses }))}
            series={[{ key: 'operatingExpenses', label: 'Operating expenses', color: SERIES.secondary, type: 'bar' }]}
          />
          <TrendChart
            title="Cash, A/R and A/P"
            data={payload.trends.map((t) => ({
              label: t.label,
              cash: t.cash,
              accountsReceivable: t.accountsReceivable,
              accountsPayable: t.accountsPayable,
            }))}
            series={[
              { key: 'cash', label: 'Cash', color: SERIES.primary },
              { key: 'accountsReceivable', label: 'A/R', color: SERIES.secondary },
              { key: 'accountsPayable', label: 'A/P', color: SERIES.tertiary },
            ]}
          />
          <TrendChart
            title="Payroll and advertising as % of revenue"
            data={payload.trends.map((t) => ({
              label: t.label,
              payrollPctRevenue: t.payrollPctRevenue,
              advertisingPctRevenue: t.advertisingPctRevenue,
            }))}
            series={[
              { key: 'payrollPctRevenue', label: 'Payroll %', color: SERIES.primary },
              { key: 'advertisingPctRevenue', label: 'Advertising %', color: SERIES.secondary },
            ]}
            valueFormat="percent"
          />
          <CategoryBarChart
            title="Expense mix this month"
            data={payload.expenseAnalysis.slice(0, 10).map((r) => ({ label: r.label, value: r.current }))}
            valueLabel="Amount"
          />
        </div>
      </Section>

      <Section id="data-quality" title="Data Quality">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <QualityScoreCard score={payload.dataQuality.score} />
          <CoveragePanel coverage={payload.mappingCoverage} currency={cur} />
        </div>
      </Section>

      <Section id="risks" title="Risks &amp; Opportunities">
        {payload.insights.length === 0 ? (
          <p className="text-sm text-ink-muted">No material risks were identified for this period.</p>
        ) : (
          <ul className="space-y-4">
            {payload.insights.map((i, idx) => (
              <li key={idx} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(i.severity)}>{i.severity}</Badge>
                  <span className="text-sm font-semibold text-navy-800">{i.category}</span>
                  <Badge variant="outline">Confidence: {i.confidence}</Badge>
                </div>
                <p className="text-sm text-ink">{i.observation}</p>
                {i.supportingMetrics.length > 0 ? (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Supporting metrics: {i.supportingMetrics.join(' · ')}
                  </p>
                ) : null}
                {i.likelyImplication ? (
                  <p className="mt-1.5 text-sm text-ink-muted">
                    <span className="font-medium text-ink">Implication:</span> {i.likelyImplication}
                  </p>
                ) : null}
                {i.recommendedAction ? (
                  <p className="mt-1.5 text-sm text-ink-muted">
                    <span className="font-medium text-ink">Recommended action:</span> {i.recommendedAction}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="actions" title="Recommended Actions">
        {payload.insights.length === 0 ? (
          <p className="text-sm text-ink-muted">No actions were generated for this period.</p>
        ) : (
          <ol className="space-y-2">
            {payload.insights.map((i, idx) => (
              <li key={idx} className="flex gap-3 text-sm">
                <span className="tnum font-semibold text-navy-700">{idx + 1}.</span>
                <span>
                  <span className="font-medium text-ink">{i.category}:</span> {i.recommendedAction}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-ink-subtle">
          This report is management information derived from {payload.sourceSystem}. It is not an audit, a tax
          opinion, or a substitute for review by your CPA.
        </p>
      </Section>
    </div>
  );
}

function ReportMeta({ payload }: { payload: ReportPayload }) {
  const confidenceVariant =
    payload.dataQuality.score.band === 'excellent'
      ? 'positive'
      : payload.dataQuality.score.band === 'good'
        ? 'info'
        : payload.dataQuality.score.band === 'needs_review'
          ? 'warning'
          : 'negative';
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{payload.companyName}</CardTitle>
          <BasisBadge
            method={payload.accountingMethod}
            label={payload.basisLabel}
            description={payload.basisDescription}
          />
          <Badge variant={confidenceVariant}>
            Report confidence: {payload.dataQuality.score.score}/100 · {payload.dataQuality.score.bandLabel}
          </Badge>
        </div>
        <p className="text-xs text-ink-muted">
          Data through: {formatDate(payload.dataThrough)} · Source: {payload.sourceSystem} · Generated{' '}
          {formatDate(payload.generatedAt)}
          {payload.provenanceVersion
            ? ` · Version ${payload.provenanceVersion.reportVersion} · App ${payload.provenanceVersion.appVersion} · Prompt ${payload.provenanceVersion.aiPromptVersion} · Mapping v${payload.provenanceVersion.mappingVersion}`
            : ''}
        </p>
      </CardHeader>
      {payload.dataQuality.reasons.length > 0 ? (
        <CardContent>
          <WarningNotice>
            <p className="font-semibold">Data quality notes</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {payload.dataQuality.reasons.slice(0, 6).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </WarningNotice>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="mb-3 border-b border-border pb-1.5 text-base font-semibold text-navy-800">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AgingBlock({
  aging,
  currency,
  emptyMessage,
  topLabel,
  top,
  entityLabel,
}: {
  aging: ReportPayload['arAging'];
  currency: string;
  emptyMessage: string;
  topLabel: string;
  top: Array<{ name: string; amount: number; over90: number }>;
  entityLabel: string;
}) {
  const money = (v: number) => formatCurrency(v, { currency });
  if (!aging) return <p className="text-sm text-ink-muted">{emptyMessage}</p>;
  const t = aging.total;
  const pct = (v: number) => (t.total === 0 ? '—' : formatPercent(v / t.total));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Bucket</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Share</TH>
            </TR>
          </THead>
          <TBody>
            {[
              ['Current', t.current],
              ['1 – 30 days', t.days1to30],
              ['31 – 60 days', t.days31to60],
              ['61 – 90 days', t.days61to90],
              ['Over 90 days', t.days90Plus],
            ].map(([label, value]) => (
              <TR key={label as string}>
                <TD>{label as string}</TD>
                <TD className="text-right tnum">{money(value as number)}</TD>
                <TD className="text-right tnum text-ink-muted">{pct(value as number)}</TD>
              </TR>
            ))}
            <TR className="bg-surface-muted/70 font-semibold">
              <TD>Total</TD>
              <TD className="text-right tnum">{money(t.total)}</TD>
              <TD className="text-right tnum">100.0%</TD>
            </TR>
          </TBody>
        </Table>
      </TableWrap>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-navy-800">{topLabel}</h3>
        {top.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing outstanding beyond current terms.</p>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>{entityLabel}</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Over 90 days</TH>
                </TR>
              </THead>
              <TBody>
                {top.map((r) => (
                  <TR key={r.name}>
                    <TD>{r.name}</TD>
                    <TD className="text-right tnum">{money(r.amount)}</TD>
                    <TD className="text-right tnum">{money(r.over90)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

export { formatPoints };
