import { categoryLabel } from '../finance/categories';
import type { AccountingMethod } from '../finance/basis';
import { basisLabel } from '../finance/basis';
import type { MonthlyMetrics } from '../finance/types';
import type { Period } from '../util/dates';

/**
 * Metric provenance.
 *
 * Every headline figure carries a record of how it was produced: the source
 * QuickBooks report, the snapshot it came from, the accounts or categories that
 * contributed, the period, the basis and any dimension filter. This is what
 * makes "How was this calculated?" answerable without a developer, and what
 * lets an accountant tie a dashboard number back to QuickBooks.
 */

export type ProvenanceKind =
  | 'quickbooks_subtotal'
  | 'category_rollup'
  | 'derived'
  | 'point_in_time'
  | 'aggregate';

export interface MetricProvenance {
  metricKey: string;
  label: string;
  value: number | null;
  /** How the figure came to exist. */
  kind: ProvenanceKind;
  /** Plain-language calculation, e.g. "Net Sales − COGS". */
  formula: string;
  /** Why this source is authoritative for this figure. */
  note: string;
  sourceReport: string | null;
  /** Management categories that roll into the figure, when applicable. */
  categoryKeys: string[];
  /** QuickBooks account types that roll in, for balance-sheet figures. */
  accountTypes: string[];
  /** Inputs this figure is derived from, referencing other metric keys. */
  derivedFrom: string[];
  period: Period;
  accountingMethod: AccountingMethod;
  dimensionFilter: string | null;
  /** Set when the figure can be decomposed to transactions. */
  drilldownCategoryKey: string | null;
}

interface Definition {
  label: string;
  kind: ProvenanceKind;
  formula: string;
  note: string;
  sourceReport: string | null;
  categoryKeys?: string[];
  accountTypes?: string[];
  derivedFrom?: string[];
  drilldownCategoryKey?: string | null;
  pick: (m: MonthlyMetrics) => number | null;
}

const PNL = 'QuickBooks Profit & Loss';
const BS = 'QuickBooks Balance Sheet';

/**
 * Where each figure comes from. The narrative here is deliberately specific:
 * "QuickBooks' own Total Income subtotal" is a different provenance claim from
 * "the sum of accounts we mapped to Revenue", and an owner reconciling against
 * QuickBooks needs to know which one they are looking at.
 */
