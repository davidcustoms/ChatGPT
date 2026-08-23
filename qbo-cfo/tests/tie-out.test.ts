import { describe, expect, it } from 'vitest';
import { tieOutToSnapshot } from '@/lib/reports/reconcile';
import { computeQualityScore } from '@/lib/finance/quality-score';
import { evaluateDataQuality } from '@/lib/finance/data-quality';
import { flattenReport } from '@/lib/qbo/parse';
import { MOCK_PNL } from './fixtures/mock-reports';
import { metricsFixture } from './fixtures/metrics';
import { monthPeriod } from '@/lib/util/dates';

/**
 * The report must tie to QuickBooks, and must say so when it does not.
 *
 * The metric engine takes some totals from QuickBooks' own subtotal rows and
 * derives net revenue from its own line classification. When those two agree,
 * gross margin is a consistent ratio. When they disagree, it is a QuickBooks
 * numerator over an application denominator -- and before this check the
 * variance was computed, returned, and thrown away, so nobody was told.
 *
 * This runs on every report build, not only when someone runs the
 * reconciliation script.
 */

const PERIOD = monthPeriod(2026, 7);

/** Metrics that agree with MOCK_PNL's own subtotals. */
function tyingMetrics() {
  const flat = flattenReport(MOCK_PNL);
  const g = (group: string) =>
    flat.summaries.find((s) => s.group === group)?.values[0] ?? 0;
  return metricsFixture('c', '2026-07', {
    netSales: g('Income'),
    cogs: g('COGS'),
    grossProfit: g('GrossProfit'),
    operatingExpenses: g('Expenses'),
    netIncome: g('NetIncome'),
  });
}

describe('tie-out to QuickBooks subtotals', () => {
  it('passes when every total matches', () => {
    const tie = tieOutToSnapshot(flattenReport(MOCK_PNL), tyingMetrics());

    expect(tie.compared).toBeGreaterThan(0);
    expect(tie.mismatches).toEqual([]);
    expect(tie.ok).toBe(true);
    expect(tie.worstDifference).toBe(0);
  });

  it('catches a single total that drifted', () => {
    const drifted = { ...tyingMetrics(), netSales: tyingMetrics().netSales + 0.01 };
    const tie = tieOutToSnapshot(flattenReport(MOCK_PNL), drifted);

    // One cent is enough. A report that is a cent out is a report with a bug.
    expect(tie.ok).toBe(false);
    expect(tie.mismatches).toHaveLength(1);
    expect(tie.mismatches[0]?.metric).toBe('Net revenue');
    expect(tie.worstDifference).toBeCloseTo(0.01, 2);
  });

  it('names every total that differs, not just the first', () => {
    const base = tyingMetrics();
    const wrong = { ...base, netSales: base.netSales + 100, netIncome: base.netIncome - 250 };
    const tie = tieOutToSnapshot(flattenReport(MOCK_PNL), wrong);

    expect(tie.mismatches.map((m) => m.metric).sort()).toEqual(['Net income', 'Net revenue']);
    expect(tie.worstDifference).toBeCloseTo(250, 2);
  });

  it('tolerates rounding below half a cent', () => {
    const base = tyingMetrics();
    const tie = tieOutToSnapshot(flattenReport(MOCK_PNL), { ...base, netSales: base.netSales + 0.004 });
    expect(tie.ok).toBe(true);
  });

  it('reports nothing compared when the snapshot has no subtotals', () => {
    const empty = flattenReport({ Header: {}, Columns: { Column: [] }, Rows: { Row: [] } } as never);
    const tie = tieOutToSnapshot(empty, tyingMetrics());

    // Not a pass. Nothing was checked, and the score must not credit it.
    expect(tie.compared).toBe(0);
    expect(tie.ok).toBe(true);
  });
});

