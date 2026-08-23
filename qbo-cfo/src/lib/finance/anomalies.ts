import { categoryLabel } from './categories';
import { average, pctChange, round2, safeDivide } from './math';
import { param, resolveThresholds, ruleEnabled, type ThresholdMap } from './anomaly-rules';
import type { AgingSnapshot, Anomaly, MonthlyMetrics, Severity, VendorSpend } from './types';
import { formatCurrency, formatPercent, formatPoints } from '../util/format';

/**
 * Deterministic anomaly detection.
 *
 * This runs *before* any AI commentary: the language model receives the
 * findings, it does not produce them. Every anomaly carries the exact numbers
 * that triggered it so the narrative can quote them without inventing values.
 */

export interface DetectInput {
  current: MonthlyMetrics;
  priorMonth: MonthlyMetrics | null;
  sameMonthLastYear: MonthlyMetrics | null;
  trailing: MonthlyMetrics[];
  categoryTotals: Map<string, number>;
  priorCategoryTotals: Map<string, number> | null;
  trailingCategoryTotals: Array<Map<string, number>>;
  vendorSpend: VendorSpend[];
  priorVendorSpend: VendorSpend[];
  newVendors: Array<{ vendorName: string; amount: number }>;
  duplicates: Array<{ entityName: string | null; amount: number; dates: string[]; count: number }>;
  arAging: AgingSnapshot | null;
  priorArAging: AgingSnapshot | null;
  apAging: AgingSnapshot | null;
  priorApAging: AgingSnapshot | null;
  uncategorizedBalances: Array<{ accountName: string; amount: number }>;
  largeTransactions: Array<{ description: string; amount: number; date: string; txnType: string }>;
  /** Per-transaction-type historical medians/p90, so routine large bills are not flagged. */
  transactionHistoryByType?: Map<string, { median: number; p90: number; count: number }>;
  thresholdOverrides?: Array<{ ruleKey: string; enabled: boolean; params: Record<string, number> }>;
  materialityAmount: number;
  materialityPct: number;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  INFO: 1,
  WATCH: 2,
  IMPORTANT: 3,
  CRITICAL: 4,
};

/**
 * Score = severity weight x normalised dollar impact. Used to rank the
 * "Needs Your Attention" list so the biggest problems surface first.
 */
function score(severity: Severity, dollarImpact: number | null, revenue: number): number {
  const impact = dollarImpact === null ? 0 : Math.abs(dollarImpact);
  const relative = revenue > 0 ? Math.min(impact / revenue, 1) : 0;
  return round2(SEVERITY_WEIGHT[severity] * 10 + relative * 100 + Math.min(impact / 1000, 50));
}

function severityFor(
  magnitude: number,
  threshold: number,
  dollarImpact: number,
  materialityAmount: number,
): Severity {
  const ratio = threshold === 0 ? 1 : Math.abs(magnitude) / Math.abs(threshold);
  const big = Math.abs(dollarImpact) >= materialityAmount * 5;
  if (ratio >= 3 && big) return 'CRITICAL';
  if (ratio >= 2 || big) return 'IMPORTANT';
  if (ratio >= 1) return 'WATCH';
  return 'INFO';
}

