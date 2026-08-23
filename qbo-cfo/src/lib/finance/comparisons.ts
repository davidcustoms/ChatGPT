import { absChange, pctChange, round2, safeDivide } from './math';
import type { Delta, MonthlyMetrics } from './types';
import type { Period } from '../util/dates';

/** Period-over-period comparison helpers used by the P&L table and dashboard. */

export function delta(current: number, previous: number | null | undefined): Delta {
  return {
    current: round2(current),
    previous: previous === null || previous === undefined ? null : round2(previous),
    changeAmount: absChange(current, previous),
    changePct: pctChange(current, previous),
  };
}

export interface PnlRow {
  key: string;
  label: string;
  /** Percentage rows (margins) render differently from money rows. */
  kind: 'money' | 'percent';
  emphasis?: 'total' | 'subtotal' | 'normal';
  current: number | null;
  previous: number | null;
  changeAmount: number | null;
  changePct: number | null;
  lastYear: number | null;
  yoyPct: number | null;
}

function moneyRow(
  key: string,
  label: string,
  pick: (m: MonthlyMetrics) => number,
  current: MonthlyMetrics,
  previous: MonthlyMetrics | null,
  lastYear: MonthlyMetrics | null,
  emphasis: PnlRow['emphasis'] = 'normal',
): PnlRow {
  const cur = pick(current);
  const prev = previous ? pick(previous) : null;
  const ly = lastYear ? pick(lastYear) : null;
  return {
    key,
    label,
    kind: 'money',
    emphasis,
    current: cur,
    previous: prev,
    changeAmount: absChange(cur, prev),
    changePct: pctChange(cur, prev),
    lastYear: ly,
    yoyPct: pctChange(cur, ly),
  };
}

function percentRow(
  key: string,
  label: string,
  pick: (m: MonthlyMetrics) => number | null,
  current: MonthlyMetrics,
  previous: MonthlyMetrics | null,
  lastYear: MonthlyMetrics | null,
): PnlRow {
  const cur = pick(current);
  const prev = previous ? pick(previous) : null;
  const ly = lastYear ? pick(lastYear) : null;
  return {
    key,
    label,
    kind: 'percent',
    emphasis: 'normal',
    current: cur,
    previous: prev,
    // For margins the meaningful change is in percentage points, carried in changeAmount.
    changeAmount: cur !== null && prev !== null ? cur - prev : null,
    changePct: null,
    lastYear: ly,
    yoyPct: null,
  };
}

/** The management P&L exactly as it appears in section B of the report. */
export function buildPnlRows(
  current: MonthlyMetrics,
  previous: MonthlyMetrics | null,
  lastYear: MonthlyMetrics | null,
): PnlRow[] {
  return [
    moneyRow('gross_sales', 'Revenue', (m) => m.grossSales, current, previous, lastYear),
    moneyRow('discounts', 'Discounts', (m) => m.discounts, current, previous, lastYear),
    moneyRow('refunds', 'Returns', (m) => m.refunds, current, previous, lastYear),
    moneyRow('net_sales', 'Net Revenue', (m) => m.netSales, current, previous, lastYear, 'subtotal'),
    moneyRow('cogs', 'COGS', (m) => m.cogs, current, previous, lastYear),
    moneyRow('gross_profit', 'Gross Profit', (m) => m.grossProfit, current, previous, lastYear, 'subtotal'),
    percentRow('gross_margin', 'Gross Margin', (m) => m.grossMargin, current, previous, lastYear),
    moneyRow('opex', 'Operating Expenses', (m) => m.operatingExpenses, current, previous, lastYear),
    moneyRow('operating_income', 'Operating Income', (m) => m.netOperatingIncome, current, previous, lastYear, 'subtotal'),
    moneyRow(
      'other',
      'Other Income / (Expense)',
      (m) => round2(m.otherIncome - m.otherExpense),
      current,
      previous,
      lastYear,
    ),
    moneyRow('net_income', 'Net Income', (m) => m.netIncome, current, previous, lastYear, 'total'),
    percentRow('net_margin', 'Net Margin', (m) => m.netMargin, current, previous, lastYear),
  ];
}

