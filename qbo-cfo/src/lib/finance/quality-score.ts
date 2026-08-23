import { round2 } from './math';

/**
 * Deterministic report confidence score, 0-100.
 *
 * The score is a transparent deduction model: every point lost is attributable
 * to a named factor with a stated reason. It is computed from stored facts
 * only, and the AI layer receives it as an input it must respect -- no model
 * output can raise or lower it.
 */

/**
 * `unknown` is not a score band the engine produces. It marks a report stored
 * before scoring existed, so the card reads "not scored" rather than showing a
 * fabricated zero as if the bookkeeping were bad.
 */
export type QualityBand = 'excellent' | 'good' | 'needs_review' | 'low' | 'unknown';

export interface Deduction {
  factor: string;
  label: string;
  points: number;
  reason: string;
}

export interface QualityScore {
  score: number;
  band: QualityBand;
  bandLabel: string;
  deductions: Deduction[];
  /** Coarse three-value view, kept for the stored `confidence` column. */
  confidence: 'high' | 'medium' | 'low';
}

/** Maximum points each factor can remove. They sum to more than 100 by design:
 *  a report can be bad in several independent ways at once, and the floor is 0. */
export const FACTOR_WEIGHTS = {
  reportAvailability: 40,
  mappingCoverage: 25,
  balanceSheetIntegrity: 15,
  periodIncomplete: 12,
  syncCompleteness: 10,
  uncategorizedBalances: 10,
  comparisonPeriods: 10,
  dimensionCoverage: 8,
  unresolvedAnomalies: 8,
  staleData: 8,
} as const;

export type QualityFactor = keyof typeof FACTOR_WEIGHTS;

export interface ScoreInput {
  /** Is a Profit & Loss stored for the period? Without it there is no report. */
  hasProfitAndLoss: boolean;
  hasBalanceSheet: boolean;
  hasReceivableAging: boolean;
  hasPayableAging: boolean;
  /** null when no balance sheet was captured. */
  balanceSheetBalanced: boolean | null;
  /** Dollar-weighted share of money that reached a management category, 0-1. */
  mappingCoverage: number | null;
  unmappedAmount: number;
  unmappedAccountCount: number;
  /** Suspense / uncategorised balances as a share of operating expenses, 0-1. */
  uncategorizedShareOfOpex: number;
  uncategorizedAmount: number;
  /** Share of period transactions with no location or class, 0-1. */
  missingDimensionShare: number | null;
  dimensionReportingActive: boolean;
  /** Outcome of the most recent sync for this period. */
  lastSyncStatus: 'completed' | 'partial' | 'failed' | 'none';
  syncWarningCount: number;
  hasPriorMonth: boolean;
  hasSameMonthLastYear: boolean;
  trailingMonthsAvailable: number;
  criticalAnomalies: number;
  importantAnomalies: number;
  /** Days since the newest snapshot was fetched from QuickBooks. */
  daysSinceLastSync: number | null;
  periodIsIncomplete: boolean;
}

function band(score: number): { band: QualityBand; label: string; confidence: 'high' | 'medium' | 'low' } {
  if (score >= 90) return { band: 'excellent', label: 'Excellent', confidence: 'high' };
  if (score >= 75) return { band: 'good', label: 'Good', confidence: 'medium' };
  if (score >= 60) return { band: 'needs_review', label: 'Needs Review', confidence: 'medium' };
  return { band: 'low', label: 'Low Confidence', confidence: 'low' };
}

/**
 * Conditions that disqualify a report outright, capping the score regardless of
 * how clean everything else is. Without a Profit & Loss there is no income
 * statement to report on, so no combination of other factors can lift it out of
 * the bottom band.
 */
const DISQUALIFYING_CAP = 20;

