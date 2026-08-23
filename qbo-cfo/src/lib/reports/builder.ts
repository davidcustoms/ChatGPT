import { getBranding, getCompany } from '../db/repositories/companies';
import { getConnectionForCompany } from '../db/repositories/connections';
import { countUnmappedExpenseAccounts, effectiveMappingIndex } from '../db/repositories/mappings';
import {
  categoryTotalsByPeriod,
  getAccountMetrics,
  getAging,
  getLocationMetrics,
  getMetricsRange,
  getMonthlyMetrics,
  getVendorSpend,
  getVendorSpendRange,
} from '../db/repositories/metrics';
import { listThresholds } from '../db/repositories/anomalies';
import {
  amountStatsByType,
  duplicateCandidates,
  listTransactions,
  missingDimensionCount,
  newVendorsInPeriod,
} from '../db/repositories/transactions';
import { inventorySummary, listDimensions } from '../db/repositories/masterdata';
import { getSnapshot } from '../db/repositories/snapshots';
import { AppError } from '../errors';
import { detectAnomalies } from '../finance/anomalies';
import { buildCashPosition, aggregateMetrics, buildPnlRows } from '../finance/comparisons';
import { evaluateDataQuality } from '../finance/data-quality';
import { computeKpis } from '../finance/kpi';
import { CONTRIBUTION_LABEL, rankStores } from '../finance/locations';
import { buildExpenseAnalysis } from '../finance/metrics';
import { pctChange, round2, safeDivide } from '../finance/math';
import { isUncategorizedAccount } from '../finance/transaction-review';
import type { MonthlyMetrics } from '../finance/types';
import { flattenReport, summaryByLabel } from '../qbo/parse';
import type { QboReport } from '../qbo/report-types';
import {
  addMonths,
  monthLabel,
  priorMonth as priorMonthOf,
  priorYearToDate,
  sameMonthLastYear as sameMonthLastYearOf,
  trailingMonths,
  yearToDate,
  type Period,
} from '../util/dates';
import { formatCurrency, formatPercent, formatPoints } from '../util/format';
import type { HeadlineMetric, ReportPayload, TrendPoint, VendorSpendRow, BalanceSheetRow } from './types';

/**
 * Builds the complete, deterministic report payload for one month.
 *
 * The AI layer runs *after* this and may only reference numbers that appear
 * here. Nothing in this function calls a language model.
 */