const DEFINITIONS: Record<string, Definition> = {
  gross_sales: {
    label: 'Gross Sales',
    kind: 'category_rollup',
    formula: 'Sum of income accounts not classified as Discounts or Returns',
    note: 'Income-section lines from the Profit & Loss, excluding accounts mapped to contra-revenue categories.',
    sourceReport: PNL,
    categoryKeys: ['revenue'],
    drilldownCategoryKey: 'revenue',
    pick: (m) => m.grossSales,
  },
  discounts: {
    label: 'Discounts',
    kind: 'category_rollup',
    formula: 'Absolute value of income lines mapped to Discounts',
    note: 'QuickBooks reports contra revenue as a negative income line; it is stored positive so Net Sales = Gross Sales − Discounts − Returns holds.',
    sourceReport: PNL,
    categoryKeys: ['discounts'],
    drilldownCategoryKey: 'discounts',
    pick: (m) => m.discounts,
  },
  refunds: {
    label: 'Returns',
    kind: 'category_rollup',
    formula: 'Absolute value of income lines mapped to Returns',
    note: 'Contra revenue, stored positive. See Discounts.',
    sourceReport: PNL,
    categoryKeys: ['returns'],
    drilldownCategoryKey: 'returns',
    pick: (m) => m.refunds,
  },
  net_sales: {
    label: 'Net Revenue',
    kind: 'derived',
    formula: 'Gross Sales − Discounts − Returns',
    note: "Reconciles to QuickBooks' Total Income. Any difference is reported as a data-quality variance rather than absorbed.",
    sourceReport: PNL,
    derivedFrom: ['gross_sales', 'discounts', 'refunds'],
    pick: (m) => m.netSales,
  },
  cogs: {
    label: 'COGS',
    kind: 'quickbooks_subtotal',
    formula: "QuickBooks' Total Cost of Goods Sold subtotal",
    note: "Taken from QuickBooks' own subtotal, not recomputed, so it always ties to the QuickBooks report.",
    sourceReport: PNL,
    categoryKeys: ['cogs', 'freight'],
    drilldownCategoryKey: 'cogs',
    pick: (m) => m.cogs,
  },
  gross_profit: {
    label: 'Gross Profit',
    kind: 'quickbooks_subtotal',
    formula: 'Net Revenue − COGS',
    note: "QuickBooks' Gross Profit subtotal where present; otherwise computed from the two lines above.",
    sourceReport: PNL,
    derivedFrom: ['net_sales', 'cogs'],
    pick: (m) => m.grossProfit,
  },
  gross_margin: {
    label: 'Gross Margin',
    kind: 'derived',
    formula: 'Gross Profit ÷ Net Revenue',
    note: 'Returns "N/M" rather than a number when revenue is zero.',
    sourceReport: PNL,
    derivedFrom: ['gross_profit', 'net_sales'],
    pick: (m) => m.grossMargin,
  },
  operating_expenses: {
    label: 'Operating Expenses',
    kind: 'quickbooks_subtotal',
    formula: "QuickBooks' Total Expenses subtotal",
    note: 'Includes expenses whose account has no management category; those are tracked separately as unmapped rather than reassigned.',
    sourceReport: PNL,
    pick: (m) => m.operatingExpenses,
  },
  net_operating_income: {
    label: 'Operating Income',
    kind: 'quickbooks_subtotal',
    formula: 'Gross Profit − Operating Expenses',
    note: "QuickBooks' Net Operating Income subtotal where present.",
    sourceReport: PNL,
    derivedFrom: ['gross_profit', 'operating_expenses'],
    pick: (m) => m.netOperatingIncome,
  },
  net_income: {
    label: 'Net Income',
    kind: 'quickbooks_subtotal',
    formula: 'Operating Income + Other Income − Other Expense',
    note: "QuickBooks' Net Income subtotal where present.",
    sourceReport: PNL,
    derivedFrom: ['net_operating_income'],
    pick: (m) => m.netIncome,
  },
  net_margin: {
    label: 'Net Margin',
    kind: 'derived',
    formula: 'Net Income ÷ Net Revenue',
    note: 'Returns "N/M" rather than a number when revenue is zero.',
    sourceReport: PNL,
    derivedFrom: ['net_income', 'net_sales'],
    pick: (m) => m.netMargin,
  },
  cash: {
    label: 'Cash',
    kind: 'point_in_time',
    formula: 'Sum of accounts with QuickBooks account type "Bank"',
    note: 'A closing balance on the period end date, not a flow. Classified by account type, never by account name.',
    sourceReport: BS,
    accountTypes: ['Bank'],
    pick: (m) => m.cash,
  },
  accounts_receivable: {
    label: 'Accounts Receivable',
    kind: 'point_in_time',
    formula: 'Sum of accounts with type "Accounts Receivable"',
    note: 'Closing balance on the period end date. The aging breakdown comes from a separate Aged Receivables report.',
    sourceReport: BS,
    accountTypes: ['Accounts Receivable'],
    pick: (m) => m.accountsReceivable,
  },
  accounts_payable: {
    label: 'Accounts Payable',
    kind: 'point_in_time',
    formula: 'Sum of accounts with type "Accounts Payable"',
    note: 'Closing balance on the period end date.',
    sourceReport: BS,
    accountTypes: ['Accounts Payable'],
    pick: (m) => m.accountsPayable,
  },
  inventory_value: {
    label: 'Inventory',
    kind: 'point_in_time',
    formula: 'Accounts with type "Other Current Asset" and sub-type "Inventory"',
    note: 'Balance-sheet inventory value, which may differ from the inventory valuation report.',
    sourceReport: BS,
    accountTypes: ['Other Current Asset'],
    pick: (m) => m.inventoryValue,
  },
  current_assets: {
    label: 'Total Current Assets',
    kind: 'point_in_time',
    formula: 'Bank + Accounts Receivable + Other Current Asset',
    note: 'Classified by QuickBooks account type.',
    sourceReport: BS,
    accountTypes: ['Bank', 'Accounts Receivable', 'Other Current Asset'],
    derivedFrom: ['cash', 'accounts_receivable', 'inventory_value'],
    pick: (m) => m.currentAssets,
  },
  total_assets: {
    label: 'Total Assets',
    kind: 'point_in_time',
    formula: 'Current Assets + Fixed Asset + Other Asset',
    note: 'Checked against Total Liabilities + Equity; a mismatch is reported, never hidden.',
    sourceReport: BS,
    accountTypes: ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'],
    derivedFrom: ['current_assets', 'fixed_assets'],
    pick: (m) => m.totalAssets,
  },
  fixed_assets: {
    label: 'Fixed Assets',
    kind: 'point_in_time',
    formula: 'Sum of accounts with type "Fixed Asset"',
    note: 'Net book value as QuickBooks reports it.',
    sourceReport: BS,
    accountTypes: ['Fixed Asset'],
    pick: (m) => m.fixedAssets,
  },
  current_liabilities: {
    label: 'Total Current Liabilities',
    kind: 'point_in_time',
    formula: 'Accounts Payable + Credit Card + Other Current Liability',
    note: 'Classified by QuickBooks account type.',
    sourceReport: BS,
    accountTypes: ['Accounts Payable', 'Credit Card', 'Other Current Liability'],
    derivedFrom: ['accounts_payable'],
    pick: (m) => m.currentLiabilities,
  },
  total_liabilities: {
    label: 'Total Liabilities',
    kind: 'point_in_time',
    formula: 'Current Liabilities + Long Term Liability',
    note: 'Classified by QuickBooks account type.',
    sourceReport: BS,
    accountTypes: ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'],
    derivedFrom: ['current_liabilities', 'long_term_debt'],
    pick: (m) => m.totalLiabilities,
  },
  long_term_debt: {
    label: 'Long-Term Debt',
    kind: 'point_in_time',
    formula: 'Sum of accounts with type "Long Term Liability"',
    note: 'Closing balance on the period end date.',
    sourceReport: BS,
    accountTypes: ['Long Term Liability'],
    pick: (m) => m.longTermDebt,
  },
  equity: {
    label: 'Equity',
    kind: 'point_in_time',
    formula: 'Sum of accounts with type "Equity"',
    note: 'Closing balance on the period end date.',
    sourceReport: BS,
    accountTypes: ['Equity'],
    pick: (m) => m.equity,
  },
  payroll_expense: {
    label: 'Payroll',
    kind: 'category_rollup',
    formula: 'Sum of accounts mapped to the Payroll category',
    note: 'Depends on the account mapping. Mapping coverage for this category is shown alongside it.',
    sourceReport: PNL,
    categoryKeys: ['payroll'],
    drilldownCategoryKey: 'payroll',
    pick: (m) => m.payrollExpense,
  },
  advertising_expense: {
    label: 'Advertising',
    kind: 'category_rollup',
    formula: 'Sum of accounts mapped to the Advertising category',
    note: 'Depends on the account mapping. Mapping coverage for this category is shown alongside it.',
    sourceReport: PNL,
    categoryKeys: ['advertising'],
    drilldownCategoryKey: 'advertising',
    pick: (m) => m.advertisingExpense,
  },
  rent_expense: {
    label: 'Rent',
    kind: 'category_rollup',
    formula: 'Sum of accounts mapped to the Rent category',
    note: 'Depends on the account mapping.',
    sourceReport: PNL,
    categoryKeys: ['rent'],
    drilldownCategoryKey: 'rent',
    pick: (m) => m.rentExpense,
  },
};

