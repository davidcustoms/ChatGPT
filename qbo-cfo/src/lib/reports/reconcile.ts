import { getCompany } from '../db/repositories/companies';
import { getMonthlyMetrics } from '../db/repositories/metrics';
import { getSnapshot } from '../db/repositories/snapshots';
import { accountIndex } from '../db/repositories/masterdata';
import { AppError } from '../errors';
import { round2 } from '../finance/math';
import type { AccountingMethod } from '../finance/basis';
import { flattenReport, summaryByGroup, summaryByLabel } from '../qbo/parse';
import { parseBalanceSheet } from '../qbo/statements';
import type { QboReport } from '../qbo/report-types';
import type { Period } from '../util/dates';

/**
 * Financial reconciliation.
 *
 * Compares what the application reports against what QuickBooks itself
 * reported, reading QuickBooks' own subtotal rows straight out of the stored
 * raw snapshot rather than through the application's classification logic.
 * That independence is the point: if the two agree, the transformation is
 * faithful; if they do not, the difference is a real defect to fix rather than
 * a tolerance to widen.
 */

export type ReconcileStatus = 'MATCH' | 'DIFFERS' | 'UNAVAILABLE';

export interface ReconcileLine {
  metric: string;
  appValue: number | null;
  quickbooksValue: number | null;
  difference: number | null;
  status: ReconcileStatus;
  /** Why a documented difference is expected, when it is. */
  note: string | null;
}

export interface ReconcileResult {
  companyId: string;
  companyName: string;
  period: Period;
  accountingMethod: AccountingMethod;
  sourceSystem: string;
  lines: ReconcileLine[];
  matched: number;
  differing: number;
  unavailable: number;
  pass: boolean;
  snapshotIds: { profitAndLoss: string | null; balanceSheet: string | null };
  generatedAt: string;
}

/** Money is compared to the cent. Anything larger is a defect, not a rounding artefact. */
const TOLERANCE = 0.005;

function compare(
  metric: string,
  appValue: number | null,
  quickbooksValue: number | null,
  note: string | null = null,
): ReconcileLine {
  if (appValue === null || quickbooksValue === null) {
    return { metric, appValue, quickbooksValue, difference: null, status: 'UNAVAILABLE', note };
  }
  const difference = round2(appValue - quickbooksValue);
  return {
    metric,
    appValue: round2(appValue),
    quickbooksValue: round2(quickbooksValue),
    difference,
    status: Math.abs(difference) < TOLERANCE ? 'MATCH' : 'DIFFERS',
    note,
  };
}

