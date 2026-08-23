import { CATEGORY_BY_KEY } from './categories';
import type { AccountingMethod } from './basis';
import { round2, safeDivide } from './math';
import type { AccountAmount, MonthlyMetrics } from './types';
import type { ParsedBalanceSheet, ParsedProfitAndLoss } from '../qbo/statements';
import type { Period } from '../util/dates';

/**
 * Deterministic monthly metric computation.
 *
 * Inputs are a parsed QuickBooks P&L and Balance Sheet plus the owner's
 * approved account->category mapping. Nothing here consults an LLM, and every
 * output is reproducible from the stored snapshots.
 */

export interface ComputeInput {
  companyId: string;
  period: Period;
  /** The basis the source reports were pulled on. Stamped onto the result. */
  accountingMethod?: AccountingMethod;
  pnl: ParsedProfitAndLoss;
  balanceSheet: ParsedBalanceSheet | null;
  /** account qboId -> management category key (approved mappings only). */
  mapping: ReadonlyMap<string, string>;
  sourceSnapshotIds?: string[];
}

export interface ComputeResult {
  metrics: MonthlyMetrics;
  accountAmounts: AccountAmount[];
  categoryTotals: Map<string, number>;
  /** Difference between our category-derived net sales and QuickBooks' total income. */
  netSalesVariance: number;
}

/** Category key -> MonthlyMetrics field, for the named expense buckets. */
const CATEGORY_TO_FIELD: Record<string, keyof MonthlyMetrics> = {
  payroll: 'payrollExpense',
  advertising: 'advertisingExpense',
  rent: 'rentExpense',
  delivery: 'deliveryExpense',
  freight: 'freightExpense',
  warehouse: 'warehouseExpense',
  financing_fees: 'financingFees',
  merchant_processing: 'merchantFees',
  bank_fees: 'bankFees',
  interest: 'interestExpense',
  utilities: 'utilitiesExpense',
  insurance: 'insuranceExpense',
  repairs: 'repairsExpense',
  vehicles: 'vehicleExpense',
  professional_fees: 'professionalFees',
  software: 'softwareExpense',
  taxes: 'taxesExpense',
  other_opex: 'otherOpex',
};