/** Aggregates a set of monthly metrics into one period total (YTD, T12, ...). */
export function aggregateMetrics(rows: MonthlyMetrics[], period: Period): MonthlyMetrics | null {
  if (rows.length === 0) return null;
  const first = rows[0] as MonthlyMetrics;
  const last = rows[rows.length - 1] as MonthlyMetrics;
  const total = <K extends keyof MonthlyMetrics>(key: K): number =>
    round2(rows.reduce((acc, r) => acc + ((r[key] as number) ?? 0), 0));

  const netSales = total('netSales');
  const grossProfit = total('grossProfit');
  const netIncome = total('netIncome');

  return {
    companyId: first.companyId,
    period,
    grossSales: total('grossSales'),
    discounts: total('discounts'),
    refunds: total('refunds'),
    netSales,
    cogs: total('cogs'),
    grossProfit,
    grossMargin: safeDivide(grossProfit, netSales),
    operatingExpenses: total('operatingExpenses'),
    payrollExpense: total('payrollExpense'),
    advertisingExpense: total('advertisingExpense'),
    rentExpense: total('rentExpense'),
    deliveryExpense: total('deliveryExpense'),
    freightExpense: total('freightExpense'),
    warehouseExpense: total('warehouseExpense'),
    financingFees: total('financingFees'),
    merchantFees: total('merchantFees'),
    bankFees: total('bankFees'),
    interestExpense: total('interestExpense'),
    utilitiesExpense: total('utilitiesExpense'),
    insuranceExpense: total('insuranceExpense'),
    repairsExpense: total('repairsExpense'),
    vehicleExpense: total('vehicleExpense'),
    professionalFees: total('professionalFees'),
    softwareExpense: total('softwareExpense'),
    taxesExpense: total('taxesExpense'),
    otherOpex: total('otherOpex'),
    netOperatingIncome: total('netOperatingIncome'),
    otherIncome: total('otherIncome'),
    otherExpense: total('otherExpense'),
    netIncome,
    netMargin: safeDivide(netIncome, netSales),
    // Balance-sheet values are point-in-time: carry the closing month's values.
    cash: last.cash,
    accountsReceivable: last.accountsReceivable,
    accountsPayable: last.accountsPayable,
    inventoryValue: last.inventoryValue,
    otherCurrentAssets: last.otherCurrentAssets,
    currentAssets: last.currentAssets,
    fixedAssets: last.fixedAssets,
    totalAssets: last.totalAssets,
    creditCards: last.creditCards,
    shortTermDebt: last.shortTermDebt,
    longTermDebt: last.longTermDebt,
    currentLiabilities: last.currentLiabilities,
    totalLiabilities: last.totalLiabilities,
    equity: last.equity,
    unmappedOpexAmount: total('unmappedOpexAmount'),
    unmappedOpexPct: safeDivide(total('unmappedOpexAmount'), total('operatingExpenses')) ?? 0,
    balanceSheetBalanced: last.balanceSheetBalanced,
    sourceSnapshotIds: rows.flatMap((r) => r.sourceSnapshotIds),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Cash movement for the period.
 *
 * QuickBooks' Statement of Cash Flows is not available for every company. When
 * it is missing we report only what is verifiable -- beginning cash, ending
 * cash and the net movement -- and leave the operating/investing/financing
 * split null rather than inventing a split.
 */
export interface CashPosition {
  beginningCash: number | null;
  endingCash: number | null;
  netChange: number | null;
  operating: number | null;
  investing: number | null;
  financing: number | null;
  /** True when the operating/investing/financing split came from QuickBooks. */
  cashFlowStatementAvailable: boolean;
  note: string;
}

export function buildCashPosition(input: {
  current: MonthlyMetrics;
  previous: MonthlyMetrics | null;
  cashFlow?: { operating: number | null; investing: number | null; financing: number | null } | null;
}): CashPosition {
  const beginningCash = input.previous?.cash ?? null;
  const endingCash = input.current.cash ?? null;
  const netChange =
    beginningCash !== null && endingCash !== null ? round2(endingCash - beginningCash) : null;
  const cf = input.cashFlow ?? null;
  const available = Boolean(
    cf && (cf.operating !== null || cf.investing !== null || cf.financing !== null),
  );
  return {
    beginningCash,
    endingCash,
    netChange,
    operating: cf?.operating ?? null,
    investing: cf?.investing ?? null,
    financing: cf?.financing ?? null,
    cashFlowStatementAvailable: available,
    note: available
      ? 'Operating, investing and financing activity as reported by QuickBooks.'
      : 'QuickBooks did not return a Statement of Cash Flows for this period, so only the verified beginning and ending cash balances are shown. The operating, investing and financing split is not estimated.',
  };
}
