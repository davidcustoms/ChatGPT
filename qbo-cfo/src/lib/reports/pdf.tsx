import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import React from 'react';
import { categoryLabel } from '../finance/categories';
import { formatCurrency, formatDate, formatPercent, formatPoints } from '../util/format';
import type { Branding } from '../db/repositories/companies';
import type { ReportPayload } from './types';
import { AppError } from '../errors';

/**
 * Executive PDF: clean white background, dark navy typography, KPI cards and
 * tabular financials. Twelve logical pages matching the on-screen report.
 */

const NAVY = '#1e3a5f';
const CHARCOAL = '#2b2f36';
const MUTED = '#6b7280';
const BORDER = '#d9dee5';
const POSITIVE = '#166534';
const NEGATIVE = '#9f1239';

const styles = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 54,
    paddingHorizontal: 44,
    fontSize: 9,
    color: CHARCOAL,
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
  },
  coverTitle: { fontSize: 30, color: NAVY, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  coverCompany: { fontSize: 15, color: CHARCOAL, marginBottom: 2 },
  coverMeta: { fontSize: 9, color: MUTED, marginBottom: 26 },
  sectionTitle: {
    fontSize: 14,
    color: NAVY,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  subTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 12, marginBottom: 5 },
  paragraph: { fontSize: 9.5, lineHeight: 1.5, marginBottom: 7, color: CHARCOAL },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 10 },
  card: {
    width: '33.33%',
    padding: 4,
  },
  cardInner: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 9,
    minHeight: 54,
  },
  cardLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  cardValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: NAVY },
  cardDelta: { fontSize: 7.5, marginTop: 3 },
  table: { marginTop: 4, borderTopWidth: 1, borderTopColor: BORDER },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingVertical: 3.5 },
  trHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: NAVY, paddingVertical: 4 },
  th: { fontSize: 7.5, color: NAVY, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  td: { fontSize: 8.5 },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: MUTED,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    marginBottom: 3,
  },
  insight: {
    borderLeftWidth: 2.5,
    borderLeftColor: NAVY,
    paddingLeft: 8,
    marginBottom: 9,
  },
  note: { fontSize: 8, color: MUTED, fontStyle: 'italic', marginTop: 4 },
});

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#9f1239',
  IMPORTANT: '#b45309',
  WATCH: '#1d4ed8',
  INFO: '#4b5563',
};

interface Col {
  label: string;
  width: string;
  align?: 'left' | 'right';
}

