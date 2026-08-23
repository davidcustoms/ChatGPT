import { basisLabel } from '../finance/basis';
import { formatCurrency, formatPercent, formatPoints } from '../util/format';
import type { ReportPayload } from '../reports/types';
import { sanitizeUntrusted, scanForInjection, untrustedBlock } from './sanitize';
import { event } from '../observability';

/**
 * Builds the only financial context the model is allowed to reason over.
 *
 * Three separations are enforced here:
 *
 *  1. Trusted vs untrusted. Application-computed figures are stated plainly;
 *     anything originating in the accounting system (vendor names, store names,
 *     memos) is confined to a delimited data block.
 *  2. Present vs absent. Every comparison window states whether it has data.
 *     "Not available" is written explicitly, because silence is what invites a
 *     model to fill a gap.
 *  3. Reliable vs unreliable. Mapping coverage and the quality score travel
 *     with the figures they qualify.
 */

export interface AiContext {
  text: string;
  /** Every literal figure the model is permitted to state. */
  allowedFigures: Set<string>;
  /** Categories whose coverage is too poor to support a conclusion. */
  restrictedCategories: string[];
  /** Injection-looking values seen in accounting fields, for logging. */
  injectionSignals: Array<{ index: number; field: string; value: string }>;
}

function line(out: string[], figures: Set<string>, label: string, value: string): void {
  out.push(`${label}: ${value}`);
  figures.add(value);
}

/** Written when a comparison window has no stored data. */
function unavailable(out: string[], label: string, reason: string): void {
  out.push(`${label}: NOT AVAILABLE — ${reason}. Do not state or estimate a value for it.`);
}