export function computeMonthlyMetrics(input: ComputeInput): ComputeResult {
  const { pnl, balanceSheet, mapping, period, companyId } = input;

  const accountAmounts: AccountAmount[] = [];
  const categoryTotals = new Map<string, number>();
  const addCategory = (key: string, amount: number): void => {
    categoryTotals.set(key, round2((categoryTotals.get(key) ?? 0) + amount));
  };

  let grossSales = 0;
  let discounts = 0;
  let refunds = 0;
  let unmappedOpex = 0;

  for (const line of pnl.lines) {
    const categoryKey = line.accountQboId ? (mapping.get(line.accountQboId) ?? null) : null;
    accountAmounts.push({
      accountQboId: line.accountQboId ?? `__${line.accountName}`,
      accountName: line.accountName,
      classification:
        line.section === 'income' || line.section === 'other_income' ? 'Revenue' : 'Expense',
      categoryKey,
      amount: line.amount,
    });

    if (line.section === 'income') {
      if (categoryKey === 'discounts') {
        // Contra-revenue is stored positive: a -5,000 income line is 5,000 of discounts.
        discounts = round2(discounts - line.amount);
        addCategory('discounts', round2(-line.amount));
      } else if (categoryKey === 'returns') {
        refunds = round2(refunds - line.amount);
        addCategory('returns', round2(-line.amount));
      } else {
        grossSales = round2(grossSales + line.amount);
        addCategory('revenue', line.amount);
      }
      continue;
    }

    if (line.section === 'cogs') {
      addCategory(categoryKey ?? 'cogs', line.amount);
      continue;
    }

    if (line.section === 'expense') {
      if (categoryKey) addCategory(categoryKey, line.amount);
      else unmappedOpex = round2(unmappedOpex + line.amount);
      continue;
    }

    if (line.section === 'other_expense') {
      addCategory(categoryKey ?? 'other_expense', line.amount);
      continue;
    }

    if (line.section === 'other_income') {
      addCategory(categoryKey ?? 'other_income', line.amount);
    }
  }

  const netSales = round2(grossSales - discounts - refunds);
  // QuickBooks' own Total Income is the authority; a gap means our line-level
  // classification missed something and is surfaced as a data-quality signal.
  const netSalesVariance = round2(netSales - pnl.totalIncome);

  const cogs = pnl.totalCogs;
  const grossProfit = pnl.grossProfit;
  const operatingExpenses = pnl.totalExpenses;

  const cat = (key: string): number => categoryTotals.get(key) ?? 0;

  const metrics: MonthlyMetrics = {
    companyId,
    period,
    accountingMethod: input.accountingMethod ?? 'Accrual',
    grossSales,
    discounts,
    refunds,
    netSales,
    cogs,
    grossProfit,
    grossMargin: safeDivide(grossProfit, netSales),
    operatingExpenses,
    payrollExpense: 0,
    advertisingExpense: 0,
    rentExpense: 0,
    deliveryExpense: 0,
    freightExpense: 0,
    warehouseExpense: 0,
    financingFees: 0,
    merchantFees: 0,
    bankFees: 0,
    interestExpense: 0,
    utilitiesExpense: 0,
    insuranceExpense: 0,
    repairsExpense: 0,
    vehicleExpense: 0,
    professionalFees: 0,
    softwareExpense: 0,
    taxesExpense: 0,
    otherOpex: 0,
    netOperatingIncome: pnl.netOperatingIncome,
    otherIncome: pnl.totalOtherIncome,
    otherExpense: pnl.totalOtherExpense,
    netIncome: pnl.netIncome,
    netMargin: safeDivide(pnl.netIncome, netSales),
    cash: balanceSheet?.cash ?? null,
    accountsReceivable: balanceSheet?.accountsReceivable ?? null,
    accountsPayable: balanceSheet?.accountsPayable ?? null,
    inventoryValue: balanceSheet?.inventory ?? null,
    otherCurrentAssets: balanceSheet?.otherCurrentAssets ?? null,
    currentAssets: balanceSheet?.currentAssets ?? null,
    fixedAssets: balanceSheet?.fixedAssets ?? null,
    totalAssets: balanceSheet?.totalAssets ?? null,
    creditCards: balanceSheet?.creditCards ?? null,
    shortTermDebt: balanceSheet?.shortTermDebt ?? null,
    longTermDebt: balanceSheet?.longTermDebt ?? null,
    currentLiabilities: balanceSheet?.currentLiabilities ?? null,
    totalLiabilities: balanceSheet?.totalLiabilities ?? null,
    equity: balanceSheet?.equity ?? null,
    unmappedOpexAmount: unmappedOpex,
    unmappedOpexPct: safeDivide(unmappedOpex, operatingExpenses) ?? 0,
    balanceSheetBalanced: balanceSheet?.balanced ?? null,
    sourceSnapshotIds: input.sourceSnapshotIds ?? [],
    computedAt: new Date().toISOString(),
  };

  for (const [categoryKey, field] of Object.entries(CATEGORY_TO_FIELD)) {
    (metrics as unknown as Record<string, number>)[field] = cat(categoryKey);
  }

  return { metrics, accountAmounts, categoryTotals, netSalesVariance };
}

/** Expense categories ranked by current-month spend, for the report's section C. */
export interface ExpenseCategoryLine {
  categoryKey: string;
  label: string;
  current: number;
  previous: number | null;
  changeAmount: number | null;
  changePct: number | null;
  pctOfRevenue: number | null;
  trailing12Average: number | null;
  /** Set when the change clears the company's materiality thresholds. */
  material: boolean;
}

export function buildExpenseAnalysis(input: {
  current: Map<string, number>;
  previous: Map<string, number> | null;
  trailing: Array<Map<string, number>>;
  revenue: number;
  materialityAmount: number;
  materialityPct: number;
}): ExpenseCategoryLine[] {
  const expenseSections = new Set(['opex', 'cogs', 'other_expense']);
  const keys = new Set<string>();
  for (const key of input.current.keys()) keys.add(key);
  if (input.previous) for (const key of input.previous.keys()) keys.add(key);

  const lines: ExpenseCategoryLine[] = [];
  for (const key of keys) {
    const definition = CATEGORY_BY_KEY.get(key);
    const section = definition?.section ?? 'opex';
    if (!expenseSections.has(section)) continue;

    const current = input.current.get(key) ?? 0;
    const previous = input.previous ? (input.previous.get(key) ?? 0) : null;
    const changeAmount = previous === null ? null : round2(current - previous);
    const changePct =
      previous === null || previous === 0 ? null : (current - previous) / Math.abs(previous);
    const history = input.trailing
      .map((m) => m.get(key))
      .filter((v): v is number => typeof v === 'number');
    const trailing12Average = history.length ? round2(history.reduce((a, b) => a + b, 0) / history.length) : null;

    lines.push({
      categoryKey: key,
      label: definition?.label ?? key.replace(/_/g, ' '),
      current,
      previous,
      changeAmount,
      changePct,
      pctOfRevenue: safeDivide(current, input.revenue),
      trailing12Average,
      material:
        changeAmount !== null &&
        Math.abs(changeAmount) >= input.materialityAmount &&
        changePct !== null &&
        Math.abs(changePct) >= input.materialityPct,
    });
  }

  return lines.sort((a, b) => b.current - a.current);
}
