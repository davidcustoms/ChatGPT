import { formatCurrency, formatPercent } from '../util/format';
import { safeDivide } from './math';
import type { MonthlyMetrics } from './types';
import { isPeriodIncomplete, type Period } from '../util/dates';
import { computeQualityScore, type QualityScore, type ScoreInput } from './quality-score';

/**
 * Pre-report validation and the "Report Confidence" score shown on the monthly
 * close page. Every check states what is wrong in plain language rather than
 * failing silently.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface QualityCheck {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
  /** Where the owner should go to fix it. */
  action?: { label: string; href: string };
}

export interface QualityReport {
  checks: QualityCheck[];
  /** Deterministic 0-100 score. The AI layer may reference it but never change it. */
  score: QualityScore;
  /** Coarse three-value view of the score, kept for storage and legacy callers. */
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  blocking: boolean;
}

export interface QualityInput {
  period: Period;
  metrics: MonthlyMetrics | null;
  expectedCompanyName: string | null;
  connectedCompanyName: string | null;
  unmappedExpenseAccountCount: number;
  uncategorizedBalances: Array<{ accountName: string; amount: number }>;
  unreconciledNote?: string | null;
  missingDimension?: { missing: number; total: number } | null;
  requireLocationData: boolean;
  locationRowCount: number;
  negativeInventoryItems: string[];
  duplicateSnapshotCount: number;
  oldReceivables90Plus: number | null;
  oldPayables90Plus: number | null;
  today?: Date;
  /**
   * Whether the reported totals tie to QuickBooks' own subtotals. `null` or
   * omitted means the comparison could not be made.
   */
  statementTieOut?: {
    ok: boolean;
    worstDifference: number;
    compared: number;
    mismatches: Array<{ metric: string; app: number; quickbooks: number; difference: number }>;
  } | null;
  /** Scoring inputs. Supplied by the report builder; defaults keep older callers working. */
  scoring?: Partial<ScoreInput>;
}

