import type { MonthlyMetrics } from '@/lib/finance/types';
import { monthPeriodOf, type Period } from '@/lib/util/dates';

/**
 * Builds a complete MonthlyMetrics row from a handful of overrides.
 *
 * Edge-case suites need months that a healthy demo seed never produces —
 * zero revenue, refunds larger than gross sales, a missing balance sheet.
 * Everything not named defaults to zero, so each test states only the values
 * its scenario is actually about.
 */
export function metricsFixture(
  companyId: string,
  periodKey: string,
  overrides: Partial<MonthlyMetrics> = {},
): MonthlyMetrics {
  const period: Period = monthPeriodOf(`${periodKey}-01`);
  return {
    companyId,
    period,
    accountingMethod: 'Accrual',
    grossSales: 0, discounts: 0, refunds: 0, netSales: 0,
    cogs: 0, grossProfit: 0, grossMargin: null,
    operatingExpenses: 0, payrollExpense: 0, advertisingExpense: 0, rentExpense: 0,
    deliveryExpense: 0, freightExpense: 0, warehouseExpense: 0, financingFees: 0,
    merchantFees: 0, bankFees: 0, interestExpense: 0, utilitiesExpense: 0,
    insuranceExpense: 0, repairsExpense: 0, vehicleExpense: 0, professionalFees: 0,
    softwareExpense: 0, taxesExpense: 0, otherOpex: 0,
    netOperatingIncome: 0, otherIncome: 0, otherExpense: 0, netIncome: 0, netMargin: null,
    cash: null, accountsReceivable: null, accountsPayable: null, inventoryValue: null,
    otherCurrentAssets: null, currentAssets: null, fixedAssets: null, totalAssets: null,
    creditCards: null, shortTermDebt: null, longTermDebt: null,
    currentLiabilities: null, totalLiabilities: null, equity: null,
    unmappedOpexAmount: 0, unmappedOpexPct: 0, balanceSheetBalanced: null,
    sourceSnapshotIds: [],
    computedAt: new Date(0).toISOString(),
    ...overrides,
  };
}
