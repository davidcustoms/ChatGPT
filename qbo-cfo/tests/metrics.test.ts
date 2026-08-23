import { describe, expect, it } from 'vitest';
import { computeMonthlyMetrics, buildExpenseAnalysis } from '@/lib/finance/metrics';
import { aggregateMetrics, buildCashPosition, buildPnlRows } from '@/lib/finance/comparisons';
import { computeKpis } from '@/lib/finance/kpi';
import { flattenReport } from '@/lib/qbo/parse';
import { parseBalanceSheet, parseProfitAndLoss } from '@/lib/qbo/statements';
import { monthPeriod } from '@/lib/util/dates';
import type { MonthlyMetrics } from '@/lib/finance/types';
import {
  MOCK_ACCOUNT_INDEX,
  MOCK_BALANCE_SHEET,
  MOCK_MAPPING,
  MOCK_PNL,
} from './fixtures/mock-reports';

const period = monthPeriod(2026, 6);

function compute(mapping = MOCK_MAPPING) {
  return computeMonthlyMetrics({
    companyId: 'test-company',
    period,
    pnl: parseProfitAndLoss(flattenReport(MOCK_PNL), MOCK_ACCOUNT_INDEX),
    balanceSheet: parseBalanceSheet(flattenReport(MOCK_BALANCE_SHEET), MOCK_ACCOUNT_INDEX),
    mapping,
  });
}

describe('monthly metric computation', () => {
  const { metrics, categoryTotals, netSalesVariance } = compute();

  it('separates gross sales from contra revenue', () => {
    expect(metrics.grossSales).toBe(500_000);
    expect(metrics.discounts).toBe(20_000);
    expect(metrics.refunds).toBe(10_000);
    expect(metrics.netSales).toBe(470_000);
  });

  it('ties net sales back to the QuickBooks total income figure', () => {
    expect(netSalesVariance).toBe(0);
  });

  it('computes gross profit and margin', () => {
    expect(metrics.grossProfit).toBe(211_500);
    expect(metrics.grossMargin).toBeCloseTo(0.45, 10);
  });

  it('routes mapped accounts to their management category buckets', () => {
    expect(metrics.payrollExpense).toBe(80_000);
    expect(metrics.advertisingExpense).toBe(30_000);
    expect(metrics.rentExpense).toBe(25_000);
    expect(metrics.interestExpense).toBe(6_500);
    expect(categoryTotals.get('cogs')).toBe(258_500);
  });

  it('tracks unmapped operating expense separately instead of guessing', () => {
    // Account 8 (Uncategorized Expense) is intentionally unmapped.
    expect(metrics.unmappedOpexAmount).toBe(15_000);
    expect(metrics.unmappedOpexPct).toBeCloseTo(0.1, 10);
    expect(metrics.otherOpex).toBe(0);
  });

  it('carries balance sheet values through', () => {
    expect(metrics.cash).toBe(150_000);
    expect(metrics.inventoryValue).toBe(480_000);
    expect(metrics.currentLiabilities).toBe(500_000);
    expect(metrics.balanceSheetBalanced).toBe(true);
  });

  it('reports net income and margin from the statement', () => {
    expect(metrics.netIncome).toBe(60_000);
    expect(metrics.netMargin).toBeCloseTo(0.12766, 5);
  });

  it('moves money between categories when the mapping changes', () => {
    // Re-map advertising to payroll: the totals must follow the mapping.
    const remapped = new Map(MOCK_MAPPING);
    remapped.set('6', 'payroll');
    const { metrics: after } = compute(remapped);
    expect(after.payrollExpense).toBe(110_000);
    expect(after.advertisingExpense).toBe(0);
    // Operating expenses are unchanged: only the attribution moved.
    expect(after.operatingExpenses).toBe(metrics.operatingExpenses);
  });

  it('treats every expense as unmapped when no mapping exists', () => {
    const { metrics: unmapped } = compute(new Map());
    expect(unmapped.unmappedOpexAmount).toBe(150_000);
    expect(unmapped.unmappedOpexPct).toBe(1);
    expect(unmapped.payrollExpense).toBe(0);
  });
});