function Table({
  columns,
  rows,
}: {
  columns: Col[];
  rows: Array<{ cells: string[]; bold?: boolean; color?: string }>;
}): React.ReactElement {
  return (
    <View style={styles.table}>
      <View style={styles.trHead}>
        {columns.map((c, i) => (
          <Text
            key={c.label + i}
            style={[styles.th, { width: c.width }, c.align === 'right' ? styles.right : {}]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.tr} wrap={false}>
          {row.cells.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                row.bold ? styles.tdBold : styles.td,
                { width: columns[ci]?.width ?? '20%' },
                columns[ci]?.align === 'right' ? styles.right : {},
                row.color && ci > 0 ? { color: row.color } : {},
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Footer({ payload, branding }: { payload: ReportPayload; branding: Branding }): React.ReactElement {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {payload.companyName} · {payload.periodLabel}
        {branding.confidential ? ' · Confidential' : ''}
      </Text>
      <Text
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

function deltaColor(value: number | null | undefined, invert = false): string {
  if (value === null || value === undefined || value === 0) return MUTED;
  const positive = invert ? value < 0 : value > 0;
  return positive ? POSITIVE : NEGATIVE;
}

function KpiCards({ payload }: { payload: ReportPayload }): React.ReactElement {
  return (
    <View style={styles.cardRow}>
      {payload.headline.map((h) => (
        <View key={h.key} style={styles.card}>
          <View style={styles.cardInner}>
            <Text style={styles.cardLabel}>{h.label}</Text>
            <Text style={styles.cardValue}>
              {h.format === 'percent'
                ? formatPercent(h.value)
                : formatCurrency(h.value, { currency: payload.currency })}
            </Text>
            <Text style={[styles.cardDelta, { color: deltaColor(h.changePct ?? h.changePoints) }]}>
              {h.format === 'percent'
                ? `${formatPoints(h.changePoints)} ${h.comparisonLabel}`
                : `${formatPercent(h.changePct, 1, { signed: true })} ${h.comparisonLabel}`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ReportDocument({
  payload,
  branding,
}: {
  payload: ReportPayload;
  branding: Branding;
}): React.ReactElement {
  const cur = payload.currency;
  const money = (v: number | null | undefined) => formatCurrency(v, { currency: cur });

  return (
    <Document
      title={`${payload.companyName} - ${payload.periodLabel} Executive Financial Report`}
      author={payload.companyName}
      subject="Monthly CFO Report"
    >
      {/* 1. Cover / executive dashboard */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.coverCompany}>{payload.companyName}</Text>
        <Text style={styles.coverTitle}>{payload.periodLabel} Executive Financial Report</Text>
        <Text style={styles.coverMeta}>
          Data through {formatDate(payload.dataThrough)} · Source: {payload.sourceSystem} · Report confidence:{' '}
          {payload.dataQuality.confidence.toUpperCase()} · Generated {formatDate(payload.generatedAt)}
        </Text>
        <KpiCards payload={payload} />
        <Text style={styles.subTitle}>Needs Your Attention</Text>
        {payload.anomalies.slice(0, 6).map((a, i) => (
          <View key={i} style={styles.insight} wrap={false}>
            <Text style={[styles.badge, { backgroundColor: SEVERITY_COLOR[a.severity] ?? MUTED }]}>
              {a.severity}
            </Text>
            <Text style={styles.tdBold}>{a.title}</Text>
            <Text style={styles.paragraph}>{a.detail}</Text>
          </View>
        ))}
        {payload.anomalies.length === 0 ? (
          <Text style={styles.paragraph}>No threshold alerts were raised for this period.</Text>
        ) : null}
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 2. Executive summary */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Executive Summary</Text>
        {payload.executiveSummary && payload.executiveSummary !== payload.observations.join(' ') ? (
          <Text style={styles.paragraph}>{payload.executiveSummary}</Text>
        ) : null}
        <Text style={styles.subTitle}>Key Observations</Text>
        {payload.observations.map((o, i) => (
          <Text key={i} style={styles.paragraph}>
            • {o}
          </Text>
        ))}
        {payload.dataQuality.reasons.length > 0 ? (
          <>
            <Text style={styles.subTitle}>Data Quality Notes</Text>
            {payload.dataQuality.reasons.map((r, i) => (
              <Text key={i} style={styles.note}>
                • {r}
              </Text>
            ))}
          </>
        ) : null}
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 3. Profit & Loss */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Profit &amp; Loss</Text>
        <Table
          columns={[
            { label: '', width: '26%' },
            { label: 'Current', width: '13%', align: 'right' },
            { label: 'Prior Month', width: '13%', align: 'right' },
            { label: 'Change $', width: '13%', align: 'right' },
            { label: 'Change %', width: '11%', align: 'right' },
            { label: 'Last Year', width: '13%', align: 'right' },
            { label: 'YoY %', width: '11%', align: 'right' },
          ]}
          rows={payload.pnlRows.map((r) => ({
            bold: r.emphasis === 'total' || r.emphasis === 'subtotal',
            cells: [
              r.label,
              r.kind === 'percent' ? formatPercent(r.current) : money(r.current),
              r.kind === 'percent' ? formatPercent(r.previous) : money(r.previous),
              r.kind === 'percent' ? formatPoints(r.changeAmount) : money(r.changeAmount),
              r.kind === 'percent' ? '—' : formatPercent(r.changePct, 1, { signed: true }),
              r.kind === 'percent' ? formatPercent(r.lastYear) : money(r.lastYear),
              r.kind === 'percent' ? '—' : formatPercent(r.yoyPct, 1, { signed: true }),
            ],
          }))}
        />
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 4. Expense analysis */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Expense Analysis</Text>
        <Table
          columns={[
            { label: 'Category', width: '24%' },
            { label: 'Current', width: '14%', align: 'right' },
            { label: 'Prior', width: '14%', align: 'right' },
            { label: 'Change $', width: '14%', align: 'right' },
            { label: 'Change %', width: '12%', align: 'right' },
            { label: '% of Rev', width: '11%', align: 'right' },
            { label: 'T12 Avg', width: '11%', align: 'right' },
          ]}
          rows={payload.expenseAnalysis.slice(0, 22).map((r) => ({
            bold: r.material,
            color: r.material ? deltaColor(r.changeAmount, true) : undefined,
            cells: [
              r.label,
              money(r.current),
              money(r.previous),
              money(r.changeAmount),
              formatPercent(r.changePct, 1, { signed: true }),
              formatPercent(r.pctOfRevenue),
              money(r.trailing12Average),
            ],
          }))}
        />
        <Text style={styles.note}>
          Highlighted rows exceed both the dollar and percentage materiality thresholds set for this company.
        </Text>
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 5. Balance sheet */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Balance Sheet</Text>
        <Table
          columns={[
            { label: '', width: '46%' },
            { label: `As of ${formatDate(payload.period.end)}`, width: '20%', align: 'right' },
            { label: 'Prior Month', width: '18%', align: 'right' },
            { label: 'Change', width: '16%', align: 'right' },
          ]}
          rows={payload.balanceSheetRows.map((r) => ({
            bold: r.emphasis === 'total' || r.emphasis === 'subtotal',
            cells: [r.label, money(r.current), money(r.previous), money(r.changeAmount)],
          }))}
        />
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 6. Cash */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Cash Position</Text>
        <Table
          columns={[
            { label: '', width: '60%' },
            { label: 'Amount', width: '40%', align: 'right' },
          ]}
          rows={[
            { cells: ['Beginning cash', money(payload.cashPosition.beginningCash)] },
            { cells: ['Ending cash', money(payload.cashPosition.endingCash)], bold: true },
            { cells: ['Increase / (decrease)', money(payload.cashPosition.netChange)], bold: true },
            ...(payload.cashPosition.cashFlowStatementAvailable
              ? [
                  { cells: ['Operating cash flow', money(payload.cashPosition.operating)] },
                  { cells: ['Investing cash flow', money(payload.cashPosition.investing)] },
                  { cells: ['Financing cash flow', money(payload.cashPosition.financing)] },
                ]
              : []),
          ]}
        />
        <Text style={styles.note}>{payload.cashPosition.note}</Text>
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 7. A/R and A/P */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Accounts Receivable &amp; Payable</Text>
        <Text style={styles.subTitle}>Receivables aging</Text>
        {payload.arAging ? (
          <Table
            columns={[
              { label: 'Bucket', width: '40%' },
              { label: 'Amount', width: '30%', align: 'right' },
              { label: '% of A/R', width: '30%', align: 'right' },
            ]}
            rows={agingRows(payload.arAging.total, cur)}
          />
        ) : (
          <Text style={styles.paragraph}>No receivables aging was captured for this period.</Text>
        )}
        {payload.topOverdueReceivables.length > 0 ? (
          <>
            <Text style={styles.subTitle}>Largest overdue balances</Text>
            <Table
              columns={[
                { label: 'Customer', width: '54%' },
                { label: 'Total', width: '23%', align: 'right' },
                { label: 'Over 90', width: '23%', align: 'right' },
              ]}
              rows={payload.topOverdueReceivables.map((r) => ({
                cells: [r.name, money(r.amount), money(r.over90)],
              }))}
            />
          </>
        ) : null}
        <Text style={styles.subTitle}>Payables aging</Text>
        {payload.apAging ? (
          <Table
            columns={[
              { label: 'Bucket', width: '40%' },
              { label: 'Amount', width: '30%', align: 'right' },
              { label: '% of A/P', width: '30%', align: 'right' },
            ]}
            rows={agingRows(payload.apAging.total, cur)}
          />
        ) : (
          <Text style={styles.paragraph}>No payables aging was captured for this period.</Text>
        )}
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 8. Store performance */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Store Performance</Text>
        <Text style={styles.paragraph}>{payload.storeNote}</Text>
        {payload.stores.length > 0 ? (
          <Table
            columns={[
              { label: 'Store', width: '22%' },
              { label: 'Revenue', width: '13%', align: 'right' },
              { label: 'MoM', width: '10%', align: 'right' },
              { label: 'Gross Profit', width: '13%', align: 'right' },
              { label: 'GM %', width: '10%', align: 'right' },
              { label: 'Payroll %', width: '11%', align: 'right' },
              { label: 'Contribution', width: '13%', align: 'right' },
              { label: 'Cont. %', width: '8%', align: 'right' },
            ]}
            rows={payload.stores.map((s) => ({
              cells: [
                `${s.rank}. ${s.dimensionName}`,
                money(s.netSales),
                formatPercent(s.revenueMoM, 1, { signed: true }),
                money(s.grossProfit),
                formatPercent(s.grossMargin),
                formatPercent(s.payrollPct),
                money(s.contributionProfit),
                formatPercent(s.contributionMargin),
              ],
            }))}
          />
        ) : (
          <Text style={styles.paragraph}>No location or class breakdown is available for this period.</Text>
        )}
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 9. Vendors */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Vendor Analysis</Text>
        <Table
          columns={[
            { label: 'Vendor', width: '34%' },
            { label: 'Current', width: '17%', align: 'right' },
            { label: 'Prior', width: '17%', align: 'right' },
            { label: 'Change', width: '16%', align: 'right' },
            { label: 'YTD', width: '16%', align: 'right' },
          ]}
          rows={payload.vendorSpend.map((v) => ({
            bold: v.flagged,
            cells: [
              `${v.flagged ? '⚑ ' : ''}${v.vendorName}`,
              money(v.current),
              money(v.previous),
              money(v.changeAmount),
              money(v.yearToDate),
            ],
          }))}
        />
        <Text style={styles.note}>Flagged vendors show unusual increases or first-time material spend.</Text>
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 10. 12-month trends */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>12-Month Trends</Text>
        <Table
          columns={[
            { label: 'Month', width: '12%' },
            { label: 'Revenue', width: '15%', align: 'right' },
            { label: 'Gross Profit', width: '15%', align: 'right' },
            { label: 'GM %', width: '10%', align: 'right' },
            { label: 'Opex', width: '15%', align: 'right' },
            { label: 'Net Income', width: '15%', align: 'right' },
            { label: 'Cash', width: '18%', align: 'right' },
          ]}
          rows={payload.trends.map((t) => ({
            cells: [
              t.label,
              money(t.revenue),
              money(t.grossProfit),
              formatPercent(t.grossMargin),
              money(t.operatingExpenses),
              money(t.netIncome),
              money(t.cash),
            ],
          }))}
        />
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 11. Risks & opportunities */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Risks &amp; Opportunities</Text>
        {payload.insights.map((i, idx) => (
          <View key={idx} style={styles.insight} wrap={false}>
            <Text style={[styles.badge, { backgroundColor: SEVERITY_COLOR[i.severity] ?? MUTED }]}>
              {i.severity} · {i.category}
            </Text>
            <Text style={styles.paragraph}>{i.observation}</Text>
            {i.supportingMetrics.length > 0 ? (
              <Text style={styles.note}>Supporting metrics: {i.supportingMetrics.join(' · ')}</Text>
            ) : null}
            {i.likelyImplication ? (
              <Text style={styles.paragraph}>Implication: {i.likelyImplication}</Text>
            ) : null}
          </View>
        ))}
        {payload.insights.length === 0 ? (
          <Text style={styles.paragraph}>No material risks were identified for this period.</Text>
        ) : null}
        <Footer payload={payload} branding={branding} />
      </Page>

      {/* 12. Recommended actions */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Recommended Actions</Text>
        <Table
          columns={[
            { label: 'Priority', width: '14%' },
            { label: 'Area', width: '22%' },
            { label: 'Action', width: '50%' },
            { label: 'Confidence', width: '14%' },
          ]}
          rows={payload.insights.map((i) => ({
            cells: [i.severity, i.category, i.recommendedAction, i.confidence],
          }))}
        />
        <Text style={styles.note}>
          This report is management information derived from {payload.sourceSystem}. It is not an audit, a tax
          opinion, or a substitute for review by your CPA.
        </Text>
        {branding.footerText ? <Text style={styles.note}>{branding.footerText}</Text> : null}
        <Footer payload={payload} branding={branding} />
      </Page>
    </Document>
  );
}

function agingRows(
  total: { current: number; days1to30: number; days31to60: number; days61to90: number; days90Plus: number; total: number },
  currency: string,
): Array<{ cells: string[]; bold?: boolean }> {
  const pct = (v: number) => (total.total === 0 ? '—' : formatPercent(v / total.total));
  const money = (v: number) => formatCurrency(v, { currency });
  return [
    { cells: ['Current', money(total.current), pct(total.current)] },
    { cells: ['1 - 30 days', money(total.days1to30), pct(total.days1to30)] },
    { cells: ['31 - 60 days', money(total.days31to60), pct(total.days31to60)] },
    { cells: ['61 - 90 days', money(total.days61to90), pct(total.days61to90)] },
    { cells: ['Over 90 days', money(total.days90Plus), pct(total.days90Plus)] },
    { cells: ['Total', money(total.total), '100.0%'], bold: true },
  ];
}

export async function renderReportPdf(
  payload: ReportPayload,
  branding: Branding,
): Promise<Buffer> {
  try {
    return await renderToBuffer(<ReportDocument payload={payload} branding={branding} />);
  } catch (err) {
    throw new AppError('PDF_ERROR', 'The PDF could not be generated.', { cause: err, retryable: true });
  }
}

export { categoryLabel };
