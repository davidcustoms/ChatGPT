import { describe, expect, it } from 'vitest';
import { evaluateDataQuality, type QualityInput } from '@/lib/finance/data-quality';
import { monthPeriod } from '@/lib/util/dates';
import type { MonthlyMetrics } from '@/lib/finance/types';

const period = monthPeriod(2026, 7);
const today = new Date('2026-08-23T00:00:00Z');

function metrics(overrides: Partial<MonthlyMetrics> = {}): MonthlyMetrics {
  return {
    companyId: 'c',
    period,
    grossSales: 500_000, discounts: 0, refunds: 0, netSales: 500_000,
    cogs: 275_000, grossProfit: 225_000, grossMargin: 0.45,
    operatingExpenses: 150_000, payrollExpense: 0, advertisingExpense: 0, rentExpense: 0,
    deliveryExpense: 0, freightExpense: 0, warehouseExpense: 0, financingFees: 0,
    merchantFees: 0, bankFees: 0, interestExpense: 0, utilitiesExpense: 0,
    insuranceExpense: 0, repairsExpense: 0, vehicleExpense: 0, professionalFees: 0,
    softwareExpense: 0, taxesExpense: 0, otherOpex: 0,
    netOperatingIncome: 75_000, otherIncome: 0, otherExpense: 0, netIncome: 75_000, netMargin: 0.15,
    cash: 200_000, accountsReceivable: 100_000, accountsPayable: 120_000, inventoryValue: 400_000,
    otherCurrentAssets: 0, currentAssets: 700_000, fixedAssets: 100_000, totalAssets: 800_000,
    creditCards: 0, shortTermDebt: 0, longTermDebt: 0, currentLiabilities: 400_000,
    totalLiabilities: 400_000, equity: 400_000,
    unmappedOpexAmount: 0, unmappedOpexPct: 0, balanceSheetBalanced: true,
    sourceSnapshotIds: [], computedAt: today.toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    period,
    metrics: metrics(),
    expectedCompanyName: 'Harborline Furniture Co.',
    connectedCompanyName: 'Harborline Furniture Co.',
    unmappedExpenseAccountCount: 0,
    uncategorizedBalances: [],
    requireLocationData: false,
    locationRowCount: 0,
    negativeInventoryItems: [],
    duplicateSnapshotCount: 0,
    oldReceivables90Plus: 0,
    oldPayables90Plus: 0,
    today,
    ...overrides,
  };
}

const check = (report: ReturnType<typeof evaluateDataQuality>, key: string) =>
  report.checks.find((c) => c.key === key);

describe('report confidence', () => {
  it('is high when every check passes', () => {
    const report = evaluateDataQuality(input());
    expect(report.confidence).toBe('high');
    expect(report.blocking).toBe(false);
    expect(report.reasons).toHaveLength(0);
  });

  it('is low when any check fails', () => {
    const report = evaluateDataQuality(input({ metrics: null }));
    expect(report.confidence).toBe('low');
    expect(report.blocking).toBe(true);
    expect(check(report, 'pnl_present')?.status).toBe('fail');
  });

  it('drops to medium on warnings alone', () => {
    const report = evaluateDataQuality(input({ negativeInventoryItems: ['Recliner - Leather'] }));
    expect(report.confidence).toBe('medium');
    expect(report.blocking).toBe(false);
  });
});

describe('individual checks', () => {
  it('fails when the balance sheet does not balance', () => {
    const report = evaluateDataQuality(input({ metrics: metrics({ balanceSheetBalanced: false }) }));
    expect(check(report, 'bs_balanced')?.status).toBe('fail');
    expect(check(report, 'bs_balanced')?.message).toMatch(/do not equal/);
  });

  it('warns rather than fails when no balance sheet was captured', () => {
    const report = evaluateDataQuality(input({ metrics: metrics({ balanceSheetBalanced: null }) }));
    expect(check(report, 'bs_balanced')?.status).toBe('warn');
  });

  it('warns when the reporting month has not finished', () => {
    const report = evaluateDataQuality(input({ period: monthPeriod(2026, 8) }));
    expect(check(report, 'period_complete')?.status).toBe('warn');
    expect(check(report, 'period_complete')?.message).toMatch(/has not finished/);
  });

  it('warns when the connected QuickBooks company has a different name', () => {
    const report = evaluateDataQuality(input({ connectedCompanyName: 'Some Other Company LLC' }));
    expect(check(report, 'company_match')?.status).toBe('warn');
    expect(check(report, 'company_match')?.action?.href).toBe('/settings/quickbooks');
  });

  it('quantifies unmapped expenses in the message', () => {
    const report = evaluateDataQuality(
      input({
        metrics: metrics({ unmappedOpexAmount: 19_200, unmappedOpexPct: 0.128 }),
        unmappedExpenseAccountCount: 3,
      }),
    );
    const mapping = check(report, 'mapping_coverage');
    expect(mapping?.status).toBe('fail');
    expect(mapping?.message).toMatch(/12\.8% of operating expenses are currently unmapped/);
  });

  it('warns but does not fail on modest unmapped coverage', () => {
    const report = evaluateDataQuality(
      input({
        metrics: metrics({ unmappedOpexAmount: 3_000, unmappedOpexPct: 0.02 }),
        unmappedExpenseAccountCount: 1,
      }),
    );
    expect(check(report, 'mapping_coverage')?.status).toBe('warn');
  });

  it('fails when location reporting was requested but no segments exist', () => {
    const report = evaluateDataQuality(input({ requireLocationData: true, locationRowCount: 0 }));
    expect(check(report, 'location_data')?.status).toBe('fail');
  });

  it('passes when the requested location data is present', () => {
    const report = evaluateDataQuality(input({ requireLocationData: true, locationRowCount: 4 }));
    expect(check(report, 'location_data')?.status).toBe('pass');
  });

  it('warns when many transactions carry no location or class', () => {
    const report = evaluateDataQuality(input({ missingDimension: { missing: 40, total: 100 } }));
    expect(check(report, 'dimension_coverage')?.status).toBe('warn');
    expect(check(report, 'dimension_coverage')?.message).toMatch(/40\.0%/);
  });

  it('surfaces aged receivables and payables with a link to act on them', () => {
    const report = evaluateDataQuality(input({ oldReceivables90Plus: 29_918, oldPayables90Plus: 5_000 }));
    expect(check(report, 'old_ar')?.action?.href).toBe('/receivables');
    expect(check(report, 'old_ap')?.action?.href).toBe('/payables');
  });

  it('reports a duplicate import', () => {
    const report = evaluateDataQuality(input({ duplicateSnapshotCount: 2 }));
    expect(check(report, 'duplicate_import')?.status).toBe('warn');
  });

  it('passes reconciliation silently when there is nothing to say', () => {
    const report = evaluateDataQuality(input());
    expect(check(report, 'reconciliation')).toBeUndefined();
  });
});
