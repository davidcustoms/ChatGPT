import { describe, expect, it } from 'vitest';
import { computeQualityScore, FACTOR_WEIGHTS, type ScoreInput } from '@/lib/finance/quality-score';

function clean(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    hasProfitAndLoss: true,
    hasBalanceSheet: true,
    hasReceivableAging: true,
    hasPayableAging: true,
    balanceSheetBalanced: true,
    mappingCoverage: 1,
    unmappedAmount: 0,
    unmappedAccountCount: 0,
    uncategorizedShareOfOpex: 0,
    uncategorizedAmount: 0,
    missingDimensionShare: 0,
    dimensionReportingActive: true,
    lastSyncStatus: 'completed',
    syncWarningCount: 0,
    hasPriorMonth: true,
    hasSameMonthLastYear: true,
    trailingMonthsAvailable: 12,
    criticalAnomalies: 0,
    importantAnomalies: 0,
    daysSinceLastSync: 1,
    periodIsIncomplete: false,
    ...overrides,
  };
}

const factors = (input: ScoreInput) => computeQualityScore(input).deductions.map((d) => d.factor);

describe('score bands', () => {
  it('scores a perfect period 100 / Excellent', () => {
    const s = computeQualityScore(clean());
    expect(s.score).toBe(100);
    expect(s.band).toBe('excellent');
    expect(s.bandLabel).toBe('Excellent');
    expect(s.confidence).toBe('high');
    expect(s.deductions).toHaveLength(0);
  });

  it('maps each documented band', () => {
    expect(computeQualityScore(clean()).bandLabel).toBe('Excellent');
    expect(computeQualityScore(clean({ periodIsIncomplete: true })).bandLabel).toBe('Good');
    expect(
      computeQualityScore(clean({ periodIsIncomplete: true, balanceSheetBalanced: false })).bandLabel,
    ).toBe('Needs Review');
    expect(computeQualityScore(clean({ hasProfitAndLoss: false })).bandLabel).toBe('Low Confidence');
  });

  it('never goes below zero or above one hundred', () => {
    const worst = computeQualityScore(
      clean({
        hasProfitAndLoss: false,
        hasBalanceSheet: false,
        hasReceivableAging: false,
        hasPayableAging: false,
        balanceSheetBalanced: false,
        mappingCoverage: 0,
        unmappedAmount: 500_000,
        unmappedAccountCount: 40,
        uncategorizedShareOfOpex: 0.5,
        uncategorizedAmount: 90_000,
        missingDimensionShare: 1,
        lastSyncStatus: 'failed',
        hasPriorMonth: false,
        hasSameMonthLastYear: false,
        trailingMonthsAvailable: 0,
        criticalAnomalies: 12,
        importantAnomalies: 20,
        daysSinceLastSync: 400,
        periodIsIncomplete: true,
      }),
    );
    expect(worst.score).toBe(0);
    expect(worst.band).toBe('low');
    expect(computeQualityScore(clean()).score).toBeLessThanOrEqual(100);
  });
});

