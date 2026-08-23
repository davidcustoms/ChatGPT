/** Default anomaly thresholds. Every value is overridable per company. */

export interface RuleDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  params: Record<string, number>;
  paramLabels: Record<string, string>;
}

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    key: 'revenue_mom',
    label: 'Revenue change month over month',
    description: 'Flags when revenue moves more than the threshold versus the prior month.',
    category: 'Revenue',
    params: { pct: 0.1 },
    paramLabels: { pct: 'Change threshold (as a ratio, 0.10 = 10%)' },
  },
  {
    key: 'revenue_yoy',
    label: 'Revenue change year over year',
    description: 'Flags when revenue moves more than the threshold versus the same month last year.',
    category: 'Revenue',
    params: { pct: 0.15 },
    paramLabels: { pct: 'Change threshold' },
  },
  {
    key: 'gross_margin_shift',
    label: 'Gross margin shift',
    description: 'Flags a gross margin move larger than the threshold, in percentage points.',
    category: 'Margin',
    params: { points: 0.02 },
    paramLabels: { points: 'Percentage-point threshold (0.02 = 2 pts)' },
  },
  {
    key: 'expense_spike',
    label: 'Expense category spike',
    description: 'Flags an expense category that grows by both the percentage and dollar thresholds.',
    category: 'Expenses',
    params: { pct: 0.2, amount: 2000 },
    paramLabels: { pct: 'Increase threshold', amount: 'Minimum dollar increase' },
  },
  {
    key: 'expense_vs_trailing',
    label: 'Expense above trailing average',
    description: 'Flags a category exceeding a multiple of its trailing six-month average.',
    category: 'Expenses',
    params: { multiple: 1.2, months: 6, amount: 1000 },
    paramLabels: {
      multiple: 'Multiple of trailing average (1.2 = 120%)',
      months: 'Months in the trailing window',
      amount: 'Minimum dollar excess',
    },
  },
  {
    key: 'payroll_ratio',
    label: 'Payroll % of revenue',
    description: 'Flags payroll growing as a share of revenue by more than the threshold.',
    category: 'Payroll',
    params: { points: 0.02 },
    paramLabels: { points: 'Percentage-point increase' },
  },
  {
    key: 'ad_spend_divergence',
    label: 'Advertising up while sales decline',
    description: 'Flags advertising increases that coincide with falling revenue.',
    category: 'Advertising Efficiency',
    params: { adPct: 0.05, revPct: 0 },
    paramLabels: { adPct: 'Minimum advertising increase', revPct: 'Revenue change ceiling' },
  },
  {
    key: 'cash_decline',
    label: 'Cash decline',
    description: 'Flags a month-over-month cash decrease beyond the threshold.',
    category: 'Cash',
    params: { pct: 0.15, amount: 5000 },
    paramLabels: { pct: 'Decline threshold', amount: 'Minimum dollar decline' },
  },
  {
    key: 'ar_90_growth',
    label: 'Aged receivables 90+',
    description: 'Flags growth in receivables aged over 90 days.',
    category: 'Receivables',
    params: { pct: 0.2, amount: 2500 },
    paramLabels: { pct: 'Growth threshold', amount: 'Minimum dollar growth' },
  },
  {
    key: 'ap_90_growth',
    label: 'Aged payables 90+',
    description: 'Flags growth in payables aged over 90 days.',
    category: 'Payables',
    params: { pct: 0.2, amount: 2500 },
    paramLabels: { pct: 'Growth threshold', amount: 'Minimum dollar growth' },
  },
  {
    key: 'bank_fee_spike',
    label: 'Bank fee spike',
    description: 'Flags bank fees rising materially against the trailing average.',
    category: 'Bank Fees',
    params: { multiple: 1.5, amount: 250 },
    paramLabels: { multiple: 'Multiple of trailing average', amount: 'Minimum dollar excess' },
  },
  {
    key: 'financing_fee_spike',
    label: 'Financing fee spike',
    description: 'Flags consumer-financing fees rising materially against the trailing average.',
    category: 'Financing',
    params: { multiple: 1.4, amount: 1000 },
    paramLabels: { multiple: 'Multiple of trailing average', amount: 'Minimum dollar excess' },
  },
  {
    key: 'merchant_rate_shift',
    label: 'Merchant processing rate',
    description: 'Flags a change in merchant fees as a percentage of revenue.',
    category: 'Merchant Processing',
    params: { points: 0.003 },
    paramLabels: { points: 'Percentage-point change (0.003 = 0.3 pts)' },
  },
  {
    key: 'new_large_vendor',
    label: 'Large new vendor',
    description: 'Flags a vendor appearing for the first time with material spend.',
    category: 'Vendors',
    params: { amount: 5000 },
    paramLabels: { amount: 'Minimum first-month spend' },
  },
  {
    key: 'vendor_spend_jump',
    label: 'Vendor spend increase',
    description: 'Flags an existing vendor whose spend jumps materially.',
    category: 'Vendors',
    params: { pct: 0.5, amount: 5000 },
    paramLabels: { pct: 'Increase threshold', amount: 'Minimum dollar increase' },
  },
  {
    key: 'large_transaction',
    label: 'Large single transaction',
    description: 'Flags individual transactions above the threshold.',
    category: 'Transactions',
    params: { amount: 25000 },
    paramLabels: { amount: 'Transaction amount threshold' },
  },
  {
    key: 'duplicate_transactions',
    label: 'Possible duplicate transactions',
    description: 'Flags identical vendor/amount pairs recorded more than once in the month.',
    category: 'Transactions',
    params: { amount: 1000 },
    paramLabels: { amount: 'Minimum amount to consider' },
  },
  {
    key: 'uncategorized_balance',
    label: 'Uncategorised / suspense balances',
    description: 'Flags material balances sitting in uncategorised or suspense accounts.',
    category: 'Data Quality',
    params: { amount: 1000 },
    paramLabels: { amount: 'Balance threshold' },
  },
  {
    key: 'unmapped_expenses',
    label: 'Unmapped operating expenses',
    description: 'Flags when too large a share of operating expenses has no category mapping.',
    category: 'Data Quality',
    params: { pct: 0.05 },
    paramLabels: { pct: 'Share of operating expenses' },
  },
];

export const RULE_BY_KEY = new Map(RULE_DEFINITIONS.map((r) => [r.key, r]));

export type ThresholdMap = Map<string, { enabled: boolean; params: Record<string, number> }>;

/** Merges stored overrides over the defaults. */
export function resolveThresholds(
  overrides: Array<{ ruleKey: string; enabled: boolean; params: Record<string, number> }>,
): ThresholdMap {
  const map: ThresholdMap = new Map();
  for (const def of RULE_DEFINITIONS) {
    map.set(def.key, { enabled: true, params: { ...def.params } });
  }
  for (const o of overrides) {
    const base = map.get(o.ruleKey);
    if (!base) continue;
    map.set(o.ruleKey, { enabled: o.enabled, params: { ...base.params, ...o.params } });
  }
  return map;
}

export function param(
  thresholds: ThresholdMap,
  ruleKey: string,
  name: string,
  fallback: number,
): number {
  const value = thresholds.get(ruleKey)?.params?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ruleEnabled(thresholds: ThresholdMap, ruleKey: string): boolean {
  return thresholds.get(ruleKey)?.enabled ?? true;
}
