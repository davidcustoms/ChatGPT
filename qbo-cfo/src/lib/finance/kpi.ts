import {
  average,
  currentRatio,
  pctChange,
  quickRatio,
  round2,
  safeDivide,
  workingCapital,
} from './math';
import type { KpiSet, MonthlyMetrics } from './types';

/**
 * KPI engine. Everything derives from stored monthly metrics; when an input is
 * missing the KPI is `null` rather than zero, so the UI can show "N/M" instead
 * of implying a real value of zero.
 */

export function computeKpis(input: {
  current: MonthlyMetrics;
  priorMonth: MonthlyMetrics | null;
  sameMonthLastYear: MonthlyMetrics | null;
  trailing12: MonthlyMetrics[];
}): KpiSet {
  const { current, priorMonth, sameMonthLastYear, trailing12 } = input;
  const revenue = current.netSales;

  const trailingSlice = (n: number): MonthlyMetrics[] =>
    trailing12.slice(Math.max(0, trailing12.length - n));

  const sumRevenue = (rows: MonthlyMetrics[]): number | null =>
    rows.length ? round2(rows.reduce((a, m) => a + m.netSales, 0)) : null;

  const t3 = trailingSlice(3);
  const t6 = trailingSlice(6);
  const t12 = trailingSlice(12);

  const rollingRevenue = sumRevenue(t12);
  const rollingGrossProfit = t12.length
    ? round2(t12.reduce((a, m) => a + m.grossProfit, 0))
    : null;
  const rollingNetIncome = t12.length ? round2(t12.reduce((a, m) => a + m.netIncome, 0)) : null;

  // Working-capital cycle days use a 30-day month convention so the figure is
  // comparable across months of different lengths.
  const DAYS = 30;
  const dso =
    current.accountsReceivable !== null && revenue > 0
      ? round2((current.accountsReceivable / revenue) * DAYS)
      : null;
  const dpo =
    current.accountsPayable !== null && current.cogs > 0
      ? round2((current.accountsPayable / current.cogs) * DAYS)
      : null;
  const dio =
    current.inventoryValue !== null && current.cogs > 0
      ? round2((current.inventoryValue / current.cogs) * DAYS)
      : null;

  return {
    revenueGrowthMoM: priorMonth ? pctChange(revenue, priorMonth.netSales) : null,
    revenueGrowthYoY: sameMonthLastYear ? pctChange(revenue, sameMonthLastYear.netSales) : null,
    grossMargin: current.grossMargin,
    netMargin: current.netMargin,
    operatingExpenseRatio: safeDivide(current.operatingExpenses, revenue),
    payrollPctRevenue: safeDivide(current.payrollExpense, revenue),
    advertisingPctRevenue: safeDivide(current.advertisingExpense, revenue),
    rentPctRevenue: safeDivide(current.rentExpense, revenue),
    deliveryPctRevenue: safeDivide(current.deliveryExpense, revenue),
    merchantFeesPctRevenue: safeDivide(current.merchantFees, revenue),
    arPctRevenue: safeDivide(current.accountsReceivable, revenue),
    apPctRevenue: safeDivide(current.accountsPayable, revenue),
    currentRatio: currentRatio(current.currentAssets, current.currentLiabilities),
    quickRatio: quickRatio(current.currentAssets, current.inventoryValue, current.currentLiabilities),
    workingCapital: workingCapital(current.currentAssets, current.currentLiabilities),
    daysSalesOutstanding: dso,
    daysPayableOutstanding: dpo,
    daysInventoryOutstanding: dio,
    cashConversionCycle:
      dso !== null && dio !== null && dpo !== null ? round2(dso + dio - dpo) : null,
    averageMonthlyRevenue: average(t12.map((m) => m.netSales)),
    trailing3Revenue: sumRevenue(t3),
    trailing6Revenue: sumRevenue(t6),
    trailing12Revenue: rollingRevenue,
    rollingGrossMargin: safeDivide(rollingGrossProfit, rollingRevenue),
    rollingNetMargin: safeDivide(rollingNetIncome, rollingRevenue),
  };
}

/** Human-readable KPI descriptors used by the dashboard and the AI context. */
export const KPI_LABELS: Record<keyof KpiSet, { label: string; format: 'percent' | 'currency' | 'ratio' | 'days' }> = {
  revenueGrowthMoM: { label: 'Revenue growth (MoM)', format: 'percent' },
  revenueGrowthYoY: { label: 'Revenue growth (YoY)', format: 'percent' },
  grossMargin: { label: 'Gross margin', format: 'percent' },
  netMargin: { label: 'Net margin', format: 'percent' },
  operatingExpenseRatio: { label: 'Operating expense ratio', format: 'percent' },
  payrollPctRevenue: { label: 'Payroll % of revenue', format: 'percent' },
  advertisingPctRevenue: { label: 'Advertising % of revenue', format: 'percent' },
  rentPctRevenue: { label: 'Rent % of revenue', format: 'percent' },
  deliveryPctRevenue: { label: 'Delivery % of revenue', format: 'percent' },
  merchantFeesPctRevenue: { label: 'Merchant fees % of revenue', format: 'percent' },
  arPctRevenue: { label: 'A/R as % of revenue', format: 'percent' },
  apPctRevenue: { label: 'A/P as % of revenue', format: 'percent' },
  currentRatio: { label: 'Current ratio', format: 'ratio' },
  quickRatio: { label: 'Quick ratio', format: 'ratio' },
  workingCapital: { label: 'Working capital', format: 'currency' },
  daysSalesOutstanding: { label: 'Days sales outstanding', format: 'days' },
  daysPayableOutstanding: { label: 'Days payable outstanding', format: 'days' },
  daysInventoryOutstanding: { label: 'Days inventory outstanding', format: 'days' },
  cashConversionCycle: { label: 'Cash conversion cycle', format: 'days' },
  averageMonthlyRevenue: { label: 'Average monthly revenue (T12)', format: 'currency' },
  trailing3Revenue: { label: 'Trailing 3-month revenue', format: 'currency' },
  trailing6Revenue: { label: 'Trailing 6-month revenue', format: 'currency' },
  trailing12Revenue: { label: 'Trailing 12-month revenue', format: 'currency' },
  rollingGrossMargin: { label: 'Rolling 12-month gross margin', format: 'percent' },
  rollingNetMargin: { label: 'Rolling 12-month net margin', format: 'percent' },
};