describe('individual factors', () => {
  it('treats a missing Profit & Loss as disqualifying, not merely costly', () => {
    // Without an income statement there is no report, so no combination of
    // clean inputs elsewhere may lift it out of the bottom band.
    const s = computeQualityScore(clean({ hasProfitAndLoss: false }));
    expect(s.deductions.find((x) => x.factor === 'reportAvailability')?.points).toBe(
      FACTOR_WEIGHTS.reportAvailability,
    );
    expect(s.score).toBeLessThanOrEqual(20);
    expect(s.band).toBe('low');
  });

  it('deducts progressively for mapping shortfall and caps at the factor weight', () => {
    expect(computeQualityScore(clean({ mappingCoverage: 0.99 })).score).toBeGreaterThan(
      computeQualityScore(clean({ mappingCoverage: 0.9 })).score,
    );
    const severe = computeQualityScore(clean({ mappingCoverage: 0.3 }));
    const d = severe.deductions.find((x) => x.factor === 'mappingCoverage');
    expect(d?.points).toBe(FACTOR_WEIGHTS.mappingCoverage);
  });

  it('deducts for an unbalanced balance sheet', () => {
    expect(factors(clean({ balanceSheetBalanced: false }))).toContain('balanceSheetIntegrity');
  });

  it('does not deduct balance-sheet integrity when no balance sheet exists', () => {
    // The absence is already charged under report availability; charging twice
    // would double-count one problem.
    const f = factors(clean({ hasBalanceSheet: false, balanceSheetBalanced: null }));
    expect(f).toContain('reportAvailability');
    expect(f).not.toContain('balanceSheetIntegrity');
  });

  it('deducts for an incomplete reporting month', () => {
    expect(factors(clean({ periodIsIncomplete: true }))).toContain('periodIncomplete');
  });

  it('scales the sync deduction with warning count', () => {
    const few = computeQualityScore(clean({ lastSyncStatus: 'partial', syncWarningCount: 1 }));
    const many = computeQualityScore(clean({ lastSyncStatus: 'partial', syncWarningCount: 20 }));
    expect(many.score).toBeLessThan(few.score);
    expect(
      many.deductions.find((d) => d.factor === 'syncCompleteness')?.points,
    ).toBe(FACTOR_WEIGHTS.syncCompleteness);
  });

  it('deducts for missing comparison periods', () => {
    const s = computeQualityScore(clean({ hasPriorMonth: false, hasSameMonthLastYear: false, trailingMonthsAvailable: 1 }));
    const d = s.deductions.find((x) => x.factor === 'comparisonPeriods');
    expect(d?.points).toBe(10);
    expect(d?.reason).toMatch(/prior month/);
  });

  it('only deducts for dimension coverage when store reporting is active', () => {
    expect(factors(clean({ missingDimensionShare: 0.4, dimensionReportingActive: false }))).not.toContain(
      'dimensionCoverage',
    );
    expect(factors(clean({ missingDimensionShare: 0.4, dimensionReportingActive: true }))).toContain(
      'dimensionCoverage',
    );
  });

  it('weights critical alerts more heavily than important ones', () => {
    const critical = computeQualityScore(clean({ criticalAnomalies: 1 }));
    const important = computeQualityScore(clean({ importantAnomalies: 1 }));
    expect(critical.score).toBeLessThan(important.score);
  });

  it('deducts progressively for stale data', () => {
    expect(computeQualityScore(clean({ daysSinceLastSync: 5 })).score).toBe(100);
    expect(computeQualityScore(clean({ daysSinceLastSync: 15 })).score).toBe(98);
    expect(computeQualityScore(clean({ daysSinceLastSync: 30 })).score).toBe(96);
    expect(computeQualityScore(clean({ daysSinceLastSync: 60 })).score).toBe(92);
  });
});

describe('explainability', () => {
  it('attributes every lost point to a named factor with a reason', () => {
    const s = computeQualityScore(
      clean({ mappingCoverage: 0.85, periodIsIncomplete: true, daysSinceLastSync: 30 }),
    );
    const total = s.deductions.reduce((a, d) => a + d.points, 0);
    expect(Math.round(100 - total)).toBe(s.score);
    for (const d of s.deductions) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.reason.length).toBeGreaterThan(10);
      expect(d.points).toBeGreaterThan(0);
    }
  });

  it('orders deductions with the largest first', () => {
    const s = computeQualityScore(clean({ mappingCoverage: 0.5, daysSinceLastSync: 15 }));
    for (let i = 1; i < s.deductions.length; i += 1) {
      expect(s.deductions[i - 1]!.points).toBeGreaterThanOrEqual(s.deductions[i]!.points);
    }
  });

  it('is deterministic — the same input always yields the same score', () => {
    const input = clean({ mappingCoverage: 0.77, criticalAnomalies: 2, daysSinceLastSync: 33 });
    const runs = Array.from({ length: 25 }, () => computeQualityScore(input).score);
    expect(new Set(runs).size).toBe(1);
  });
});