function metricsFor(overrides: Partial<MonthlyMetrics>): MonthlyMetrics {
  const { metrics } = compute();
  return { ...metrics, ...overrides };
}

describe('period comparisons', () => {
  const current = metricsFor({});
  const prior = metricsFor({ netSales: 500_000, grossProfit: 225_000, grossMargin: 0.45, netIncome: 70_000, cash: 200_000 });
  const lastYear = metricsFor({ netSales: 400_000, netIncome: 40_000 });

  it('builds the management P&L with all comparison columns', () => {
    const rows = buildPnlRows(current, prior, lastYear);
    const revenue = rows.find((r) => r.key === 'net_sales');
    expect(revenue?.current).toBe(470_000);
    expect(revenue?.previous).toBe(500_000);
    expect(revenue?.changeAmount).toBe(-30_000);
    expect(revenue?.changePct).toBeCloseTo(-0.06, 10);
    expect(revenue?.lastYear).toBe(400_000);
    expect(revenue?.yoyPct).toBeCloseTo(0.175, 10);
  });

  it('expresses margin rows as points, not percentages', () => {
    const margin = buildPnlRows(current, prior, lastYear).find((r) => r.key === 'gross_margin');
    expect(margin?.kind).toBe('percent');
    expect(margin?.changePct).toBeNull();
    expect(margin?.changeAmount).toBeCloseTo(0, 10);
  });

  it('leaves comparisons null when the prior period is missing', () => {
    const rows = buildPnlRows(current, null, null);
    const revenue = rows.find((r) => r.key === 'net_sales');
    expect(revenue?.previous).toBeNull();
    expect(revenue?.changePct).toBeNull();
  });
});

describe('aggregating months into YTD and trailing periods', () => {
  const jan = metricsFor({ netSales: 100_000, grossProfit: 45_000, netIncome: 10_000, cash: 50_000 });
  const feb = metricsFor({ netSales: 120_000, grossProfit: 54_000, netIncome: 12_000, cash: 60_000 });

  it('sums flows and carries the closing balance sheet', () => {
    const ytd = aggregateMetrics([jan, feb], { start: '2026-01-01', end: '2026-02-28' });
    expect(ytd?.netSales).toBe(220_000);
    expect(ytd?.netIncome).toBe(22_000);
    // Balance-sheet values are point-in-time, so the closing month wins.
    expect(ytd?.cash).toBe(60_000);
  });

  it('recomputes margins on the aggregate rather than averaging them', () => {
    const ytd = aggregateMetrics([jan, feb], { start: '2026-01-01', end: '2026-02-28' });
    expect(ytd?.grossMargin).toBeCloseTo(99_000 / 220_000, 10);
  });

  it('returns null for an empty range', () => {
    expect(aggregateMetrics([], { start: '2026-01-01', end: '2026-01-31' })).toBeNull();
  });
});

