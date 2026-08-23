import type { ReportPayload } from '@/lib/reports/types';
import { monthPeriod } from '@/lib/util/dates';

/**
 * A complete, realistic ReportPayload for tests that need one.
 *
 * Overrides are applied shallowly on top, so a test states only the part of
 * the report its scenario is about.
 */
export function reportPayload(overrides: Partial<ReportPayload> = {}): ReportPayload {
  const period = monthPeriod(2026, 7);
  const base = {
    netSales: 681_370, grossSales: 700_000, discounts: 12_000, refunds: 6_630,
    cogs: 374_549, grossProfit: 306_821, grossMargin: 0.45,
    operatingExpenses: 280_028, netOperatingIncome: 26_793,
    otherIncome: 6_500, otherExpense: 16_214, netIncome: 17_079, netMargin: 0.025,
    cash: 557_555, accountsReceivable: 202_148, accountsPayable: 411_197, inventoryValue: 1_698_672,
  };
  return {
    version: 1,
    companyId: 'c',
    companyName: 'Harborline Furniture Co.',
    currency: 'USD',
    period,
    periodLabel: 'July 2026',
    generatedAt: '2026-08-03T00:00:00.000Z',
    dataThrough: '2026-07-31',
    sourceSystem: 'QuickBooks Online',
    metrics: { ...base, companyId: 'c', period, accountingMethod: 'Accrual' } as unknown as ReportPayload['metrics'],
    comparisons: {
      priorMonth: { ...base, companyId: 'c', period, accountingMethod: 'Accrual' } as unknown as ReportPayload['metrics'],
      sameMonthLastYear: null,
      yearToDate: null,
      priorYearToDate: null,
      trailing12: null,
    },
    kpis: {} as ReportPayload['kpis'],
    headline: [],
    pnlRows: [],
    expenseAnalysis: [],
    balanceSheetRows: [],
    cashPosition: {
      beginningCash: 657_510, endingCash: 557_555, netChange: -99_955,
      operating: null, investing: null, financing: null,
      cashFlowStatementAvailable: false, note: 'not estimated',
    },
    arAging: null,
    apAging: null,
    topOverdueReceivables: [],
    topPayables: [],
    vendorSpend: [],
    stores: [],
    storeDimension: 'none',
    storeContributionLabel: 'Store Contribution Before Corporate Overhead',
    storeNote: 'note',
    trends: [],
    anomalies: [],
    insights: [],
    observations: ['Revenue was $681,370.'],
    executiveSummary: null,
    mappingCoverage: {
      sections: [],
      byCategory: [],
      totalUnmappedAmount: 0,
      totalUnmappedAccounts: 0,
      overallCoverage: 1,
      worstSection: null,
    },
    provenance: {},
    comparisonAvailability: {
      priorMonth: true,
      sameMonthLastYear: false,
      yearToDate: false,
      priorYearToDate: false,
      trailingMonths: 3,
    },
    accountingMethod: 'Accrual',
    basisLabel: 'Accrual Basis',
    basisDescription: 'Accrual basis.',
    provenanceVersion: null,
    dataQuality: {
      checks: [],
      score: {
        score: 100,
        band: 'excellent',
        bandLabel: 'Excellent',
        confidence: 'high',
        deductions: [],
      },
      confidence: 'high',
      reasons: [],
    },
    ...overrides,
  };
}