export function provenanceKeys(): string[] {
  return Object.keys(DEFINITIONS);
}

export function hasProvenance(metricKey: string): boolean {
  return metricKey in DEFINITIONS;
}

export function buildProvenance(
  metricKey: string,
  metrics: MonthlyMetrics,
  opts: { dimensionFilter?: string | null } = {},
): MetricProvenance | null {
  const def = DEFINITIONS[metricKey];
  if (!def) return null;
  return {
    metricKey,
    label: def.label,
    value: def.pick(metrics),
    kind: def.kind,
    formula: def.formula,
    note: def.note,
    sourceReport: def.sourceReport,
    categoryKeys: def.categoryKeys ?? [],
    accountTypes: def.accountTypes ?? [],
    derivedFrom: def.derivedFrom ?? [],
    period: metrics.period,
    accountingMethod: metrics.accountingMethod,
    dimensionFilter: opts.dimensionFilter ?? null,
    drilldownCategoryKey: def.drilldownCategoryKey ?? null,
  };
}

/** Provenance for every metric the report displays prominently. */
export function buildProvenanceIndex(
  metrics: MonthlyMetrics,
  opts: { dimensionFilter?: string | null } = {},
): Record<string, MetricProvenance> {
  const out: Record<string, MetricProvenance> = {};
  for (const key of Object.keys(DEFINITIONS)) {
    const p = buildProvenance(key, metrics, opts);
    if (p) out[key] = p;
  }
  return out;
}

/** One-line summary used in tooltips and chat answers. */
export function describeProvenance(p: MetricProvenance): string {
  const parts = [
    `${p.label} = ${p.formula}`,
    `Source: ${p.sourceReport ?? 'stored monthly metrics'}`,
    `Period: ${p.period.start} to ${p.period.end}`,
    `Basis: ${basisLabel(p.accountingMethod)}`,
  ];
  if (p.categoryKeys.length) {
    parts.push(`Categories: ${p.categoryKeys.map(categoryLabel).join(', ')}`);
  }
  if (p.accountTypes.length) {
    parts.push(`QuickBooks account types: ${p.accountTypes.join(', ')}`);
  }
  if (p.dimensionFilter) parts.push(`Filtered to: ${p.dimensionFilter}`);
  return parts.join(' · ');
}