describe('KPI engine', () => {
  const current = metricsFor({});
  const prior = metricsFor({ netSales: 500_000 });
  const lastYear = metricsFor({ netSales: 400_000 });
  const trailing = [prior, current];

  const kpis = computeKpis({ current, priorMonth: prior, sameMonthLastYear: lastYear, trailing12: trailing });

  it('computes growth rates', () => {
    expect(kpis.revenueGrowthMoM).toBeCloseTo(-0.06, 10);
    expect(kpis.revenueGrowthYoY).toBeCloseTo(0.175, 10);
  });

  it('computes expense ratios of revenue', () => {
    expect(kpis.payrollPctRevenue).toBeCloseTo(80_000 / 470_000, 10);
    expect(kpis.advertisingPctRevenue).toBeCloseTo(30_000 / 470_000, 10);
    expect(kpis.operatingExpenseRatio).toBeCloseTo(150_000 / 470_000, 10);
  });

  it('computes liquidity measures', () => {
    expect(kpis.currentRatio).toBeCloseTo(1.6, 10);
    expect(kpis.quickRatio).toBeCloseTo(0.64, 10);
    expect(kpis.workingCapital).toBe(300_000);
  });

  it('computes working-capital days on a 30-day convention', () => {
    expect(kpis.daysSalesOutstanding).toBeCloseTo((120_000 / 470_000) * 30, 2);
    expect(kpis.daysPayableOutstanding).toBeCloseTo((250_000 / 258_500) * 30, 2);
  });

  it('rolls trailing revenue windows', () => {
    expect(kpis.trailing12Revenue).toBe(970_000);
    expect(kpis.averageMonthlyRevenue).toBe(485_000);
  });

  it('returns null growth when there is no prior period', () => {
    const alone = computeKpis({ current, priorMonth: null, sameMonthLastYear: null, trailing12: [current] });
    expect(alone.revenueGrowthMoM).toBeNull();
    expect(alone.revenueGrowthYoY).toBeNull();
  });
});

describe('cash position', () => {
  it('reports only verified values when no cash flow statement exists', () => {
    const cash = buildCashPosition({
      current: metricsFor({ cash: 150_000 }),
      previous: metricsFor({ cash: 200_000 }),
      cashFlow: null,
    });
    expect(cash.beginningCash).toBe(200_000);
    expect(cash.endingCash).toBe(150_000);
    expect(cash.netChange).toBe(-50_000);
    // The operating/investing/financing split is never estimated.
    expect(cash.operating).toBeNull();
    expect(cash.investing).toBeNull();
    expect(cash.financing).toBeNull();
    expect(cash.cashFlowStatementAvailable).toBe(false);
    expect(cash.note).toMatch(/not estimated/i);
  });

  it('passes through a real cash flow statement', () => {
    const cash = buildCashPosition({
      current: metricsFor({ cash: 150_000 }),
      previous: metricsFor({ cash: 200_000 }),
      cashFlow: { operating: 30_000, investing: -60_000, financing: -20_000 },
    });
    expect(cash.cashFlowStatementAvailable).toBe(true);
    expect(cash.operating).toBe(30_000);
  });

  it('leaves the change null when the prior balance is unknown', () => {
    const cash = buildCashPosition({ current: metricsFor({ cash: 150_000 }), previous: null });
    expect(cash.beginningCash).toBeNull();
    expect(cash.netChange).toBeNull();
  });
});

describe('expense analysis', () => {
  const analysis = buildExpenseAnalysis({
    current: new Map([['payroll', 100_000], ['advertising', 52_841]]),
    previous: new Map([['payroll', 82_096], ['advertising', 38_245]]),
    trailing: [new Map([['advertising', 35_000]]), new Map([['advertising', 40_000]])],
    revenue: 470_000,
    materialityAmount: 1_000,
    materialityPct: 0.1,
  });

  it('ranks categories by current spend', () => {
    expect(analysis[0]?.categoryKey).toBe('payroll');
  });

  it('computes change, share of revenue and the trailing average', () => {
    const advertising = analysis.find((a) => a.categoryKey === 'advertising');
    expect(advertising?.changeAmount).toBe(14_596);
    expect(advertising?.changePct).toBeCloseTo(0.38164, 4);
    expect(advertising?.pctOfRevenue).toBeCloseTo(0.11243, 4);
    expect(advertising?.trailing12Average).toBe(37_500);
  });

  it('flags a change only when both materiality thresholds are met', () => {
    const advertising = analysis.find((a) => a.categoryKey === 'advertising');
    expect(advertising?.material).toBe(true);

    const small = buildExpenseAnalysis({
      current: new Map([['payroll', 100_500]]),
      previous: new Map([['payroll', 100_000]]),
      trailing: [],
      revenue: 470_000,
      materialityAmount: 1_000,
      materialityPct: 0.1,
    });
    // 500 dollars and 0.5% clears neither threshold.
    expect(small[0]?.material).toBe(false);
  });
});
