import { describe, expect, it } from 'vitest';
import { detectAnomalies, type DetectInput } from '@/lib/finance/anomalies';
import { RULE_DEFINITIONS, param, resolveThresholds, ruleEnabled } from '@/lib/finance/anomaly-rules';
import { monthPeriod } from '@/lib/util/dates';
import type { MonthlyMetrics } from '@/lib/finance/types';

function metrics(overrides: Partial<MonthlyMetrics> = {}): MonthlyMetrics {
  return {
    companyId: 'c',
    period: monthPeriod(2026, 8),
    grossSales: 500_000,
    discounts: 0,
    refunds: 0,
    netSales: 500_000,
    cogs: 275_000,
    grossProfit: 225_000,
    grossMargin: 0.45,
    operatingExpenses: 150_000,
    payrollExpense: 75_000,
    advertisingExpense: 25_000,
    rentExpense: 25_000,
    deliveryExpense: 0,
    freightExpense: 0,
    warehouseExpense: 0,
    financingFees: 0,
    merchantFees: 10_000,
    bankFees: 500,
    interestExpense: 0,
    utilitiesExpense: 0,
    insuranceExpense: 0,
    repairsExpense: 0,
    vehicleExpense: 0,
    professionalFees: 0,
    softwareExpense: 0,
    taxesExpense: 0,
    otherOpex: 0,
    netOperatingIncome: 75_000,
    otherIncome: 0,
    otherExpense: 0,
    netIncome: 75_000,
    netMargin: 0.15,
    cash: 200_000,
    accountsReceivable: 100_000,
    accountsPayable: 120_000,
    inventoryValue: 400_000,
    otherCurrentAssets: 0,
    currentAssets: 700_000,
    fixedAssets: 100_000,
    totalAssets: 800_000,
    creditCards: 0,
    shortTermDebt: 0,
    longTermDebt: 0,
    currentLiabilities: 400_000,
    totalLiabilities: 400_000,
    equity: 400_000,
    unmappedOpexAmount: 0,
    unmappedOpexPct: 0,
    balanceSheetBalanced: true,
    sourceSnapshotIds: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<DetectInput> = {}): DetectInput {
  return {
    current: metrics(),
    priorMonth: metrics(),
    sameMonthLastYear: metrics(),
    trailing: [],
    categoryTotals: new Map(),
    priorCategoryTotals: new Map(),
    trailingCategoryTotals: [],
    vendorSpend: [],
    priorVendorSpend: [],
    newVendors: [],
    duplicates: [],
    arAging: null,
    priorArAging: null,
    apAging: null,
    priorApAging: null,
    uncategorizedBalances: [],
    largeTransactions: [],
    materialityAmount: 1_000,
    materialityPct: 0.1,
    ...overrides,
  };
}

const keys = (out: ReturnType<typeof detectAnomalies>) => out.map((a) => a.ruleKey);

describe('threshold resolution', () => {
  it('starts from the documented defaults', () => {
    const t = resolveThresholds([]);
    expect(param(t, 'revenue_mom', 'pct', 0)).toBe(0.1);
    expect(param(t, 'revenue_yoy', 'pct', 0)).toBe(0.15);
    expect(param(t, 'gross_margin_shift', 'points', 0)).toBe(0.02);
    expect(param(t, 'expense_spike', 'pct', 0)).toBe(0.2);
    expect(param(t, 'expense_spike', 'amount', 0)).toBe(2_000);
    expect(param(t, 'cash_decline', 'pct', 0)).toBe(0.15);
  });

  it('applies per-company overrides on top of the defaults', () => {
    const t = resolveThresholds([{ ruleKey: 'revenue_mom', enabled: true, params: { pct: 0.25 } }]);
    expect(param(t, 'revenue_mom', 'pct', 0)).toBe(0.25);
    // Untouched rules keep their defaults.
    expect(param(t, 'revenue_yoy', 'pct', 0)).toBe(0.15);
  });

  it('can disable a rule entirely', () => {
    const t = resolveThresholds([{ ruleKey: 'revenue_mom', enabled: false, params: {} }]);
    expect(ruleEnabled(t, 'revenue_mom')).toBe(false);
  });

  it('exposes a parameter label for every parameter', () => {
    for (const rule of RULE_DEFINITIONS) {
      for (const name of Object.keys(rule.params)) {
        expect(rule.paramLabels[name]).toBeTruthy();
      }
    }
  });
});

describe('revenue rules', () => {
  it('fires above the month-over-month threshold and not below it', () => {
    const over = detectAnomalies(input({ current: metrics({ netSales: 560_000 }) }));
    expect(keys(over)).toContain('revenue_mom');

    const under = detectAnomalies(input({ current: metrics({ netSales: 520_000 }) }));
    expect(keys(under)).not.toContain('revenue_mom');
  });

  it('fires on the year-over-year threshold independently', () => {
    const out = detectAnomalies(
      input({
        current: metrics({ netSales: 500_000 }),
        priorMonth: metrics({ netSales: 500_000 }),
        sameMonthLastYear: metrics({ netSales: 400_000 }),
      }),
    );
    expect(keys(out)).toContain('revenue_yoy');
  });

  it('respects a raised threshold', () => {
    const out = detectAnomalies(
      input({
        current: metrics({ netSales: 560_000 }),
        thresholdOverrides: [{ ruleKey: 'revenue_mom', enabled: true, params: { pct: 0.5 } }],
      }),
    );
    expect(keys(out)).not.toContain('revenue_mom');
  });
});

describe('margin and ratio rules', () => {
  it('fires when gross margin moves more than the point threshold', () => {
    const out = detectAnomalies(
      input({ current: metrics({ grossMargin: 0.42 }), priorMonth: metrics({ grossMargin: 0.45 }) }),
    );
    const margin = out.find((a) => a.ruleKey === 'gross_margin_shift');
    expect(margin).toBeDefined();
    // Dollar impact of a 3-point move on 500,000 of revenue.
    expect(margin?.deltaAmount).toBeCloseTo(-15_000, 2);
  });

  it('does not fire on a one-point move', () => {
    const out = detectAnomalies(
      input({ current: metrics({ grossMargin: 0.44 }), priorMonth: metrics({ grossMargin: 0.45 }) }),
    );
    expect(keys(out)).not.toContain('gross_margin_shift');
  });

  it('fires when payroll grows as a share of revenue', () => {
    const out = detectAnomalies(
      input({
        current: metrics({ payrollExpense: 90_000 }),
        priorMonth: metrics({ payrollExpense: 75_000 }),
      }),
    );
    expect(keys(out)).toContain('payroll_ratio');
  });

  it('fires when advertising rises while revenue falls', () => {
    const out = detectAnomalies(
      input({
        current: metrics({ advertisingExpense: 35_000, netSales: 480_000 }),
        priorMonth: metrics({ advertisingExpense: 25_000, netSales: 500_000 }),
      }),
    );
    expect(keys(out)).toContain('ad_spend_divergence');
  });
});

describe('expense rules', () => {
  it('requires both the percentage and the dollar threshold', () => {
    const both = detectAnomalies(
      input({
        categoryTotals: new Map([['advertising', 52_841]]),
        priorCategoryTotals: new Map([['advertising', 38_245]]),
      }),
    );
    expect(keys(both)).toContain('expense_spike');

    // 40% increase but only 400 dollars: below the dollar threshold.
    const smallDollars = detectAnomalies(
      input({
        categoryTotals: new Map([['software', 1_400]]),
        priorCategoryTotals: new Map([['software', 1_000]]),
      }),
    );
    expect(keys(smallDollars)).not.toContain('expense_spike');
  });

  it('fires when a category exceeds its trailing average multiple', () => {
    const out = detectAnomalies(
      input({
        categoryTotals: new Map([['repairs', 12_000]]),
        priorCategoryTotals: new Map([['repairs', 11_500]]),
        trailingCategoryTotals: Array.from({ length: 6 }, () => new Map([['repairs', 8_000]])),
      }),
    );
    expect(keys(out)).toContain('expense_vs_trailing');
  });
});

describe('cash, aging and vendor rules', () => {
  it('fires on a material cash decline', () => {
    const out = detectAnomalies(
      input({ current: metrics({ cash: 150_000 }), priorMonth: metrics({ cash: 200_000 }) }),
    );
    const cash = out.find((a) => a.ruleKey === 'cash_decline');
    expect(cash?.deltaAmount).toBe(-50_000);
    expect(cash?.detail).toMatch(/despite positive net income/);
  });

  it('fires when 90-plus receivables grow', () => {
    const aging = (over90: number) => ({
      asOf: '2026-08-31',
      kind: 'receivable' as const,
      total: { entityName: '__TOTAL__', entityQboId: null, current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90Plus: over90, total: over90 },
      entities: [],
    });
    const out = detectAnomalies(input({ arAging: aging(20_000), priorArAging: aging(10_000) }));
    expect(keys(out)).toContain('ar_90_growth');
  });

  it('flags a material new vendor', () => {
    const out = detectAnomalies(input({ newVendors: [{ vendorName: 'New Supplier', amount: 20_000 }] }));
    expect(keys(out)).toContain('new_large_vendor');
  });

  it('ignores a small new vendor', () => {
    const out = detectAnomalies(input({ newVendors: [{ vendorName: 'Small Supplier', amount: 900 }] }));
    expect(keys(out)).not.toContain('new_large_vendor');
  });

  it('flags a large vendor spend jump', () => {
    const out = detectAnomalies(
      input({
        vendorSpend: [{ vendorQboId: '1', vendorName: 'Ashley', amount: 60_000, txnCount: 3 }],
        priorVendorSpend: [{ vendorQboId: '1', vendorName: 'Ashley', amount: 30_000, txnCount: 3 }],
      }),
    );
    expect(keys(out)).toContain('vendor_spend_jump');
  });
});

describe('transaction and data-quality rules', () => {
  it('flags a large transaction with no history to compare against', () => {
    const out = detectAnomalies(
      input({ largeTransactions: [{ description: 'Purchase Owner Draw', amount: 95_000, date: '2026-08-28', txnType: 'Purchase' }] }),
    );
    expect(keys(out)).toContain('large_transaction');
  });

  it('does not flag a large transaction that is routine for its type', () => {
    const out = detectAnomalies(
      input({
        largeTransactions: [{ description: 'Bill Ashley', amount: 38_000, date: '2026-08-14', txnType: 'Bill' }],
        transactionHistoryByType: new Map([['Bill', { median: 30_000, p90: 40_000, count: 60 }]]),
      }),
    );
    expect(keys(out)).not.toContain('large_transaction');
  });

  it('flags duplicate-looking transactions', () => {
    const out = detectAnomalies(
      input({ duplicates: [{ entityName: 'BrightSign', amount: 6_000, dates: ['2026-08-14', '2026-08-16'], count: 2 }] }),
    );
    expect(keys(out)).toContain('duplicate_transactions');
  });

  it('flags material uncategorised balances', () => {
    const out = detectAnomalies(
      input({ uncategorizedBalances: [{ accountName: 'Uncategorized Expense', amount: 13_662 }] }),
    );
    const flagged = out.find((a) => a.ruleKey === 'uncategorized_balance');
    expect(flagged?.severity).toBe('IMPORTANT');
  });

  it('flags unmapped operating expenses above the share threshold', () => {
    const out = detectAnomalies(
      input({ current: metrics({ unmappedOpexAmount: 19_200, unmappedOpexPct: 0.128 }) }),
    );
    expect(keys(out)).toContain('unmapped_expenses');
  });
});

describe('scoring', () => {
  it('ranks the biggest dollar impact first', () => {
    const out = detectAnomalies(
      input({
        current: metrics({ netSales: 600_000, cash: 150_000 }),
        priorMonth: metrics({ netSales: 500_000, cash: 200_000 }),
      }),
    );
    expect(out.length).toBeGreaterThan(1);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score);
    }
  });

  it('produces nothing when every month is identical', () => {
    expect(detectAnomalies(input())).toHaveLength(0);
  });
});