export function evaluateDataQuality(input: QualityInput): QualityReport {
  const checks: QualityCheck[] = [];
  const m = input.metrics;

  checks.push(
    m && (m.netSales !== 0 || m.operatingExpenses !== 0)
      ? { key: 'pnl_present', label: 'Profit & Loss totals present', status: 'pass', message: 'QuickBooks returned a complete Profit & Loss for the period.' }
      : {
          key: 'pnl_present',
          label: 'Profit & Loss totals present',
          status: 'fail',
          message: 'No Profit & Loss data is stored for this period. Run a sync before generating the report.',
          action: { label: 'Sync QuickBooks', href: '/settings/quickbooks' },
        },
  );

  // The strongest check in the list: do our numbers equal QuickBooks' numbers?
  const tie = input.statementTieOut ?? null;
  if (tie && tie.compared > 0) {
    checks.push(
      tie.ok
        ? {
            key: 'ties_to_quickbooks',
            label: 'Ties to QuickBooks',
            status: 'pass',
            message: `All ${tie.compared} income-statement totals match QuickBooks' own subtotals to the cent.`,
          }
        : {
            key: 'ties_to_quickbooks',
            label: 'Ties to QuickBooks',
            status: 'fail',
            message: `${tie.mismatches
              // Cents, always: a reconciliation message reading "differs by
              // $0" for a one-cent break would look like the check is broken.
              .map((x) => `${x.metric} differs by ${formatCurrency(x.difference, { decimals: 2 })}`)
              .join('; ')}. The figures in this report do not match QuickBooks and should not be relied on until the difference is explained.`,
            action: { label: 'Re-sync this month', href: '/settings/quickbooks' },
          },
    );
  }

  if (m?.balanceSheetBalanced === null || m?.balanceSheetBalanced === undefined) {
    checks.push({
      key: 'bs_balanced',
      label: 'Balance sheet balances',
      status: 'warn',
      message: 'No Balance Sheet was captured for this period, so balance-sheet sections will be omitted.',
    });
  } else if (m.balanceSheetBalanced) {
    checks.push({
      key: 'bs_balanced',
      label: 'Balance sheet balances',
      status: 'pass',
      message: 'Total assets equal total liabilities plus equity.',
    });
  } else {
    checks.push({
      key: 'bs_balanced',
      label: 'Balance sheet balances',
      status: 'fail',
      message: `Assets of ${formatCurrency(m.totalAssets)} do not equal liabilities plus equity of ${formatCurrency((m.totalLiabilities ?? 0) + (m.equity ?? 0))}. The stored balance sheet is incomplete.`,
    });
  }

  const incomplete = isPeriodIncomplete(input.period, input.today);
  checks.push({
    key: 'period_complete',
    label: 'Reporting month is complete',
    status: incomplete ? 'warn' : 'pass',
    message: incomplete
      ? `${input.period.start.slice(0, 7)} has not finished yet. Figures are partial and will change.`
      : 'The reporting month has closed.',
  });

  const companyMatches =
    !input.expectedCompanyName ||
    !input.connectedCompanyName ||
    input.expectedCompanyName.trim().toLowerCase() === input.connectedCompanyName.trim().toLowerCase();
  checks.push({
    key: 'company_match',
    label: 'QuickBooks company matches',
    status: companyMatches ? 'pass' : 'warn',
    message: companyMatches
      ? 'The connected QuickBooks company matches this workspace.'
      : `This workspace is named "${input.expectedCompanyName}" but the connected QuickBooks company is "${input.connectedCompanyName}".`,
    action: companyMatches ? undefined : { label: 'Review connection', href: '/settings/quickbooks' },
  });

  checks.push({
    key: 'duplicate_import',
    label: 'No duplicate imports',
    status: input.duplicateSnapshotCount > 0 ? 'warn' : 'pass',
    message:
      input.duplicateSnapshotCount > 0
        ? `${input.duplicateSnapshotCount} duplicate snapshot(s) were detected for this period.`
        : 'Each period is stored exactly once.',
  });

  const unmappedPct = m?.unmappedOpexPct ?? 0;
  if (input.unmappedExpenseAccountCount === 0 && unmappedPct === 0) {
    checks.push({
      key: 'mapping_coverage',
      label: 'Account mapping coverage',
      status: 'pass',
      message: 'Every active expense account is mapped to a management category.',
    });
  } else {
    const severe = unmappedPct >= 0.1;
    checks.push({
      key: 'mapping_coverage',
      label: 'Account mapping coverage',
      status: severe ? 'fail' : 'warn',
      message: `${formatPercent(unmappedPct)} of operating expenses are currently unmapped${input.unmappedExpenseAccountCount ? ` across ${input.unmappedExpenseAccountCount} account(s)` : ''}.`,
      action: { label: 'Review mappings', href: '/settings/account-mapping' },
    });
  }

  const uncategorizedTotal = input.uncategorizedBalances.reduce((a, b) => a + Math.abs(b.amount), 0);
  checks.push({
    key: 'uncategorized',
    label: 'Uncategorised / suspense accounts',
    status: uncategorizedTotal >= 1000 ? 'warn' : 'pass',
    message:
      uncategorizedTotal > 0
        ? `${formatCurrency(uncategorizedTotal)} sits in uncategorised or suspense accounts.`
        : 'No material balances in uncategorised or suspense accounts.',
  });

  if (input.requireLocationData) {
    checks.push({
      key: 'location_data',
      label: 'Location / class data available',
      status: input.locationRowCount > 0 ? 'pass' : 'fail',
      message:
        input.locationRowCount > 0
          ? `${input.locationRowCount} location/class segments captured for the period.`
          : 'Location reporting was requested but QuickBooks returned no location or class breakdown.',
      action: { label: 'Configure locations', href: '/settings/locations' },
    });
  }

  if (input.missingDimension && input.missingDimension.total > 0) {
    const ratio = safeDivide(input.missingDimension.missing, input.missingDimension.total) ?? 0;
    checks.push({
      key: 'dimension_coverage',
      label: 'Location/class assignment on transactions',
      status: ratio >= 0.2 ? 'warn' : 'pass',
      message: `${formatPercent(ratio)} of transactions in the period have no location or class assigned.`,
    });
  }

  if (input.negativeInventoryItems.length > 0) {
    checks.push({
      key: 'negative_inventory',
      label: 'Negative inventory',
      status: 'warn',
      message: `${input.negativeInventoryItems.length} item(s) have a negative quantity on hand: ${input.negativeInventoryItems.slice(0, 5).join(', ')}${input.negativeInventoryItems.length > 5 ? '…' : ''}.`,
    });
  }

  if (input.oldReceivables90Plus !== null && input.oldReceivables90Plus > 0) {
    checks.push({
      key: 'old_ar',
      label: 'Aged receivables',
      status: 'warn',
      message: `${formatCurrency(input.oldReceivables90Plus)} of receivables are more than 90 days old.`,
      action: { label: 'Open receivables', href: '/receivables' },
    });
  }
  if (input.oldPayables90Plus !== null && input.oldPayables90Plus > 0) {
    checks.push({
      key: 'old_ap',
      label: 'Aged payables',
      status: 'warn',
      message: `${formatCurrency(input.oldPayables90Plus)} of payables are more than 90 days old.`,
      action: { label: 'Open payables', href: '/payables' },
    });
  }

  if (input.unreconciledNote) {
    checks.push({
      key: 'reconciliation',
      label: 'Account reconciliation',
      status: 'warn',
      message: input.unreconciledNote,
    });
  }

  const failures = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');

  const uncategorizedTotalAmount = input.uncategorizedBalances.reduce((a, b) => a + Math.abs(b.amount), 0);
  const score = computeQualityScore({
    hasProfitAndLoss: Boolean(m && (m.netSales !== 0 || m.operatingExpenses !== 0)),
    hasBalanceSheet: m?.balanceSheetBalanced !== null && m?.balanceSheetBalanced !== undefined,
    hasReceivableAging: input.oldReceivables90Plus !== null,
    hasPayableAging: input.oldPayables90Plus !== null,
    balanceSheetBalanced: m?.balanceSheetBalanced ?? null,
    mappingCoverage: m ? 1 - m.unmappedOpexPct : null,
    unmappedAmount: m?.unmappedOpexAmount ?? 0,
    unmappedAccountCount: input.unmappedExpenseAccountCount,
    uncategorizedShareOfOpex:
      m && m.operatingExpenses > 0 ? uncategorizedTotalAmount / m.operatingExpenses : 0,
    uncategorizedAmount: uncategorizedTotalAmount,
    missingDimensionShare:
      input.missingDimension && input.missingDimension.total > 0
        ? input.missingDimension.missing / input.missingDimension.total
        : null,
    dimensionReportingActive: input.requireLocationData,
    lastSyncStatus: 'completed',
    syncWarningCount: 0,
    hasPriorMonth: true,
    hasSameMonthLastYear: true,
    trailingMonthsAvailable: 12,
    criticalAnomalies: 0,
    importantAnomalies: 0,
    daysSinceLastSync: null,
    periodIsIncomplete: incomplete,
    // The report builder supplies richer values; anything it passes wins.
    ...input.scoring,
    // Except the tie-out, which has its own dedicated field so a caller
    // cannot leave the most severe check out of the score by omission.
    statementTieOut: tie
      ? { ok: tie.ok, worstDifference: tie.worstDifference, compared: tie.compared }
      : null,
  });

  return {
    checks,
    score,
    confidence: score.confidence,
    reasons: [...failures, ...warnings].map((c) => c.message),
    blocking: checks.some((c) => c.key === 'pnl_present' && c.status === 'fail'),
  };
}