export async function buildReportPayload(input: {
  companyId: string;
  period: Period;
  today?: Date;
}): Promise<ReportPayload> {
  const { companyId, period } = input;

  const company = await getCompany(companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const metrics = await getMonthlyMetrics(companyId, period);
  if (!metrics) {
    throw new AppError(
      'QBO_EMPTY_PERIOD',
      `No financial data is stored for ${monthLabel(period)}. Run a sync for this period first.`,
    );
  }

  const prior = priorMonthOf(period);
  const lastYear = sameMonthLastYearOf(period);
  const ytd = yearToDate(period, company.fiscalYearStartMonth);
  const pytd = priorYearToDate(period, company.fiscalYearStartMonth);
  const t12Periods = trailingMonths(period, 12);

  const [priorMetrics, lastYearMetrics] = await Promise.all([
    getMonthlyMetrics(companyId, prior),
    getMonthlyMetrics(companyId, lastYear),
  ]);

  const [ytdRows, pytdRows, t12Rows] = await Promise.all([
    getMetricsRange(companyId, ytd.start, period.start),
    getMetricsRange(companyId, pytd.start, addMonths(period, -12).start),
    getMetricsRange(companyId, t12Periods[0]?.start ?? period.start, period.start),
  ]);

  const ytdMetrics = aggregateMetrics(ytdRows, ytd);
  const pytdMetrics = aggregateMetrics(pytdRows, pytd);
  const t12Metrics = aggregateMetrics(t12Rows, {
    start: t12Periods[0]?.start ?? period.start,
    end: period.end,
  });

  const kpis = computeKpis({
    current: metrics,
    priorMonth: priorMetrics,
    sameMonthLastYear: lastYearMetrics,
    trailing12: t12Rows,
  });

  // --- category totals for expense analysis & anomalies --------------------
  const categoryRows = await categoryTotalsByPeriod(
    companyId,
    t12Periods[0]?.start ?? period.start,
    period.start,
  );
  const byPeriod = new Map<string, Map<string, number>>();
  for (const row of categoryRows) {
    const bucket = byPeriod.get(row.periodStart) ?? new Map<string, number>();
    if (row.categoryKey) bucket.set(row.categoryKey, row.amount);
    byPeriod.set(row.periodStart, bucket);
  }
  const currentCategories = byPeriod.get(period.start) ?? new Map<string, number>();
  const priorCategories = byPeriod.get(prior.start) ?? null;
  const trailingCategories = t12Periods
    .filter((p) => p.start !== period.start)
    .map((p) => byPeriod.get(p.start) ?? new Map<string, number>());

  const expenseAnalysis = buildExpenseAnalysis({
    current: currentCategories,
    previous: priorCategories,
    trailing: trailingCategories,
    revenue: metrics.netSales,
    materialityAmount: company.materialityAmount,
    materialityPct: company.materialityPct,
  });

  // --- aging ---------------------------------------------------------------
  const [arAging, apAging, priorAr, priorAp] = await Promise.all([
    getAging(companyId, 'receivable', period.end),
    getAging(companyId, 'payable', period.end),
    getAging(companyId, 'receivable', prior.end),
    getAging(companyId, 'payable', prior.end),
  ]);

  // --- vendors -------------------------------------------------------------
  const [vendorCurrent, vendorPrior, vendorYtdRows, newVendors] = await Promise.all([
    getVendorSpend(companyId, period),
    getVendorSpend(companyId, prior),
    getVendorSpendRange(companyId, ytd.start, period.start),
    newVendorsInPeriod(companyId, period),
  ]);
  const ytdByVendor = new Map<string, number>();
  for (const row of vendorYtdRows) {
    ytdByVendor.set(row.vendorName, round2((ytdByVendor.get(row.vendorName) ?? 0) + row.amount));
  }
  const priorByVendor = new Map(vendorPrior.map((v) => [v.vendorName, v.amount]));
  const vendorSpend: VendorSpendRow[] = vendorCurrent.slice(0, 20).map((v) => {
    const previous = priorByVendor.get(v.vendorName) ?? null;
    const changeAmount = previous === null ? null : round2(v.amount - previous);
    const changePct = previous === null ? null : pctChange(v.amount, previous);
    return {
      vendorName: v.vendorName,
      current: v.amount,
      previous,
      changeAmount,
      changePct,
      yearToDate: ytdByVendor.get(v.vendorName) ?? v.amount,
      flagged:
        (changePct !== null && changePct >= 0.5 && (changeAmount ?? 0) >= company.materialityAmount) ||
        newVendors.some((n) => n.vendorName === v.vendorName && n.amount >= company.materialityAmount),
    };
  });

  // --- stores --------------------------------------------------------------
  const [storeCurrent, storePrior, storeLastYear] = await Promise.all([
    getLocationMetrics(companyId, period),
    getLocationMetrics(companyId, prior),
    getLocationMetrics(companyId, lastYear),
  ]);
  const stores = rankStores(storeCurrent, storePrior, storeLastYear);
  const storeDimension: 'location' | 'class' | 'none' =
    storeCurrent[0]?.dimension ?? (company.trackingDimension === 'class' ? 'class' : 'none');

  // --- cash flow (only if QuickBooks provided the statement) ---------------
  const cashFlowSnapshot = await getSnapshot<QboReport>(companyId, 'CashFlow', period);
  let cashFlow: { operating: number | null; investing: number | null; financing: number | null } | null = null;
  if (cashFlowSnapshot) {
    const flat = flattenReport(cashFlowSnapshot.payload);
    cashFlow = {
      operating: summaryByLabel(flat, 'Net cash provided by operating activities'),
      investing: summaryByLabel(flat, 'Net cash provided by investing activities'),
      financing: summaryByLabel(flat, 'Net cash provided by financing activities'),
    };
  }
  const cashPosition = buildCashPosition({ current: metrics, previous: priorMetrics, cashFlow });

  // --- anomalies -----------------------------------------------------------
  const accountRows = await getAccountMetrics(companyId, period);
  const uncategorizedBalances = accountRows
    .filter((r) => isUncategorizedAccount(r.accountName) && Math.abs(r.amount) > 0)
    .map((r) => ({ accountName: r.accountName, amount: r.amount }));

  const transactions = await listTransactions(companyId, period, 500);
  const duplicates = await duplicateCandidates(companyId, period, company.materialityAmount);
  const transactionHistory = await amountStatsByType(companyId, period.start, 12);
  const thresholds = await listThresholds(companyId);

  const anomalies = detectAnomalies({
    current: metrics,
    priorMonth: priorMetrics,
    sameMonthLastYear: lastYearMetrics,
    trailing: t12Rows,
    categoryTotals: currentCategories,
    priorCategoryTotals: priorCategories,
    trailingCategoryTotals: trailingCategories,
    vendorSpend: vendorCurrent,
    priorVendorSpend: vendorPrior,
    newVendors,
    duplicates,
    arAging,
    priorArAging: priorAr,
    apAging,
    priorApAging: priorAp,
    uncategorizedBalances,
    largeTransactions: transactions.slice(0, 60).map((t) => ({
      description: `${t.txnType} ${t.entityName ?? ''}`.trim(),
      amount: t.amount,
      date: t.txnDate,
      txnType: t.txnType,
    })),
    transactionHistoryByType: transactionHistory,
    thresholdOverrides: thresholds,
    materialityAmount: company.materialityAmount,
    materialityPct: company.materialityPct,
  });

  // --- data quality --------------------------------------------------------
  const connection = await getConnectionForCompany(companyId);
  const [unmappedCount, inventory, dimensionCoverage] = await Promise.all([
    countUnmappedExpenseAccounts(companyId),
    inventorySummary(companyId),
    missingDimensionCount(companyId, period, storeDimension === 'class' ? 'class' : 'location'),
  ]);

  const quality = evaluateDataQuality({
    period,
    metrics,
    expectedCompanyName: company.name,
    connectedCompanyName: connection?.companyName ?? null,
    unmappedExpenseAccountCount: unmappedCount,
    uncategorizedBalances,
    requireLocationData: storeDimension !== 'none',
    locationRowCount: storeCurrent.length,
    negativeInventoryItems: inventory.negativeQtyItems,
    duplicateSnapshotCount: 0,
    oldReceivables90Plus: arAging?.total.days90Plus ?? null,
    oldPayables90Plus: apAging?.total.days90Plus ?? null,
    missingDimension: dimensionCoverage,
    today: input.today,
  });

  // --- presentation --------------------------------------------------------
  const branding = await getBranding(companyId);
  const companyName = branding.businessName ?? company.name;

  const headline = buildHeadline(metrics, priorMetrics, lastYearMetrics);
  const trends = buildTrends(t12Rows);
  const observations = buildObservations({
    metrics,
    priorMetrics,
    lastYearMetrics,
    ytdMetrics,
    pytdMetrics,
    anomalies,
    cashPosition,
    stores,
  });

  const balanceSheetRows = buildBalanceSheetRows(metrics, priorMetrics);

  return {
    version: 1,
    companyId,
    companyName,
    currency: company.currencyCode,
    period,
    periodLabel: monthLabel(period),
    generatedAt: new Date().toISOString(),
    dataThrough: period.end,
    sourceSystem: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
    metrics,
    comparisons: {
      priorMonth: priorMetrics,
      sameMonthLastYear: lastYearMetrics,
      yearToDate: ytdMetrics,
      priorYearToDate: pytdMetrics,
      trailing12: t12Metrics,
    },
    kpis,
    headline,
    pnlRows: buildPnlRows(metrics, priorMetrics, lastYearMetrics),
    expenseAnalysis,
    balanceSheetRows,
    cashPosition,
    arAging,
    apAging,
    topOverdueReceivables: (arAging?.entities ?? [])
      .filter((e) => e.days31to60 + e.days61to90 + e.days90Plus > 0)
      .sort((a, b) => b.days31to60 + b.days61to90 + b.days90Plus - (a.days31to60 + a.days61to90 + a.days90Plus))
      .slice(0, 10)
      .map((e) => ({ name: e.entityName, amount: e.total, over90: e.days90Plus })),
    topPayables: (apAging?.entities ?? [])
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((e) => ({ name: e.entityName, amount: e.total, over90: e.days90Plus })),
    vendorSpend,
    stores,
    storeDimension,
    storeContributionLabel: CONTRIBUTION_LABEL,
    storeNote:
      storeDimension === 'none'
        ? 'This QuickBooks company does not use Locations or Classes, so store-level results are not available.'
        : 'Shared corporate overhead is not allocated to individual stores. Figures below are store contribution before corporate overhead.',
    trends,
    anomalies,
    insights: [],
    observations,
    executiveSummary: null,
    dataQuality: {
      checks: quality.checks,
      confidence: quality.confidence,
      reasons: quality.reasons,
    },
  };
}

function buildHeadline(
  m: MonthlyMetrics,
  prior: MonthlyMetrics | null,
  lastYear: MonthlyMetrics | null,
): HeadlineMetric[] {
  const money = (
    key: string,
    label: string,
    pick: (x: MonthlyMetrics) => number | null,
  ): HeadlineMetric => {
    const current = pick(m);
    const previous = prior ? pick(prior) : null;
    const ly = lastYear ? pick(lastYear) : null;
    return {
      key,
      label,
      value: current,
      format: 'currency',
      changeAmount: current !== null && previous !== null ? round2(current - previous) : null,
      changePct: current !== null && previous !== null ? pctChange(current, previous) : null,
      changePoints: null,
      yoyPct: current !== null && ly !== null ? pctChange(current, ly) : null,
      comparisonLabel: 'vs prior month',
    };
  };

  const ratio = (
    key: string,
    label: string,
    pick: (x: MonthlyMetrics) => number | null,
  ): HeadlineMetric => {
    const current = pick(m);
    const previous = prior ? pick(prior) : null;
    const ly = lastYear ? pick(lastYear) : null;
    return {
      key,
      label,
      value: current,
      format: 'percent',
      changeAmount: null,
      changePct: null,
      changePoints: current !== null && previous !== null ? current - previous : null,
      yoyPct: current !== null && ly !== null ? current - ly : null,
      comparisonLabel: 'vs prior month',
    };
  };

  return [
    money('revenue', 'Revenue', (x) => x.netSales),
    money('gross_profit', 'Gross Profit', (x) => x.grossProfit),
    ratio('gross_margin', 'Gross Margin', (x) => x.grossMargin),
    money('operating_expenses', 'Operating Expenses', (x) => x.operatingExpenses),
    money('net_income', 'Net Income', (x) => x.netIncome),
    ratio('net_margin', 'Net Margin', (x) => x.netMargin),
    money('cash', 'Cash', (x) => x.cash),
    money('ar', 'Accounts Receivable', (x) => x.accountsReceivable),
    money('ap', 'Accounts Payable', (x) => x.accountsPayable),
  ];
}

function buildTrends(rows: MonthlyMetrics[]): TrendPoint[] {
  return rows.map((m) => ({
    period: m.period.start,
    label: monthLabel(m.period, 'short'),
    revenue: m.netSales,
    grossProfit: m.grossProfit,
    grossMargin: m.grossMargin,
    netIncome: m.netIncome,
    operatingExpenses: m.operatingExpenses,
    cash: m.cash,
    accountsReceivable: m.accountsReceivable,
    accountsPayable: m.accountsPayable,
    payrollPctRevenue: safeDivide(m.payrollExpense, m.netSales),
    advertisingPctRevenue: safeDivide(m.advertisingExpense, m.netSales),
  }));
}

function buildBalanceSheetRows(
  m: MonthlyMetrics,
  prior: MonthlyMetrics | null,
): BalanceSheetRow[] {
  const row = (
    key: string,
    label: string,
    pick: (x: MonthlyMetrics) => number | null,
    emphasis: BalanceSheetRow['emphasis'] = 'normal',
  ): BalanceSheetRow => {
    const current = pick(m);
    const previous = prior ? pick(prior) : null;
    return {
      key,
      label,
      current,
      previous,
      changeAmount: current !== null && previous !== null ? round2(current - previous) : null,
      emphasis,
    };
  };

  return [
    row('cash', 'Cash', (x) => x.cash),
    row('ar', 'Accounts Receivable', (x) => x.accountsReceivable),
    row('inventory', 'Inventory', (x) => x.inventoryValue),
    row('other_ca', 'Other Current Assets', (x) => x.otherCurrentAssets),
    row('total_ca', 'Total Current Assets', (x) => x.currentAssets, 'subtotal'),
    row('fixed', 'Fixed Assets', (x) => x.fixedAssets),
    row('total_assets', 'Total Assets', (x) => x.totalAssets, 'total'),
    row('ap', 'Accounts Payable', (x) => x.accountsPayable),
    row('cc', 'Credit Cards', (x) => x.creditCards),
    row('std', 'Short-Term Debt', (x) => x.shortTermDebt),
    row('total_cl', 'Total Current Liabilities', (x) => x.currentLiabilities, 'subtotal'),
    row('ltd', 'Long-Term Debt', (x) => x.longTermDebt),
    row('total_liab', 'Total Liabilities', (x) => x.totalLiabilities, 'total'),
    row('equity', 'Equity', (x) => x.equity, 'total'),
  ];
}

/**
 * Deterministic executive observations.
 *
 * These are written from the numbers, not by a model, and are used both as the
 * fallback narrative when AI is unavailable and as grounding context when it is.
 */
function buildObservations(input: {
  metrics: MonthlyMetrics;
  priorMetrics: MonthlyMetrics | null;
  lastYearMetrics: MonthlyMetrics | null;
  ytdMetrics: MonthlyMetrics | null;
  pytdMetrics: MonthlyMetrics | null;
  anomalies: ReturnType<typeof detectAnomalies>;
  cashPosition: ReturnType<typeof buildCashPosition>;
  stores: ReturnType<typeof rankStores>;
}): string[] {
  const { metrics: m, priorMetrics: prior, lastYearMetrics: ly, cashPosition } = input;
  const out: string[] = [];

  const momPct = prior ? pctChange(m.netSales, prior.netSales) : null;
  const yoyPct = ly ? pctChange(m.netSales, ly.netSales) : null;
  out.push(
    `Revenue was ${formatCurrency(m.netSales)}${momPct !== null ? `, ${momPct >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(momPct))} from ${formatCurrency(prior?.netSales ?? 0)} last month` : ''}${yoyPct !== null ? ` and ${yoyPct >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(yoyPct))} year over year` : ''}.`,
  );

  if (m.grossMargin !== null) {
    const priorMargin = prior?.grossMargin ?? null;
    if (priorMargin !== null) {
      const points = m.grossMargin - priorMargin;
      const impact = round2(m.netSales * points);
      out.push(
        `Gross profit was ${formatCurrency(m.grossProfit)} at a ${formatPercent(m.grossMargin)} margin, ${points >= 0 ? 'up' : 'down'} ${formatPoints(Math.abs(points))} from ${formatPercent(priorMargin)}. Holding last month's margin would have produced ${formatCurrency(Math.abs(impact))} ${points >= 0 ? 'less' : 'more'} gross profit.`,
      );
    } else {
      out.push(`Gross profit was ${formatCurrency(m.grossProfit)} at a ${formatPercent(m.grossMargin)} margin.`);
    }
  }

  if (prior) {
    const opexPct = pctChange(m.operatingExpenses, prior.operatingExpenses);
    if (opexPct !== null && momPct !== null) {
      out.push(
        `Operating expenses of ${formatCurrency(m.operatingExpenses)} changed ${formatPercent(opexPct, 1, { signed: true })} against revenue ${formatPercent(momPct, 1, { signed: true })}, so expenses grew ${opexPct > momPct ? 'faster' : 'slower'} than revenue.`,
      );
    }
  }

  out.push(
    `Net income was ${formatCurrency(m.netIncome)}${m.netMargin !== null ? `, a ${formatPercent(m.netMargin)} net margin` : ''}.`,
  );

  if (cashPosition.netChange !== null) {
    const direction = cashPosition.netChange >= 0 ? 'increased' : 'declined';
    const contrast =
      cashPosition.netChange < 0 && m.netIncome > 0
        ? ' despite positive net income, indicating cash was absorbed elsewhere on the balance sheet (inventory, receivables, debt repayment or owner distributions)'
        : '';
    out.push(
      `Cash ${direction} ${formatCurrency(Math.abs(cashPosition.netChange))} during the month to ${formatCurrency(cashPosition.endingCash)}${contrast}.`,
    );
  }

  const topStore = input.stores[0];
  const worstStore = input.stores[input.stores.length - 1];
  if (topStore && worstStore && input.stores.length > 1) {
    out.push(
      `${topStore.dimensionName} led on contribution margin at ${formatPercent(topStore.contributionMargin)} on ${formatCurrency(topStore.netSales)} of revenue, while ${worstStore.dimensionName} trailed at ${formatPercent(worstStore.contributionMargin)}. These are store contributions before corporate overhead.`,
    );
  }

  // Surface the most serious alert, skipping any whose ground the observations
  // above already covered -- repeating the cash line reads as padding.
  const covered = new Set(['Revenue', 'Margin', 'Cash']);
  const topAnomaly = input.anomalies.find(
    (a) => (a.severity === 'CRITICAL' || a.severity === 'IMPORTANT') && !covered.has(a.category),
  );
  if (topAnomaly) out.push(`${topAnomaly.title}. ${topAnomaly.detail}`);

  if (input.ytdMetrics && input.pytdMetrics) {
    const ytdPct = pctChange(input.ytdMetrics.netSales, input.pytdMetrics.netSales);
    if (ytdPct !== null) {
      out.push(
        `Year to date, revenue of ${formatCurrency(input.ytdMetrics.netSales)} is ${formatPercent(ytdPct, 1, { signed: true })} against ${formatCurrency(input.pytdMetrics.netSales)} in the same period last year.`,
      );
    }
  }

  return out.slice(0, 7);
}
