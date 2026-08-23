import { round2, safeDivide } from './math';
import type { LocationMetrics } from './types';
import type { AccountIndex } from '../qbo/statements';
import { parseProfitAndLoss } from '../qbo/statements';
import type { FlatReport } from '../qbo/report-types';
import type { Period } from '../util/dates';

/**
 * Store / location analysis.
 *
 * QuickBooks returns a column per Location (Department) or Class when the P&L
 * is summarised by that dimension. Each column is parsed as its own P&L, so a
 * store's revenue and expenses come from QuickBooks' own arithmetic.
 *
 * IMPORTANT: shared corporate overhead is *not* pushed down into stores. The
 * per-store bottom line is therefore labelled "Store Contribution Before
 * Corporate Overhead" everywhere it is displayed.
 */

export const CONTRIBUTION_LABEL = 'Store Contribution Before Corporate Overhead';

const IGNORED_COLUMN_TITLES = new Set(['', 'total', 'memo/description']);

export function buildLocationMetrics(input: {
  flat: FlatReport;
  accounts: AccountIndex;
  mapping: ReadonlyMap<string, string>;
  dimension: 'location' | 'class';
  period: Period;
  /** qboId -> display name, so renamed stores show the owner's label. */
  displayNames?: ReadonlyMap<string, string>;
}): LocationMetrics[] {
  const { flat, accounts, mapping, dimension, period } = input;
  const out: LocationMetrics[] = [];

  flat.columns.forEach((column, index) => {
    const title = column.title.trim();
    if (IGNORED_COLUMN_TITLES.has(title.toLowerCase())) return;

    const pnl = parseProfitAndLoss(flat, accounts, index);
    if (
      pnl.totalIncome === 0 &&
      pnl.totalCogs === 0 &&
      pnl.totalExpenses === 0
    ) {
      return; // empty column, e.g. a store with no activity this month
    }

    let payroll = 0;
    let advertising = 0;
    let rent = 0;
    for (const line of pnl.lines) {
      if (line.section !== 'expense' && line.section !== 'other_expense') continue;
      const key = line.accountQboId ? mapping.get(line.accountQboId) : undefined;
      if (key === 'payroll') payroll = round2(payroll + line.amount);
      else if (key === 'advertising') advertising = round2(advertising + line.amount);
      else if (key === 'rent') rent = round2(rent + line.amount);
    }

    const netSales = pnl.totalIncome;
    const grossProfit = pnl.grossProfit;
    const operatingExpenses = pnl.totalExpenses;
    const contributionProfit = round2(grossProfit - operatingExpenses);
    const displayName =
      (column.metaId && input.displayNames?.get(column.metaId)) || title;

    out.push({
      period,
      dimension,
      dimensionQboId: column.metaId,
      dimensionName: displayName,
      netSales,
      cogs: pnl.totalCogs,
      grossProfit,
      grossMargin: safeDivide(grossProfit, netSales),
      payrollExpense: payroll,
      advertisingExpense: advertising,
      rentExpense: rent,
      operatingExpenses,
      contributionProfit,
      contributionMargin: safeDivide(contributionProfit, netSales),
      overheadAllocated: false,
    });
  });

  return out.sort((a, b) => b.netSales - a.netSales);
}

export interface StorePerformanceRow extends LocationMetrics {
  revenueMoM: number | null;
  revenueYoY: number | null;
  payrollPct: number | null;
  rank: number;
}

/** Ranks stores strongest to weakest by contribution margin, then revenue. */
export function rankStores(
  current: LocationMetrics[],
  priorMonth: LocationMetrics[],
  lastYear: LocationMetrics[],
): StorePerformanceRow[] {
  const byName = (rows: LocationMetrics[]) => new Map(rows.map((r) => [r.dimensionName, r]));
  const prev = byName(priorMonth);
  const ly = byName(lastYear);

  const pct = (cur: number, base: number | undefined): number | null =>
    base === undefined || base === 0 ? null : (cur - base) / Math.abs(base);

  return current
    .map((row) => ({
      ...row,
      revenueMoM: pct(row.netSales, prev.get(row.dimensionName)?.netSales),
      revenueYoY: pct(row.netSales, ly.get(row.dimensionName)?.netSales),
      payrollPct: safeDivide(row.payrollExpense, row.netSales),
      rank: 0,
    }))
    .sort((a, b) => {
      const am = a.contributionMargin ?? -Infinity;
      const bm = b.contributionMargin ?? -Infinity;
      if (am !== bm) return bm - am;
      return b.netSales - a.netSales;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