export function buildAiContext(report: ReportPayload): AiContext {
  const out: string[] = [];
  const figures = new Set<string>();
  const m = report.metrics;
  const c = report.comparisons;
  const avail = report.comparisonAvailability;

  out.push(`COMPANY: ${sanitizeUntrusted(report.companyName, 120)}`);
  out.push(`REPORTING PERIOD: ${report.periodLabel} (${report.period.start} to ${report.period.end})`);
  out.push(`ACCOUNTING BASIS: ${basisLabel(report.accountingMethod)}`);
  out.push(`DATA SOURCE: ${report.sourceSystem}, data through ${report.dataThrough}`);
  out.push(
    `REPORT CONFIDENCE SCORE: ${report.dataQuality.score.score}/100 (${report.dataQuality.score.bandLabel}). This score is computed by the application. Do not dispute or restate it.`,
  );
  if (report.dataQuality.score.deductions.length > 0) {
    out.push('SCORE DEDUCTIONS:');
    for (const d of report.dataQuality.score.deductions) {
      out.push(`  -${d.points} ${d.label}: ${d.reason}`);
    }
  }

  // --- mapping coverage ----------------------------------------------------
  const restricted: string[] = [];
  out.push('', '== MAPPING COVERAGE ==');
  out.push(
    `Overall coverage: ${formatPercent(report.mappingCoverage.overallCoverage)} of income and expense activity is mapped to a management category.`,
  );
  for (const section of report.mappingCoverage.sections) {
    out.push(
      `  ${section.label}: ${formatPercent(section.coverage)} mapped (${formatCurrency(section.unmappedAmount)} unmapped across ${section.unmappedAccountCount} account(s))`,
    );
  }
  const weakCategories = report.mappingCoverage.byCategory.filter((cat) => cat.confidence !== 'high');
  if (weakCategories.length > 0) {
    out.push('CATEGORY COVERAGE WARNINGS:');
    for (const cat of weakCategories) {
      out.push(`  ${cat.caveat}`);
      if (cat.confidence === 'low') restricted.push(cat.categoryKey);
    }
    if (restricted.length > 0) {
      out.push(
        `DO NOT draw conclusions about these categories; too much of the relevant spend is unmapped: ${restricted.join(', ')}.`,
      );
    }
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

  if (m.netSales === 0) {
    out.push(
      'NOTE: revenue is zero for this period. Any percentage of revenue is undefined; report it as "N/M" rather than computing one.',
    );
  }
  if (m.netSales < 0) {
    out.push(
      'NOTE: net revenue is negative for this period, meaning discounts and returns exceeded gross sales. Margin percentages are not meaningful; say so rather than reporting one.',
    );
  }

  out.push('', '== PRIOR MONTH ==');
  if (c.priorMonth && avail.priorMonth) {
    line(out, figures, 'Revenue', formatCurrency(c.priorMonth.netSales));
    line(out, figures, 'Gross profit', formatCurrency(c.priorMonth.grossProfit));
    line(out, figures, 'Gross margin', formatPercent(c.priorMonth.grossMargin));
    line(out, figures, 'Operating expenses', formatCurrency(c.priorMonth.operatingExpenses));
    line(out, figures, 'Net income', formatCurrency(c.priorMonth.netIncome));
    line(out, figures, 'Cash', formatCurrency(c.priorMonth.cash));
  } else {
    unavailable(out, 'Prior month', 'no data is stored for the month before this one');
  }

  out.push('', '== SAME MONTH LAST YEAR ==');
  if (c.sameMonthLastYear && avail.sameMonthLastYear) {
    line(out, figures, 'Revenue', formatCurrency(c.sameMonthLastYear.netSales));
    line(out, figures, 'Gross margin', formatPercent(c.sameMonthLastYear.grossMargin));
    line(out, figures, 'Net income', formatCurrency(c.sameMonthLastYear.netIncome));
  } else {
    unavailable(out, 'Same month last year', 'history does not reach back twelve months');
  }

  out.push('', '== YEAR TO DATE ==');
  if (c.yearToDate && avail.yearToDate) {
    line(out, figures, 'Revenue', formatCurrency(c.yearToDate.netSales));
    line(out, figures, 'Gross profit', formatCurrency(c.yearToDate.grossProfit));
    line(out, figures, 'Net income', formatCurrency(c.yearToDate.netIncome));
    if (c.priorYearToDate && avail.priorYearToDate) {
      line(out, figures, 'Prior year to date revenue', formatCurrency(c.priorYearToDate.netSales));
      line(out, figures, 'Prior year to date net income', formatCurrency(c.priorYearToDate.netIncome));
    } else {
      unavailable(out, 'Prior year to date', 'the comparable prior-year months are not stored');
    }
  } else {
    unavailable(out, 'Year to date', 'no months of the current fiscal year are stored');
  }

  out.push('', `== KEY RATIOS (${basisLabel(report.accountingMethod)}) ==`);
  line(out, figures, 'Payroll % of revenue', formatPercent(report.kpis.payrollPctRevenue));
  line(out, figures, 'Advertising % of revenue', formatPercent(report.kpis.advertisingPctRevenue));
  line(out, figures, 'Rent % of revenue', formatPercent(report.kpis.rentPctRevenue));
  line(out, figures, 'Delivery % of revenue', formatPercent(report.kpis.deliveryPctRevenue));
  line(out, figures, 'Merchant fees % of revenue', formatPercent(report.kpis.merchantFeesPctRevenue, 2));
  line(out, figures, 'Operating expense ratio', formatPercent(report.kpis.operatingExpenseRatio));
  line(out, figures, 'Current ratio', report.kpis.currentRatio?.toFixed(2) ?? 'N/M');
  line(out, figures, 'Working capital', formatCurrency(report.kpis.workingCapital));
  line(out, figures, 'Trailing 12-month revenue', formatCurrency(report.kpis.trailing12Revenue));
  out.push(
    `Trailing months of history available: ${avail.trailingMonths}. Ratios labelled trailing-12 use only the months that exist.`,
  );

  out.push('', '== EXPENSE CATEGORIES (current vs prior month) ==');
  if (report.expenseAnalysis.length === 0) {
    out.push('No mapped expense categories for this period.');
  }
  for (const row of report.expenseAnalysis.slice(0, 15)) {
    const coverage = report.mappingCoverage.byCategory.find((cc) => cc.categoryKey === row.categoryKey);
    const parts = [
      `${row.label}: ${formatCurrency(row.current)}`,
      row.previous !== null ? `prior ${formatCurrency(row.previous)}` : 'no prior-month figure',
      row.changePct !== null ? `change ${formatPercent(row.changePct, 1, { signed: true })}` : 'change N/M',
      `${formatPercent(row.pctOfRevenue)} of revenue`,
      row.trailing12Average !== null ? `T12 average ${formatCurrency(row.trailing12Average)}` : 'no T12 average',
      coverage ? `mapping coverage ${formatPercent(coverage.coverage)}` : 'mapping coverage unknown',
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
  if (report.cashPosition.beginningCash === null) {
    out.push('Beginning cash is unavailable, so the change in cash cannot be stated. Say so rather than estimating.');
  }

  if (report.arAging) {
    out.push('', '== RECEIVABLES AGING ==');
    line(out, figures, 'Total A/R', formatCurrency(report.arAging.total.total));
    line(out, figures, 'A/R over 90 days', formatCurrency(report.arAging.total.days90Plus));
  } else {
    out.push('', '== RECEIVABLES AGING ==', 'NOT AVAILABLE — no aging report was captured for this period.');
  }
  if (report.apAging) {
    out.push('', '== PAYABLES AGING ==');
    line(out, figures, 'Total A/P', formatCurrency(report.apAging.total.total));
    line(out, figures, 'A/P over 90 days', formatCurrency(report.apAging.total.days90Plus));
  } else {
    out.push('', '== PAYABLES AGING ==', 'NOT AVAILABLE — no aging report was captured for this period.');
  }

  // --- untrusted sections --------------------------------------------------
  const vendorRecords = report.vendorSpend.slice(0, 10).map((v) => ({
    vendor_name: v.vendorName,
    current_month: formatCurrency(v.current),
    prior_month: v.previous === null ? 'not available' : formatCurrency(v.previous),
    year_to_date: formatCurrency(v.yearToDate),
  }));
  for (const v of report.vendorSpend.slice(0, 10)) figures.add(formatCurrency(v.current));

  const storeRecords = report.stores.map((s) => ({
    store_name: s.dimensionName,
    revenue: formatCurrency(s.netSales),
    gross_margin: formatPercent(s.grossMargin),
    payroll: formatCurrency(s.payrollExpense),
    payroll_pct_of_revenue: formatPercent(s.payrollPct),
    contribution_before_overhead: formatCurrency(s.contributionProfit),
    contribution_margin: formatPercent(s.contributionMargin),
  }));
  for (const s of report.stores) {
    figures.add(formatCurrency(s.netSales));
    figures.add(formatCurrency(s.contributionProfit));
  }

  if (vendorRecords.length > 0) {
    out.push('', '== TOP VENDORS THIS MONTH ==');
    out.push(untrustedBlock('vendor spend', vendorRecords));
  }

  if (storeRecords.length > 0) {
    out.push('', `== STORE PERFORMANCE (${report.storeContributionLabel}) ==`);
    out.push(report.storeNote);
    out.push(untrustedBlock('store results', storeRecords));
  } else {
    out.push('', '== STORE PERFORMANCE ==', 'NOT AVAILABLE — this company has no location or class breakdown for the period.');
  }

  if (report.anomalies.length) {
    out.push('', '== DETERMINISTIC ALERTS (already computed by the application) ==');
    out.push(
      untrustedBlock(
        'alerts',
        report.anomalies.slice(0, 15).map((a) => ({
          severity: a.severity,
          category: a.category,
          title: a.title,
          detail: a.detail,
        })),
      ),
    );
  }

  out.push('', '== APPLICATION-COMPUTED OBSERVATIONS ==');
  for (const o of report.observations) out.push(`- ${o}`);

  // Percentage-point movements the model may quote.
  if (m.grossMargin !== null && c.priorMonth?.grossMargin != null) {
    figures.add(formatPoints(m.grossMargin - c.priorMonth.grossMargin));
  }

  // Injection scanning is for visibility, not filtering: the values are shown
  // to the owner exactly as QuickBooks holds them.
  const injectionSignals = [
    ...scanForInjection(vendorRecords as Array<Record<string, unknown>>, ['vendor_name']),
    ...scanForInjection(storeRecords as Array<Record<string, unknown>>, ['store_name']),
  ];
  if (injectionSignals.length > 0) {
    event('ai.injection_signal', {
      companyId: report.companyId,
      period: report.period.start,
      count: injectionSignals.length,
      fields: injectionSignals.map((s) => s.field),
      reason: 'accounting field contains instruction-like text; treated as data',
    });
  }

  return {
    text: out.join('\n'),
    allowedFigures: figures,
    restrictedCategories: restricted,
    injectionSignals,
  };
}