export function computeQualityScore(input: ScoreInput): QualityScore {
  const deductions: Deduction[] = [];
  const deduct = (factor: QualityFactor, label: string, points: number, reason: string): void => {
    const capped = Math.min(FACTOR_WEIGHTS[factor], Math.max(0, round2(points)));
    if (capped > 0) deductions.push({ factor, label, points: capped, reason });
  };

  // --- Report availability -------------------------------------------------
  if (!input.hasProfitAndLoss) {
    deduct(
      'reportAvailability',
      'Report availability',
      FACTOR_WEIGHTS.reportAvailability,
      'No Profit & Loss is stored for this period, so the income statement cannot be produced.',
    );
  } else {
    let missing = 0;
    const absent: string[] = [];
    if (!input.hasBalanceSheet) {
      missing += 12;
      absent.push('Balance Sheet');
    }
    if (!input.hasReceivableAging) {
      missing += 4;
      absent.push('A/R aging');
    }
    if (!input.hasPayableAging) {
      missing += 4;
      absent.push('A/P aging');
    }
    if (missing > 0) {
      deduct(
        'reportAvailability',
        'Report availability',
        missing,
        `QuickBooks did not return: ${absent.join(', ')}. Those sections are omitted from the report.`,
      );
    }
  }

  // --- Mapping coverage ----------------------------------------------------
  if (input.mappingCoverage === null) {
    deduct('mappingCoverage', 'Account mapping', 10, 'No mapped activity was found for this period.');
  } else if (input.mappingCoverage < 1) {
    // Full weight is reached at 80% coverage: below that, category analysis is
    // not merely imprecise, it is misleading.
    const shortfall = 1 - input.mappingCoverage;
    deduct(
      'mappingCoverage',
      'Account mapping',
      (shortfall / 0.2) * FACTOR_WEIGHTS.mappingCoverage,
      `${(shortfall * 100).toFixed(1)}% of income and expense activity is not mapped to a management category (${input.unmappedAccountCount} account(s), ${formatMoney(input.unmappedAmount)}).`,
    );
  }

  // --- Balance sheet integrity --------------------------------------------
  if (input.balanceSheetBalanced === false) {
    deduct(
      'balanceSheetIntegrity',
      'Balance sheet integrity',
      FACTOR_WEIGHTS.balanceSheetIntegrity,
      'Total assets do not equal total liabilities plus equity, so the stored balance sheet is incomplete.',
    );
  }

  // --- Period completeness -------------------------------------------------
  if (input.periodIsIncomplete) {
    deduct(
      'periodIncomplete',
      'Reporting month',
      FACTOR_WEIGHTS.periodIncomplete,
      'The reporting month has not finished. Figures are partial and will change.',
    );
  }

  // --- Sync completeness ---------------------------------------------------
  if (input.lastSyncStatus === 'none') {
    deduct('syncCompleteness', 'Sync completeness', 6, 'No sync job has run for this company.');
  } else if (input.lastSyncStatus === 'failed') {
    deduct('syncCompleteness', 'Sync completeness', FACTOR_WEIGHTS.syncCompleteness, 'The most recent sync failed.');
  } else if (input.lastSyncStatus === 'partial') {
    deduct(
      'syncCompleteness',
      'Sync completeness',
      Math.min(FACTOR_WEIGHTS.syncCompleteness, 4 + input.syncWarningCount),
      `The most recent sync completed with ${input.syncWarningCount} warning(s); some data may be missing.`,
    );
  }

  // --- Uncategorised / suspense balances -----------------------------------
  if (input.uncategorizedAmount > 0) {
    deduct(
      'uncategorizedBalances',
      'Uncategorised transactions',
      (input.uncategorizedShareOfOpex / 0.05) * FACTOR_WEIGHTS.uncategorizedBalances,
      `${formatMoney(input.uncategorizedAmount)} sits in uncategorised or suspense accounts.`,
    );
  }

  // --- Comparison periods --------------------------------------------------
  {
    let missing = 0;
    const absent: string[] = [];
    if (!input.hasPriorMonth) {
      missing += 5;
      absent.push('prior month');
    }
    if (!input.hasSameMonthLastYear) {
      missing += 3;
      absent.push('same month last year');
    }
    if (input.trailingMonthsAvailable < 6) {
      missing += 2;
      absent.push(`only ${input.trailingMonthsAvailable} trailing month(s)`);
    }
    if (missing > 0) {
      deduct(
        'comparisonPeriods',
        'Comparison periods',
        missing,
        `Comparisons are limited: ${absent.join(', ')} unavailable. Import more history to strengthen them.`,
      );
    }
  }

  // --- Dimension coverage --------------------------------------------------
  if (input.dimensionReportingActive && input.missingDimensionShare !== null && input.missingDimensionShare > 0) {
    deduct(
      'dimensionCoverage',
      'Location / class assignment',
      (input.missingDimensionShare / 0.25) * FACTOR_WEIGHTS.dimensionCoverage,
      `${(input.missingDimensionShare * 100).toFixed(1)}% of transactions carry no location or class, so store-level results are incomplete.`,
    );
  }

  // --- Unresolved anomalies ------------------------------------------------
  {
    const points = input.criticalAnomalies * 4 + input.importantAnomalies * 1;
    if (points > 0) {
      deduct(
        'unresolvedAnomalies',
        'Unresolved alerts',
        points,
        `${input.criticalAnomalies} critical and ${input.importantAnomalies} important alert(s) are open for this period.`,
      );
    }
  }

  // --- Staleness -----------------------------------------------------------
  if (input.daysSinceLastSync !== null) {
    const days = input.daysSinceLastSync;
    if (days > 45) {
      deduct('staleData', 'Data freshness', 8, `QuickBooks was last read ${Math.round(days)} days ago.`);
    } else if (days > 21) {
      deduct('staleData', 'Data freshness', 4, `QuickBooks was last read ${Math.round(days)} days ago.`);
    } else if (days > 10) {
      deduct('staleData', 'Data freshness', 2, `QuickBooks was last read ${Math.round(days)} days ago.`);
    }
  }

  const total = deductions.reduce((a, d) => a + d.points, 0);
  const raw = Math.max(0, Math.min(100, Math.round(100 - total)));
  const score = input.hasProfitAndLoss ? raw : Math.min(raw, DISQUALIFYING_CAP);
  const b = band(score);

  return {
    score,
    band: b.band,
    bandLabel: b.label,
    confidence: b.confidence,
    deductions: deductions.sort((a, d) => d.points - a.points),
  };
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function bandLabelFor(score: number): string {
  return band(score).label;
}