export async function reconcilePeriod(input: {
  companyId: string;
  period: Period;
}): Promise<ReconcileResult> {
  const company = await getCompany(input.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const metrics = await getMonthlyMetrics(input.companyId, input.period);
  if (!metrics) {
    throw new AppError(
      'QBO_EMPTY_PERIOD',
      `No computed metrics for ${input.period.start.slice(0, 7)}. Sync the month before reconciling.`,
    );
  }

  const basis = metrics.accountingMethod;
  const [pnlSnapshot, bsSnapshot, accounts] = await Promise.all([
    getSnapshot<QboReport>(input.companyId, 'ProfitAndLoss', input.period, 'total', basis),
    getSnapshot<QboReport>(input.companyId, 'BalanceSheet', input.period, 'total', basis),
    accountIndex(input.companyId),
  ]);

  const lines: ReconcileLine[] = [];

  // --- Income statement, straight from QuickBooks' own subtotal rows --------
  if (pnlSnapshot) {
    const flat = flattenReport(pnlSnapshot.payload);
    const qb = {
      totalIncome: summaryByGroup(flat, 'Income') ?? summaryByLabel(flat, 'Total Income'),
      totalCogs: summaryByGroup(flat, 'COGS') ?? summaryByLabel(flat, 'Total Cost of Goods Sold'),
      grossProfit: summaryByGroup(flat, 'GrossProfit') ?? summaryByLabel(flat, 'Gross Profit'),
      totalExpenses: summaryByGroup(flat, 'Expenses') ?? summaryByLabel(flat, 'Total Expenses'),
      netOperatingIncome:
        summaryByGroup(flat, 'NetOperatingIncome') ?? summaryByLabel(flat, 'Net Operating Income'),
      netIncome: summaryByGroup(flat, 'NetIncome') ?? summaryByLabel(flat, 'Net Income'),
    };

    lines.push(
      compare('Total Income', metrics.netSales, qb.totalIncome,
        'The application reports Net Revenue (gross sales less discounts and returns). QuickBooks Total Income is the same figure: contra-revenue accounts are negative income lines inside that subtotal.'),
      compare('Net Revenue', metrics.netSales, qb.totalIncome, null),
      compare('COGS', metrics.cogs, qb.totalCogs, null),
      compare('Gross Profit', metrics.grossProfit, qb.grossProfit, null),
      compare('Total Operating Expenses', metrics.operatingExpenses, qb.totalExpenses, null),
      compare('Operating Income', metrics.netOperatingIncome, qb.netOperatingIncome, null),
      compare('Net Income', metrics.netIncome, qb.netIncome, null),
    );

    // Gross margin is a ratio; reconcile it as a derived check rather than a
    // reported figure, since QuickBooks does not print it.
    const qbMargin =
      qb.grossProfit !== null && qb.totalIncome !== null && qb.totalIncome !== 0
        ? qb.grossProfit / qb.totalIncome
        : null;
    lines.push({
      metric: 'Gross Margin',
      appValue: metrics.grossMargin,
      quickbooksValue: qbMargin,
      difference:
        metrics.grossMargin !== null && qbMargin !== null
          ? Number((metrics.grossMargin - qbMargin).toFixed(6))
          : null,
      status:
        metrics.grossMargin === null || qbMargin === null
          ? 'UNAVAILABLE'
          : Math.abs(metrics.grossMargin - qbMargin) < 0.000005
            ? 'MATCH'
            : 'DIFFERS',
      note: 'QuickBooks does not print a gross margin percentage; this is gross profit divided by total income from the same report.',
    });
  } else {
    for (const metric of [
      'Total Income', 'Net Revenue', 'COGS', 'Gross Profit', 'Gross Margin',
      'Total Operating Expenses', 'Operating Income', 'Net Income',
    ]) {
      lines.push({
        metric,
        appValue: null,
        quickbooksValue: null,
        difference: null,
        status: 'UNAVAILABLE',
        note: `No ${basis}-basis Profit & Loss snapshot is stored for this period.`,
      });
    }
  }

  // --- Balance sheet -------------------------------------------------------
  if (bsSnapshot) {
    // Re-parse independently from the raw snapshot so the comparison does not
    // simply echo the stored metrics back at themselves.
    const bs = parseBalanceSheet(flattenReport(bsSnapshot.payload), accounts);
    lines.push(
      compare('Cash', metrics.cash, bs.cash, null),
      compare('Accounts Receivable', metrics.accountsReceivable, bs.accountsReceivable, null),
      compare('Accounts Payable', metrics.accountsPayable, bs.accountsPayable, null),
      compare('Inventory', metrics.inventoryValue, bs.inventory, null),
      compare('Current Assets', metrics.currentAssets, bs.currentAssets, null),
      compare('Total Assets', metrics.totalAssets, bs.totalAssets, null),
      compare('Current Liabilities', metrics.currentLiabilities, bs.currentLiabilities, null),
      compare('Total Liabilities', metrics.totalLiabilities, bs.totalLiabilities, null),
      compare('Equity', metrics.equity, bs.equity, null),
    );

    // The accounting identity itself, checked against the raw snapshot.
    const identity =
      bs.totalAssets !== null && bs.totalLiabilities !== null && bs.equity !== null
        ? round2(bs.totalAssets - (bs.totalLiabilities + bs.equity))
        : null;
    lines.push({
      metric: 'Assets = Liabilities + Equity',
      appValue: metrics.totalAssets,
      quickbooksValue:
        bs.totalLiabilities !== null && bs.equity !== null ? round2(bs.totalLiabilities + bs.equity) : null,
      difference: identity,
      status: identity === null ? 'UNAVAILABLE' : Math.abs(identity) < TOLERANCE ? 'MATCH' : 'DIFFERS',
      note: 'The accounting identity, checked directly against the stored QuickBooks Balance Sheet.',
    });
  } else {
    for (const metric of [
      'Cash', 'Accounts Receivable', 'Accounts Payable', 'Inventory', 'Current Assets',
      'Total Assets', 'Current Liabilities', 'Total Liabilities', 'Equity',
      'Assets = Liabilities + Equity',
    ]) {
      lines.push({
        metric,
        appValue: null,
        quickbooksValue: null,
        difference: null,
        status: 'UNAVAILABLE',
        note: `No ${basis}-basis Balance Sheet snapshot is stored for this period.`,
      });
    }
  }

  const matched = lines.filter((l) => l.status === 'MATCH').length;
  const differing = lines.filter((l) => l.status === 'DIFFERS').length;
  const unavailable = lines.filter((l) => l.status === 'UNAVAILABLE').length;

  return {
    companyId: input.companyId,
    companyName: company.name,
    period: input.period,
    accountingMethod: basis,
    sourceSystem: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
    lines,
    matched,
    differing,
    unavailable,
    pass: differing === 0,
    snapshotIds: {
      profitAndLoss: pnlSnapshot?.id ?? null,
      balanceSheet: bsSnapshot?.id ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Renders the reconciliation as the Markdown table the runbook asks for. */
export function renderReconcileTable(result: ReconcileResult): string {
  const money = (v: number | null, metric: string): string => {
    if (v === null) return '—';
    if (metric === 'Gross Margin') return `${(v * 100).toFixed(4)}%`;
    return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  };

  const rows = result.lines.map((l) => {
    const diff =
      l.difference === null
        ? '—'
        : l.metric === 'Gross Margin'
          ? `${(l.difference * 100).toFixed(6)} pts`
          : l.difference.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    const icon = l.status === 'MATCH' ? 'MATCH' : l.status === 'DIFFERS' ? '**DIFFERS**' : 'UNAVAILABLE';
    return `| ${l.metric} | ${money(l.appValue, l.metric)} | ${money(l.quickbooksValue, l.metric)} | ${diff} | ${icon} |`;
  });

  return [
    `| Metric | App Value | QuickBooks Value | Difference | Status |`,
    `|---|---:|---:|---:|---|`,
    ...rows,
  ].join('\n');
}
