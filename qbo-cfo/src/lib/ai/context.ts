import { categoryLabel } from '../finance/categories';
import { formatCurrency, formatPercent, formatPoints } from '../util/format';
import type { ReportPayload } from '../reports/types';

/**
 * Builds the *only* financial context the model is allowed to reason over.
 *
 * This is a clean, labelled metric set -- never a raw bookkeeping dump. Each
 * line is a "name: value" pair so the model can quote it verbatim, and the
 * post-processing check in insights.ts verifies that it did.
 */

export interface AiContext {
  text: string;
  /** Every literal figure the model is permitted to state. */
  allowedFigures: Set<string>;
}

function line(out: string[], figures: Set<string>, label: string, value: string): void {
  out.push(`${label}: ${value}`);
  figures.add(value);
}

export function buildAiContext(report: ReportPayload): AiContext {
  const out: string[] = [];
  const figures = new Set<string>();
  const m = report.metrics;
  const c = report.comparisons;

  out.push(`COMPANY: ${report.companyName}`);
  out.push(`REPORTING PERIOD: ${report.periodLabel} (${report.period.start} to ${report.period.end})`);
  out.push(`DATA SOURCE: ${report.sourceSystem}, data through ${report.dataThrough}`);
  out.push(`REPORT CONFIDENCE: ${report.dataQuality.confidence}`);
  if (report.dataQuality.reasons.length) {
    out.push(`DATA QUALITY NOTES: ${report.dataQuality.reasons.join(' | ')}`);
  }

  out.push('', '== CURRENT MONTH ==');
  line(out, figures, 'Revenue (net sales)', formatCurrency(m.netSales));
  line(out, figures, 'Gross sales', formatCurrency(m.grossSales));
  line(out, figures, 'Discounts', formatCurrency(m.discounts));
  line(out, figures, 'Returns', formatCurrency(m.refunds));
  line(out, figures, 'COGS', formatCurrency(m.cogs));
  line(out, figures, 'Gross profit', formatCurrency(m.grossProfit));
  line(out, figures, 'Gross margin', formatPercent(m.grossMargin));
  line(out, figures, 'Operating expenses', formatCurrency(m.operatingExpenses));
  line(out, figures, 'Operating income', formatCurrency(m.netOperatingIncome));
  line(out, figures, 'Net income', formatCurrency(m.netIncome));
  line(out, figures, 'Net margin', formatPercent(m.netMargin));
  line(out, figures, 'Cash', formatCurrency(m.cash));
  line(out, figures, 'Accounts receivable', formatCurrency(m.accountsReceivable));
  line(out, figures, 'Accounts payable', formatCurrency(m.accountsPayable));
  line(out, figures, 'Inventory', formatCurrency(m.inventoryValue));

  if (c.priorMonth) {
    out.push('', '== PRIOR MONTH ==');
    line(out, figures, 'Revenue', formatCurrency(c.priorMonth.netSales));
    line(out, figures, 'Gross profit', formatCurrency(c.priorMonth.grossProfit));
    line(out, figures, 'Gross margin', formatPercent(c.priorMonth.grossMargin));
    line(out, figures, 'Operating expenses', formatCurrency(c.priorMonth.operatingExpenses));
    line(out, figures, 'Net income', formatCurrency(c.priorMonth.netIncome));
    line(out, figures, 'Cash', formatCurrency(c.priorMonth.cash));
  }

  if (c.sameMonthLastYear) {
    out.push('', '== SAME MONTH LAST YEAR ==');
    line(out, figures, 'Revenue', formatCurrency(c.sameMonthLastYear.netSales));
    line(out, figures, 'Gross margin', formatPercent(c.sameMonthLastYear.grossMargin));
    line(out, figures, 'Net income', formatCurrency(c.sameMonthLastYear.netIncome));
  }

  if (c.yearToDate) {
    out.push('', '== YEAR TO DATE ==');
    line(out, figures, 'Revenue', formatCurrency(c.yearToDate.netSales));
    line(out, figures, 'Gross profit', formatCurrency(c.yearToDate.grossProfit));
    line(out, figures, 'Net income', formatCurrency(c.yearToDate.netIncome));
    if (c.priorYearToDate) {
      line(out, figures, 'Prior year to date revenue', formatCurrency(c.priorYearToDate.netSales));
      line(out, figures, 'Prior year to date net income', formatCurrency(c.priorYearToDate.netIncome));
    }
  }

  out.push('', '== KEY RATIOS ==');
  line(out, figures, 'Payroll % of revenue', formatPercent(report.kpis.payrollPctRevenue));
  line(out, figures, 'Advertising % of revenue', formatPercent(report.kpis.advertisingPctRevenue));
  line(out, figures, 'Rent % of revenue', formatPercent(report.kpis.rentPctRevenue));
  line(out, figures, 'Delivery % of revenue', formatPercent(report.kpis.deliveryPctRevenue));
  line(out, figures, 'Merchant fees % of revenue', formatPercent(report.kpis.merchantFeesPctRevenue, 2));
  line(out, figures, 'Operating expense ratio', formatPercent(report.kpis.operatingExpenseRatio));
  line(out, figures, 'Current ratio', report.kpis.currentRatio?.toFixed(2) ?? 'N/M');
  line(out, figures, 'Working capital', formatCurrency(report.kpis.workingCapital));
  line(out, figures, 'Trailing 12-month revenue', formatCurrency(report.kpis.trailing12Revenue));

  out.push('', '== EXPENSE CATEGORIES (current vs prior month) ==');
  for (const row of report.expenseAnalysis.slice(0, 15)) {
    const parts = [
      `${row.label}: ${formatCurrency(row.current)}`,
      row.previous !== null ? `prior ${formatCurrency(row.previous)}` : 'no prior-month figure',
      row.changePct !== null ? `change ${formatPercent(row.changePct, 1, { signed: true })}` : 'change N/M',
      `${formatPercent(row.pctOfRevenue)} of revenue`,
      row.trailing12Average !== null ? `T12 average ${formatCurrency(row.trailing12Average)}` : 'no T12 average',
    ];
    out.push(parts.join('; '));
    figures.add(formatCurrency(row.current));
    if (row.previous !== null) figures.add(formatCurrency(row.previous));
  }

  out.push('', '== CASH POSITION ==');
  line(out, figures, 'Beginning cash', formatCurrency(report.cashPosition.beginningCash));
  line(out, figures, 'Ending cash', formatCurrency(report.cashPosition.endingCash));
  line(out, figures, 'Net change in cash', formatCurrency(report.cashPosition.netChange));
  out.push(`Cash flow statement available: ${report.cashPosition.cashFlowStatementAvailable ? 'yes' : 'no'}`);
  if (!report.cashPosition.cashFlowStatementAvailable) {
    out.push('Do NOT state operating, investing or financing cash flow figures; they were not provided.');
  }

  if (report.arAging) {
    out.push('', '== RECEIVABLES AGING ==');
    line(out, figures, 'Total A/R', formatCurrency(report.arAging.total.total));
    line(out, figures, 'A/R over 90 days', formatCurrency(report.arAging.total.days90Plus));
  }
  if (report.apAging) {
    out.push('', '== PAYABLES AGING ==');
    line(out, figures, 'Total A/P', formatCurrency(report.apAging.total.total));
    line(out, figures, 'A/P over 90 days', formatCurrency(report.apAging.total.days90Plus));
  }

  if (report.vendorSpend.length) {
    out.push('', '== TOP VENDORS THIS MONTH ==');
    for (const v of report.vendorSpend.slice(0, 10)) {
      out.push(
        `${v.vendorName}: ${formatCurrency(v.current)}${v.previous !== null ? ` (prior ${formatCurrency(v.previous)})` : ''}; YTD ${formatCurrency(v.yearToDate)}`,
      );
      figures.add(formatCurrency(v.current));
    }
  }

  if (report.stores.length) {
    out.push('', `== STORE PERFORMANCE (${report.storeContributionLabel}) ==`);
    out.push(report.storeNote);
    for (const s of report.stores) {
      out.push(
        `${s.dimensionName}: revenue ${formatCurrency(s.netSales)}, gross margin ${formatPercent(s.grossMargin)}, payroll ${formatCurrency(s.payrollExpense)} (${formatPercent(s.payrollPct)} of revenue), contribution ${formatCurrency(s.contributionProfit)} (${formatPercent(s.contributionMargin)})`,
      );
      figures.add(formatCurrency(s.netSales));
      figures.add(formatCurrency(s.contributionProfit));
    }
  }

  if (report.anomalies.length) {
    out.push('', '== DETERMINISTIC ALERTS (already computed by the application) ==');
    for (const a of report.anomalies.slice(0, 15)) {
      out.push(`[${a.severity}] ${a.category} - ${a.title}. ${a.detail}`);
    }
  }

  out.push('', '== APPLICATION-COMPUTED OBSERVATIONS ==');
  for (const o of report.observations) out.push(`- ${o}`);

  // Percentage-point movements the model may quote.
  if (m.grossMargin !== null && c.priorMonth?.grossMargin != null) {
    figures.add(formatPoints(m.grossMargin - c.priorMonth.grossMargin));
  }

  return { text: out.join('\n'), allowedFigures: figures };
}
