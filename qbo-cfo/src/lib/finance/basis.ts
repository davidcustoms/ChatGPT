/**
 * Reporting basis.
 *
 * Accrual and cash basis produce materially different figures from the same
 * ledger: accrual recognises an invoice when it is raised, cash when it is
 * paid. Mixing them inside one report is an accounting error, not a display
 * preference, so the basis travels with every stored snapshot, every computed
 * metric and every rendered figure.
 */

export type AccountingMethod = 'Accrual' | 'Cash';

export const ACCOUNTING_METHODS: AccountingMethod[] = ['Accrual', 'Cash'];

export function isAccountingMethod(value: unknown): value is AccountingMethod {
  return value === 'Accrual' || value === 'Cash';
}

export function normalizeMethod(value: unknown): AccountingMethod {
  return isAccountingMethod(value) ? value : 'Accrual';
}

/** Label shown on dashboards, reports, exports and chat answers. */
export function basisLabel(method: AccountingMethod): string {
  return method === 'Cash' ? 'Cash Basis' : 'Accrual Basis';
}

/**
 * One-line explanation of what the basis means, shown alongside the label so an
 * owner without accounting training understands why two numbers can differ.
 */
export function basisDescription(method: AccountingMethod): string {
  return method === 'Cash'
    ? 'Cash basis: income is counted when money is received and expenses when they are paid. Unpaid invoices and unpaid bills are not included in the income statement.'
    : 'Accrual basis: income is counted when it is earned and expenses when they are incurred, regardless of when cash moves. This is the basis most management reporting uses.';
}

/**
 * QuickBooks reports that accept an accounting_method parameter. Balance-sheet
 * style and aging reports are always point-in-time and ignore it.
 */
const METHOD_AWARE_REPORTS = new Set([
  'ProfitAndLoss',
  'ProfitAndLossDetail',
  'BalanceSheet',
  'TrialBalance',
  'GeneralLedger',
  'CustomerSales',
  'ItemSales',
  'VendorExpenses',
]);

export function reportAcceptsMethod(reportType: string): boolean {
  return METHOD_AWARE_REPORTS.has(reportType);
}