describe('the score treats a failed tie-out as disqualifying', () => {
  const clean = {
    hasProfitAndLoss: true, hasBalanceSheet: true, hasReceivableAging: true,
    hasPayableAging: true, balanceSheetBalanced: true, mappingCoverage: 1,
    unmappedAmount: 0, unmappedAccountCount: 0, uncategorizedShareOfOpex: 0,
    uncategorizedAmount: 0, missingDimensionShare: 0, dimensionReportingActive: true,
    lastSyncStatus: 'completed' as const, syncWarningCount: 0, hasPriorMonth: true,
    hasSameMonthLastYear: true, trailingMonthsAvailable: 12, criticalAnomalies: 0,
    importantAnomalies: 0, daysSinceLastSync: 1, periodIsIncomplete: false,
  };

  it('scores an otherwise perfect report at 100 when it ties', () => {
    const score = computeQualityScore({
      ...clean,
      statementTieOut: { ok: true, worstDifference: 0, compared: 5 },
    });
    expect(score.score).toBe(100);
    expect(score.band).toBe('excellent');
  });

  it('caps an otherwise perfect report that does not tie', () => {
    const score = computeQualityScore({
      ...clean,
      statementTieOut: { ok: false, worstDifference: 1_250.5, compared: 5 },
    });

    // Everything else is clean, so without the cap this would still score 70
    // and read "Needs Review". A report whose figures do not match its source
    // is not a needs-review report.
    expect(score.score).toBeLessThanOrEqual(20);
    expect(score.band).toBe('low');
    expect(score.deductions.some((d) => d.factor === 'statementTieOut')).toBe(true);
    expect(score.deductions.find((d) => d.factor === 'statementTieOut')?.reason).toContain('$1,250.50');
  });

  it('reports a one-cent break as one cent, not as zero', () => {
    const score = computeQualityScore({
      ...clean,
      statementTieOut: { ok: false, worstDifference: 0.01, compared: 5 },
    });
    const reason = score.deductions.find((d) => d.factor === 'statementTieOut')?.reason ?? '';
    // Whole-dollar formatting would render this as "$0", which reads as no
    // difference at all and makes the check look broken.
    expect(reason).toContain('$0.01');
    expect(reason).not.toMatch(/\$0(?!\.)/);
  });

  it('does not deduct when the check could not be run', () => {
    expect(computeQualityScore({ ...clean, statementTieOut: null }).score).toBe(100);
    expect(computeQualityScore({ ...clean, statementTieOut: { ok: true, worstDifference: 0, compared: 0 } }).score).toBe(100);
    // An omitted field behaves the same as an explicit null.
    expect(computeQualityScore(clean).score).toBe(100);
  });
});

describe('the close checklist shows the tie-out', () => {
  const base = {
    period: PERIOD,
    metrics: metricsFixture('c', '2026-07', {
      netSales: 681_369.54, cogs: 374_548.84, grossProfit: 306_820.7,
      operatingExpenses: 280_028.06, netIncome: 17_079.05, netMargin: 0.025,
      grossMargin: 0.4503, balanceSheetBalanced: true, cash: 557_554.98,
    }),
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
    today: new Date('2026-08-03T00:00:00Z'),
  };

  it('passes the check and names how many totals were compared', () => {
    const report = evaluateDataQuality({
      ...base,
      statementTieOut: { ok: true, worstDifference: 0, compared: 5, mismatches: [] },
    });
    const check = report.checks.find((c) => c.key === 'ties_to_quickbooks');
    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('All 5 income-statement totals');
  });

  it('fails the check, names the difference, and offers the fix', () => {
    const report = evaluateDataQuality({
      ...base,
      statementTieOut: {
        ok: false, worstDifference: 1_250.5, compared: 5,
        mismatches: [{ metric: 'Net revenue', app: 682_620.04, quickbooks: 681_369.54, difference: 1_250.5 }],
      },
    });
    const check = report.checks.find((c) => c.key === 'ties_to_quickbooks');

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('Net revenue differs by $1,250.50');
    expect(check?.message).toMatch(/should not be relied on/);
    expect(check?.action?.href).toBe('/settings/quickbooks');
    // And it drags the whole report's confidence down.
    expect(report.score.band).toBe('low');
    expect(report.confidence).toBe('low');
  });

  it('omits the check entirely when there was nothing to compare', () => {
    const report = evaluateDataQuality(base);
    expect(report.checks.find((c) => c.key === 'ties_to_quickbooks')).toBeUndefined();
  });
});