export function detectAnomalies(input: DetectInput): Anomaly[] {
  const thresholds: ThresholdMap = resolveThresholds(input.thresholdOverrides ?? []);
  const out: Anomaly[] = [];
  const { current, priorMonth, sameMonthLastYear } = input;
  const revenue = current.netSales;
  const materiality = input.materialityAmount;

  const push = (a: Omit<Anomaly, 'score'> & { score?: number }): void => {
    out.push({ ...a, score: a.score ?? score(a.severity, a.deltaAmount, revenue) });
  };

  // --- Revenue -------------------------------------------------------------
  if (ruleEnabled(thresholds, 'revenue_mom') && priorMonth) {
    const threshold = param(thresholds, 'revenue_mom', 'pct', 0.1);
    const change = pctChange(revenue, priorMonth.netSales);
    const amount = round2(revenue - priorMonth.netSales);
    if (change !== null && Math.abs(change) >= threshold) {
      const direction = change > 0 ? 'increased' : 'decreased';
      push({
        ruleKey: 'revenue_mom',
        severity: severityFor(change, threshold, amount, materiality),
        category: 'Revenue',
        title: `Revenue ${direction} ${formatPercent(Math.abs(change))} month over month`,
        detail: `Net revenue of ${formatCurrency(revenue)} compares with ${formatCurrency(priorMonth.netSales)} last month, a change of ${formatCurrency(amount)}.`,
        metricKey: 'net_sales',
        currentValue: revenue,
        comparisonValue: priorMonth.netSales,
        deltaAmount: amount,
        deltaPct: change,
        evidence: { threshold, comparison: 'prior_month' },
      });
    }
  }

  if (ruleEnabled(thresholds, 'revenue_yoy') && sameMonthLastYear) {
    const threshold = param(thresholds, 'revenue_yoy', 'pct', 0.15);
    const change = pctChange(revenue, sameMonthLastYear.netSales);
    const amount = round2(revenue - sameMonthLastYear.netSales);
    if (change !== null && Math.abs(change) >= threshold) {
      push({
        ruleKey: 'revenue_yoy',
        severity: severityFor(change, threshold, amount, materiality),
        category: 'Revenue',
        title: `Revenue ${change > 0 ? 'up' : 'down'} ${formatPercent(Math.abs(change))} year over year`,
        detail: `Net revenue of ${formatCurrency(revenue)} compares with ${formatCurrency(sameMonthLastYear.netSales)} in the same month last year.`,
        metricKey: 'net_sales',
        currentValue: revenue,
        comparisonValue: sameMonthLastYear.netSales,
        deltaAmount: amount,
        deltaPct: change,
        evidence: { threshold, comparison: 'same_month_last_year' },
      });
    }
  }

  // --- Gross margin --------------------------------------------------------
  if (ruleEnabled(thresholds, 'gross_margin_shift') && priorMonth) {
    const threshold = param(thresholds, 'gross_margin_shift', 'points', 0.02);
    const cur = current.grossMargin;
    const prev = priorMonth.grossMargin;
    if (cur !== null && prev !== null && Math.abs(cur - prev) >= threshold) {
      const points = cur - prev;
      // Dollar impact of the margin move at this month's revenue.
      const impact = round2(revenue * points);
      push({
        ruleKey: 'gross_margin_shift',
        severity: severityFor(points, threshold, impact, materiality),
        category: 'Margin',
        title: `Gross margin ${points > 0 ? 'improved' : 'declined'} ${formatPoints(Math.abs(points))}`,
        detail: `Gross margin moved from ${formatPercent(prev)} to ${formatPercent(cur)}. At ${formatCurrency(revenue)} of revenue this is worth ${formatCurrency(Math.abs(impact))} of gross profit.`,
        metricKey: 'gross_margin',
        currentValue: cur,
        comparisonValue: prev,
        deltaAmount: impact,
        deltaPct: null,
        evidence: { threshold, points },
      });
    }
  }

  // --- Expense categories --------------------------------------------------
  const spikePct = param(thresholds, 'expense_spike', 'pct', 0.2);
  const spikeAmount = param(thresholds, 'expense_spike', 'amount', 2000);
  const trailingMultiple = param(thresholds, 'expense_vs_trailing', 'multiple', 1.2);
  const trailingMonths = Math.round(param(thresholds, 'expense_vs_trailing', 'months', 6));
  const trailingExcess = param(thresholds, 'expense_vs_trailing', 'amount', 1000);

  const expenseKeys = new Set<string>([
    ...input.categoryTotals.keys(),
    ...(input.priorCategoryTotals?.keys() ?? []),
  ]);
  const skip = new Set(['revenue', 'discounts', 'returns', 'other_income']);

  for (const key of expenseKeys) {
    if (skip.has(key)) continue;
    const cur = input.categoryTotals.get(key) ?? 0;
    const prev = input.priorCategoryTotals?.get(key) ?? null;

    if (ruleEnabled(thresholds, 'expense_spike') && prev !== null && prev !== 0) {
      const change = pctChange(cur, prev);
      const amount = round2(cur - prev);
      if (change !== null && change >= spikePct && amount >= spikeAmount) {
        push({
          ruleKey: 'expense_spike',
          severity: severityFor(change, spikePct, amount, materiality),
          category: 'Expenses',
          title: `${categoryLabel(key)} increased ${formatPercent(change)}`,
          detail: `${categoryLabel(key)} was ${formatCurrency(cur)} versus ${formatCurrency(prev)} last month, an increase of ${formatCurrency(amount)}${revenue > 0 ? ` (${formatPercent(safeDivide(cur, revenue))} of revenue)` : ''}.`,
          metricKey: `category:${key}`,
          currentValue: cur,
          comparisonValue: prev,
          deltaAmount: amount,
          deltaPct: change,
          evidence: { threshold_pct: spikePct, threshold_amount: spikeAmount, category: key },
        });
      }
    }

    if (ruleEnabled(thresholds, 'expense_vs_trailing')) {
      const history = input.trailingCategoryTotals
        .slice(Math.max(0, input.trailingCategoryTotals.length - trailingMonths))
        .map((m) => m.get(key))
        .filter((v): v is number => typeof v === 'number');
      const avg = average(history);
      if (avg !== null && avg > 0 && cur >= avg * trailingMultiple && cur - avg >= trailingExcess) {
        const excess = round2(cur - avg);
        push({
          ruleKey: 'expense_vs_trailing',
          severity: severityFor(cur / avg, trailingMultiple, excess, materiality),
          category: 'Expenses',
          title: `${categoryLabel(key)} is ${formatPercent(cur / avg - 1)} above its ${trailingMonths}-month average`,
          detail: `${categoryLabel(key)} of ${formatCurrency(cur)} compares with a ${trailingMonths}-month average of ${formatCurrency(avg)}, an excess of ${formatCurrency(excess)}.`,
          metricKey: `category:${key}`,
          currentValue: cur,
          comparisonValue: avg,
          deltaAmount: excess,
          deltaPct: safeDivide(excess, avg),
          evidence: { multiple: trailingMultiple, months: trailingMonths, category: key },
        });
      }
    }
  }

  // --- Payroll ratio -------------------------------------------------------
  if (ruleEnabled(thresholds, 'payroll_ratio') && priorMonth) {
    const threshold = param(thresholds, 'payroll_ratio', 'points', 0.02);
    const cur = safeDivide(current.payrollExpense, revenue);
    const prev = safeDivide(priorMonth.payrollExpense, priorMonth.netSales);
    if (cur !== null && prev !== null && cur - prev >= threshold) {
      const impact = round2(revenue * (cur - prev));
      push({
        ruleKey: 'payroll_ratio',
        severity: severityFor(cur - prev, threshold, impact, materiality),
        category: 'Payroll',
        title: `Payroll rose to ${formatPercent(cur)} of revenue`,
        detail: `Payroll was ${formatCurrency(current.payrollExpense)} on ${formatCurrency(revenue)} of revenue (${formatPercent(cur)}), against ${formatPercent(prev)} last month. Holding last month's ratio would have cost ${formatCurrency(Math.abs(impact))} less.`,
        metricKey: 'payroll_pct_revenue',
        currentValue: cur,
        comparisonValue: prev,
        deltaAmount: impact,
        deltaPct: null,
        evidence: { threshold, points: cur - prev },
      });
    }
  }

  // --- Advertising efficiency ---------------------------------------------
  if (ruleEnabled(thresholds, 'ad_spend_divergence') && priorMonth) {
    const adPctThreshold = param(thresholds, 'ad_spend_divergence', 'adPct', 0.05);
    const revPctCeiling = param(thresholds, 'ad_spend_divergence', 'revPct', 0);
    const adChange = pctChange(current.advertisingExpense, priorMonth.advertisingExpense);
    const revChange = pctChange(revenue, priorMonth.netSales);
    if (
      adChange !== null &&
      revChange !== null &&
      adChange >= adPctThreshold &&
      revChange <= revPctCeiling
    ) {
      const amount = round2(current.advertisingExpense - priorMonth.advertisingExpense);
      push({
        ruleKey: 'ad_spend_divergence',
        severity: 'IMPORTANT',
        category: 'Advertising Efficiency',
        title: `Advertising rose ${formatPercent(adChange)} while revenue ${revChange < 0 ? 'fell' : 'was flat'}`,
        detail: `Advertising increased ${formatCurrency(amount)} to ${formatCurrency(current.advertisingExpense)} while revenue changed ${formatPercent(revChange, 1, { signed: true })}.`,
        metricKey: 'advertising_expense',
        currentValue: current.advertisingExpense,
        comparisonValue: priorMonth.advertisingExpense,
        deltaAmount: amount,
        deltaPct: adChange,
        evidence: { ad_change: adChange, revenue_change: revChange },
      });
    }
  }

  // --- Cash ----------------------------------------------------------------
  if (ruleEnabled(thresholds, 'cash_decline') && priorMonth && current.cash !== null && priorMonth.cash !== null) {
    const pctThreshold = param(thresholds, 'cash_decline', 'pct', 0.15);
    const amountThreshold = param(thresholds, 'cash_decline', 'amount', 5000);
    const change = pctChange(current.cash, priorMonth.cash);
    const amount = round2(current.cash - priorMonth.cash);
    if (change !== null && change <= -pctThreshold && Math.abs(amount) >= amountThreshold) {
      push({
        ruleKey: 'cash_decline',
        severity: severityFor(change, pctThreshold, amount, materiality),
        category: 'Cash',
        title: `Cash declined ${formatPercent(Math.abs(change))}`,
        detail: `Cash fell ${formatCurrency(Math.abs(amount))} from ${formatCurrency(priorMonth.cash)} to ${formatCurrency(current.cash)}${current.netIncome > 0 ? ', despite positive net income for the month' : ''}.`,
        metricKey: 'cash',
        currentValue: current.cash,
        comparisonValue: priorMonth.cash,
        deltaAmount: amount,
        deltaPct: change,
        evidence: { threshold_pct: pctThreshold, net_income: current.netIncome },
      });
    }
  }

  // --- Aging ---------------------------------------------------------------
  const agingRule = (
    key: 'ar_90_growth' | 'ap_90_growth',
    label: string,
    cur: AgingSnapshot | null,
    prev: AgingSnapshot | null,
  ): void => {
    if (!ruleEnabled(thresholds, key) || !cur) return;
    const pctThreshold = param(thresholds, key, 'pct', 0.2);
    const amountThreshold = param(thresholds, key, 'amount', 2500);
    const curValue = cur.total.days90Plus;
    const prevValue = prev?.total.days90Plus ?? null;
    const change = prevValue !== null ? pctChange(curValue, prevValue) : null;
    const amount = prevValue !== null ? round2(curValue - prevValue) : curValue;
    const triggered =
      prevValue === null
        ? curValue >= amountThreshold * 2
        : change !== null && change >= pctThreshold && amount >= amountThreshold;
    if (!triggered) return;
    push({
      ruleKey: key,
      severity: severityFor(change ?? 1, pctThreshold, amount, materiality),
      category: key === 'ar_90_growth' ? 'Receivables' : 'Payables',
      title: `${label} over 90 days ${prevValue === null ? 'stands at' : 'grew to'} ${formatCurrency(curValue)}`,
      detail:
        prevValue === null
          ? `${formatCurrency(curValue)} of ${label.toLowerCase()} is more than 90 days old.`
          : `${label} over 90 days moved from ${formatCurrency(prevValue)} to ${formatCurrency(curValue)}, an increase of ${formatCurrency(amount)}.`,
      metricKey: key,
      currentValue: curValue,
      comparisonValue: prevValue,
      deltaAmount: amount,
      deltaPct: change,
      evidence: { as_of: cur.asOf },
    });
  };
  agingRule('ar_90_growth', 'Receivables', input.arAging, input.priorArAging);
  agingRule('ap_90_growth', 'Payables', input.apAging, input.priorApAging);

  // --- Fee spikes ----------------------------------------------------------
  const feeRule = (
    key: 'bank_fee_spike' | 'financing_fee_spike',
    categoryKey: string,
    label: string,
  ): void => {
    if (!ruleEnabled(thresholds, key)) return;
    const multiple = param(thresholds, key, 'multiple', 1.5);
    const minExcess = param(thresholds, key, 'amount', 250);
    const cur = input.categoryTotals.get(categoryKey) ?? 0;
    const history = input.trailingCategoryTotals
      .map((m) => m.get(categoryKey))
      .filter((v): v is number => typeof v === 'number');
    const avg = average(history);
    if (avg === null || avg <= 0) return;
    const excess = round2(cur - avg);
    if (cur >= avg * multiple && excess >= minExcess) {
      push({
        ruleKey: key,
        severity: severityFor(cur / avg, multiple, excess, materiality),
        category: label,
        title: `${label} of ${formatCurrency(cur)} are ${formatPercent(cur / avg - 1)} above average`,
        detail: `${label} were ${formatCurrency(cur)} against a trailing average of ${formatCurrency(avg)}.`,
        metricKey: `category:${categoryKey}`,
        currentValue: cur,
        comparisonValue: avg,
        deltaAmount: excess,
        deltaPct: safeDivide(excess, avg),
        evidence: { multiple },
      });
    }
  };
  feeRule('bank_fee_spike', 'bank_fees', 'Bank fees');
  feeRule('financing_fee_spike', 'financing_fees', 'Financing fees');

  // --- Merchant processing rate -------------------------------------------
  if (ruleEnabled(thresholds, 'merchant_rate_shift') && priorMonth) {
    const threshold = param(thresholds, 'merchant_rate_shift', 'points', 0.003);
    const cur = safeDivide(current.merchantFees, revenue);
    const prev = safeDivide(priorMonth.merchantFees, priorMonth.netSales);
    if (cur !== null && prev !== null && Math.abs(cur - prev) >= threshold) {
      const impact = round2(revenue * (cur - prev));
      push({
        ruleKey: 'merchant_rate_shift',
        severity: severityFor(cur - prev, threshold, impact, materiality),
        category: 'Merchant Processing',
        title: `Merchant processing cost moved to ${formatPercent(cur, 2)} of revenue`,
        detail: `Merchant fees were ${formatCurrency(current.merchantFees)} on ${formatCurrency(revenue)} of revenue (${formatPercent(cur, 2)}), against ${formatPercent(prev, 2)} last month.`,
        metricKey: 'merchant_fees_pct_revenue',
        currentValue: cur,
        comparisonValue: prev,
        deltaAmount: impact,
        deltaPct: null,
        evidence: { threshold },
      });
    }
  }

  // --- Vendors -------------------------------------------------------------
  if (ruleEnabled(thresholds, 'new_large_vendor')) {
    const threshold = param(thresholds, 'new_large_vendor', 'amount', 5000);
    for (const vendor of input.newVendors) {
      if (vendor.amount < threshold) continue;
      push({
        ruleKey: 'new_large_vendor',
        severity: vendor.amount >= threshold * 3 ? 'IMPORTANT' : 'WATCH',
        category: 'Vendors',
        title: `New vendor ${vendor.vendorName} with ${formatCurrency(vendor.amount)} of spend`,
        detail: `${vendor.vendorName} has no transactions before this month and was paid ${formatCurrency(vendor.amount)}.`,
        metricKey: 'vendor_spend',
        currentValue: vendor.amount,
        comparisonValue: null,
        deltaAmount: vendor.amount,
        deltaPct: null,
        evidence: { vendor: vendor.vendorName },
      });
    }
  }

  if (ruleEnabled(thresholds, 'vendor_spend_jump')) {
    const pctT = param(thresholds, 'vendor_spend_jump', 'pct', 0.5);
    const amtT = param(thresholds, 'vendor_spend_jump', 'amount', 5000);
    const priorByName = new Map(input.priorVendorSpend.map((v) => [v.vendorName, v.amount]));
    for (const vendor of input.vendorSpend) {
      const prev = priorByName.get(vendor.vendorName);
      if (prev === undefined || prev <= 0) continue;
      const change = pctChange(vendor.amount, prev);
      const amount = round2(vendor.amount - prev);
      if (change !== null && change >= pctT && amount >= amtT) {
        push({
          ruleKey: 'vendor_spend_jump',
          severity: severityFor(change, pctT, amount, materiality),
          category: 'Vendors',
          title: `Spend with ${vendor.vendorName} rose ${formatPercent(change)}`,
          detail: `${vendor.vendorName} was paid ${formatCurrency(vendor.amount)} versus ${formatCurrency(prev)} last month, an increase of ${formatCurrency(amount)}.`,
          metricKey: 'vendor_spend',
          currentValue: vendor.amount,
          comparisonValue: prev,
          deltaAmount: amount,
          deltaPct: change,
          evidence: { vendor: vendor.vendorName },
        });
      }
    }
  }

  // --- Transactions --------------------------------------------------------
  if (ruleEnabled(thresholds, 'large_transaction')) {
    const threshold = param(thresholds, 'large_transaction', 'amount', 25000);
    for (const txn of input.largeTransactions) {
      const magnitude = Math.abs(txn.amount);
      if (magnitude < threshold) continue;
      // A large amount is only notable if it is also large *for this kind of
      // transaction*. A $38k inventory bill is routine for a furniture
      // retailer; a $38k professional fee is not.
      const history = input.transactionHistoryByType?.get(txn.txnType);
      const routine = history !== undefined && history.count >= 8 && history.p90 > 0 && magnitude <= history.p90 * 1.5;
      if (routine) continue;
      push({
        ruleKey: 'large_transaction',
        severity: magnitude >= threshold * 3 ? 'IMPORTANT' : 'WATCH',
        category: 'Transactions',
        title: `Large transaction: ${txn.description} (${formatCurrency(txn.amount)})`,
        detail: history
          ? `A single ${txn.txnType} of ${formatCurrency(txn.amount)} was recorded on ${txn.date}, against a 90th-percentile ${txn.txnType} of ${formatCurrency(history.p90)} over the past twelve months.`
          : `A single transaction of ${formatCurrency(txn.amount)} was recorded on ${txn.date}.`,
        metricKey: 'transaction',
        currentValue: txn.amount,
        comparisonValue: history?.p90 ?? threshold,
        deltaAmount: txn.amount,
        deltaPct: null,
        evidence: { date: txn.date, txn_type: txn.txnType, p90: history?.p90 ?? null },
      });
    }
  }

  if (ruleEnabled(thresholds, 'duplicate_transactions')) {
    const threshold = param(thresholds, 'duplicate_transactions', 'amount', 1000);
    for (const dup of input.duplicates) {
      if (Math.abs(dup.amount) < threshold) continue;
      push({
        ruleKey: 'duplicate_transactions',
        severity: 'WATCH',
        category: 'Transactions',
        title: `Possible duplicate: ${dup.entityName ?? 'unknown payee'} x${dup.count} at ${formatCurrency(dup.amount)}`,
        detail: `${dup.count} transactions of exactly ${formatCurrency(dup.amount)} for ${dup.entityName ?? 'an unknown payee'} were recorded on ${dup.dates.join(', ')}. Review before treating as separate charges.`,
        metricKey: 'duplicate',
        currentValue: round2(dup.amount * dup.count),
        comparisonValue: dup.amount,
        deltaAmount: round2(dup.amount * (dup.count - 1)),
        deltaPct: null,
        evidence: { dates: dup.dates, count: dup.count },
      });
    }
  }

  // --- Data quality --------------------------------------------------------
  if (ruleEnabled(thresholds, 'uncategorized_balance')) {
    const threshold = param(thresholds, 'uncategorized_balance', 'amount', 1000);
    for (const acct of input.uncategorizedBalances) {
      if (Math.abs(acct.amount) < threshold) continue;
      push({
        ruleKey: 'uncategorized_balance',
        severity: 'IMPORTANT',
        category: 'Data Quality',
        title: `${acct.accountName} carries ${formatCurrency(acct.amount)}`,
        detail: `${formatCurrency(acct.amount)} sits in ${acct.accountName}. Amounts in uncategorised or suspense accounts are not attributed to any management category and reduce the reliability of this report.`,
        metricKey: 'uncategorized',
        currentValue: acct.amount,
        comparisonValue: threshold,
        deltaAmount: acct.amount,
        deltaPct: null,
        evidence: { account: acct.accountName },
      });
    }
  }

  if (ruleEnabled(thresholds, 'unmapped_expenses')) {
    const threshold = param(thresholds, 'unmapped_expenses', 'pct', 0.05);
    if (current.unmappedOpexPct >= threshold && current.unmappedOpexAmount > 0) {
      push({
        ruleKey: 'unmapped_expenses',
        severity: current.unmappedOpexPct >= threshold * 3 ? 'IMPORTANT' : 'WATCH',
        category: 'Data Quality',
        title: `${formatPercent(current.unmappedOpexPct)} of operating expenses are unmapped`,
        detail: `${formatCurrency(current.unmappedOpexAmount)} of operating expenses have no management category. Map these accounts in Settings → Account Mappings to improve expense analysis.`,
        metricKey: 'unmapped_opex',
        currentValue: current.unmappedOpexAmount,
        comparisonValue: current.operatingExpenses,
        deltaAmount: current.unmappedOpexAmount,
        deltaPct: current.unmappedOpexPct,
        evidence: { threshold },
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}
