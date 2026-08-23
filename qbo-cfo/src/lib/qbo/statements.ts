import type { AccountRecord } from '../finance/types';
import { round2 } from '../finance/math';
import type { FlatReport } from './report-types';
import { summaryByGroup, summaryByLabel } from './parse';

/**
 * Turns flattened QuickBooks reports into typed statements.
 *
 * Classification is driven by QuickBooks `AccountType` / `AccountSubType`,
 * which are stable enumerations, rather than by account names. Companies that
 * rename "Advertising" to "Marketing & Media" still classify correctly.
 */

export type AccountIndex = ReadonlyMap<string, AccountRecord>;

// QuickBooks AccountType enumeration groups -------------------------------
const ASSET_TYPES = new Set(['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset']);
const LIABILITY_TYPES = new Set(['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability']);
const REVENUE_TYPES = new Set(['Income', 'Other Income']);
const EXPENSE_TYPES = new Set(['Expense', 'Other Expense', 'Cost of Goods Sold']);
const DEBT_SUBTYPES = new Set([
  'LoanPayable',
  'NotesPayable',
  'ShareholderNotesPayable',
  'LineOfCredit',
  'BankLoans',
  'OtherLongTermLiabilities',
  'LongTermDebit',
]);

export function classify(account: AccountRecord | undefined): string | null {
  if (!account) return null;
  if (account.classification) return account.classification;
  const t = account.accountType ?? '';
  if (ASSET_TYPES.has(t)) return 'Asset';
  if (LIABILITY_TYPES.has(t)) return 'Liability';
  if (REVENUE_TYPES.has(t)) return 'Revenue';
  if (EXPENSE_TYPES.has(t)) return 'Expense';
  if (t === 'Equity') return 'Equity';
  return null;
}

export interface PnlAccountLine {
  accountQboId: string | null;
  accountName: string;
  /** Top-level report section derived from the QuickBooks row group/path. */
  section: 'income' | 'cogs' | 'expense' | 'other_income' | 'other_expense' | 'unknown';
  amount: number;
}

export interface ParsedProfitAndLoss {
  startPeriod: string | null;
  endPeriod: string | null;
  currency: string | null;
  totalIncome: number;
  totalCogs: number;
  grossProfit: number;
  totalExpenses: number;
  netOperatingIncome: number;
  totalOtherIncome: number;
  totalOtherExpense: number;
  netIncome: number;
  lines: PnlAccountLine[];
}

/** Maps a report row's group/path to a P&L section. */
function pnlSection(
  group: string | null,
  path: string[],
  account: AccountRecord | undefined,
): PnlAccountLine['section'] {
  const type = account?.accountType ?? '';
  if (type === 'Cost of Goods Sold') return 'cogs';
  if (type === 'Income') return 'income';
  if (type === 'Other Income') return 'other_income';
  if (type === 'Other Expense') return 'other_expense';
  if (type === 'Expense') return 'expense';

  const hay = [group ?? '', ...path].join(' ').toLowerCase();
  if (hay.includes('cost of goods') || hay.includes('cogs')) return 'cogs';
  if (hay.includes('other income')) return 'other_income';
  if (hay.includes('other expense')) return 'other_expense';
  if (hay.includes('income') || hay.includes('revenue') || hay.includes('sales')) return 'income';
  if (hay.includes('expense')) return 'expense';
  return 'unknown';
}

export function parseProfitAndLoss(
  flat: FlatReport,
  accounts: AccountIndex,
  columnIndex = 0,
): ParsedProfitAndLoss {
  const lines: PnlAccountLine[] = [];

  for (const row of flat.rows) {
    const value = row.values[columnIndex];
    if (value === null || value === undefined) continue;
    const account = row.id ? accounts.get(row.id) : undefined;
    const section = pnlSection(row.group, row.path, account);
    if (section === 'unknown' && value === 0) continue;
    lines.push({
      accountQboId: row.id,
      accountName: account?.fullyQualifiedName ?? account?.name ?? row.label,
      section,
      amount: round2(value),
    });
  }

  const sectionTotal = (section: PnlAccountLine['section']): number =>
    round2(lines.filter((l) => l.section === section).reduce((a, l) => a + l.amount, 0));

  // Prefer QuickBooks' own subtotals; fall back to summing our classified lines.
  const totalIncome =
    summaryByGroup(flat, 'Income', columnIndex) ??
    summaryByLabel(flat, 'Total Income', columnIndex) ??
    sectionTotal('income');
  const totalCogs =
    summaryByGroup(flat, 'COGS', columnIndex) ??
    summaryByLabel(flat, 'Total Cost of Goods Sold', columnIndex) ??
    sectionTotal('cogs');
  const totalExpenses =
    summaryByGroup(flat, 'Expenses', columnIndex) ??
    summaryByLabel(flat, 'Total Expenses', columnIndex) ??
    sectionTotal('expense');
  const totalOtherIncome =
    summaryByGroup(flat, 'OtherIncome', columnIndex) ??
    summaryByLabel(flat, 'Total Other Income', columnIndex) ??
    sectionTotal('other_income');
  const totalOtherExpense =
    summaryByGroup(flat, 'OtherExpenses', columnIndex) ??
    summaryByLabel(flat, 'Total Other Expenses', columnIndex) ??
    sectionTotal('other_expense');

  const grossProfit =
    summaryByGroup(flat, 'GrossProfit', columnIndex) ?? round2(totalIncome - totalCogs);
  const netOperatingIncome =
    summaryByGroup(flat, 'NetOperatingIncome', columnIndex) ?? round2(grossProfit - totalExpenses);
  const netIncome =
    summaryByGroup(flat, 'NetIncome', columnIndex) ??
    round2(netOperatingIncome + totalOtherIncome - totalOtherExpense);

  return {
    startPeriod: flat.startPeriod,
    endPeriod: flat.endPeriod,
    currency: flat.currency,
    totalIncome: round2(totalIncome),
    totalCogs: round2(totalCogs),
    grossProfit: round2(grossProfit),
    totalExpenses: round2(totalExpenses),
    netOperatingIncome: round2(netOperatingIncome),
    totalOtherIncome: round2(totalOtherIncome),
    totalOtherExpense: round2(totalOtherExpense),
    netIncome: round2(netIncome),
    lines,
  };
}

export interface ParsedBalanceSheet {
  asOf: string | null;
  cash: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  otherCurrentAssets: number | null;
  currentAssets: number | null;
  fixedAssets: number | null;
  otherAssets: number | null;
  totalAssets: number | null;
  accountsPayable: number | null;
  creditCards: number | null;
  otherCurrentLiabilities: number | null;
  shortTermDebt: number | null;
  currentLiabilities: number | null;
  longTermDebt: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  balanced: boolean | null;
  /** Rows whose account could not be classified -- surfaced as a data-quality warning. */
  unclassified: Array<{ label: string; amount: number }>;
}

export function parseBalanceSheet(
  flat: FlatReport,
  accounts: AccountIndex,
  columnIndex = 0,
): ParsedBalanceSheet {
  const totals = new Map<string, number>();
  const unclassified: Array<{ label: string; amount: number }> = [];
  let inventory = 0;
  let shortTermDebt = 0;
  let sawAny = false;

  const add = (key: string, amount: number): void => {
    totals.set(key, round2((totals.get(key) ?? 0) + amount));
  };

  for (const row of flat.rows) {
    const value = row.values[columnIndex];
    if (value === null || value === undefined) continue;
    const account = row.id ? accounts.get(row.id) : undefined;
    if (!account?.accountType) {
      if (value !== 0) unclassified.push({ label: row.label, amount: round2(value) });
      continue;
    }
    sawAny = true;
    const type = account.accountType;
    add(type, value);
    if (type === 'Other Current Asset' && account.accountSubType === 'Inventory') {
      inventory = round2(inventory + value);
    }
    if (
      (type === 'Other Current Liability' || type === 'Long Term Liability') &&
      account.accountSubType &&
      DEBT_SUBTYPES.has(account.accountSubType) &&
      type === 'Other Current Liability'
    ) {
      shortTermDebt = round2(shortTermDebt + value);
    }
  }

  if (!sawAny) {
    return {
      asOf: flat.endPeriod,
      cash: null,
      accountsReceivable: null,
      inventory: null,
      otherCurrentAssets: null,
      currentAssets: null,
      fixedAssets: null,
      otherAssets: null,
      totalAssets: null,
      accountsPayable: null,
      creditCards: null,
      otherCurrentLiabilities: null,
      shortTermDebt: null,
      currentLiabilities: null,
      longTermDebt: null,
      totalLiabilities: null,
      equity: null,
      balanced: null,
      unclassified,
    };
  }

  const get = (key: string): number => totals.get(key) ?? 0;

  const cash = get('Bank');
  const ar = get('Accounts Receivable');
  const otherCurrentAssetsTotal = get('Other Current Asset');
  const otherCurrentAssets = round2(otherCurrentAssetsTotal - inventory);
  const currentAssets = round2(cash + ar + otherCurrentAssetsTotal);
  const fixedAssets = get('Fixed Asset');
  const otherAssets = get('Other Asset');
  const totalAssets = round2(currentAssets + fixedAssets + otherAssets);

  const ap = get('Accounts Payable');
  const creditCards = get('Credit Card');
  const otherCurrentLiabilitiesTotal = get('Other Current Liability');
  const currentLiabilities = round2(ap + creditCards + otherCurrentLiabilitiesTotal);
  const longTermDebt = get('Long Term Liability');
  const totalLiabilities = round2(currentLiabilities + longTermDebt);
  const equity = get('Equity');

  // QuickBooks balance sheets always balance; a mismatch means our copy is
  // incomplete, which downgrades report confidence rather than being hidden.
  const balanced = Math.abs(totalAssets - (totalLiabilities + equity)) < 1;

  return {
    asOf: flat.endPeriod,
    cash,
    accountsReceivable: ar,
    inventory,
    otherCurrentAssets,
    currentAssets,
    fixedAssets,
    otherAssets,
    totalAssets,
    accountsPayable: ap,
    creditCards,
    otherCurrentLiabilities: otherCurrentLiabilitiesTotal,
    shortTermDebt,
    currentLiabilities,
    longTermDebt,
    totalLiabilities,
    equity,
    balanced,
    unclassified,
  };
}

export interface ParsedAging {
  asOf: string | null;
  buckets: Array<{
    entityName: string;
    entityQboId: string | null;
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    total: number;
  }>;
  total: {
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90Plus: number;
    total: number;
  };
}

/**
 * Aged Receivables / Aged Payables summary.
 * Column order is Current, 1-30, 31-60, 61-90, 91+, Total; we map by title
 * where possible and fall back to positional order.
 */
export function parseAgingSummary(flat: FlatReport, columnIndex?: number): ParsedAging {
  const titles = flat.columns.map((c) => c.title.toLowerCase());
  const find = (...needles: string[]): number => {
    for (const needle of needles) {
      const idx = titles.findIndex((t) => t.replace(/\s+/g, '').includes(needle.replace(/\s+/g, '')));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const idx = {
    current: find('current'),
    d1: find('1-30', '1 - 30'),
    d31: find('31-60', '31 - 60'),
    d61: find('61-90', '61 - 90'),
    d90: find('91 and over', '91andover', '>90', '91+'),
    total: find('total'),
  };
  // Positional fallback when QuickBooks omits column titles.
  const at = (values: Array<number | null>, key: keyof typeof idx, fallback: number): number =>
    (idx[key] >= 0 ? values[idx[key]] : values[fallback]) ?? 0;

  const buckets = flat.rows
    .map((row) => ({
      entityName: row.label,
      entityQboId: row.id,
      current: at(row.values, 'current', 0),
      days1to30: at(row.values, 'd1', 1),
      days31to60: at(row.values, 'd31', 2),
      days61to90: at(row.values, 'd61', 3),
      days90Plus: at(row.values, 'd90', 4),
      total: at(row.values, 'total', 5),
    }))
    .filter((b) => b.total !== 0 || b.current !== 0);

  const totalRow = flat.summaries[flat.summaries.length - 1];
  const total = totalRow
    ? {
        current: at(totalRow.values, 'current', 0),
        days1to30: at(totalRow.values, 'd1', 1),
        days31to60: at(totalRow.values, 'd31', 2),
        days61to90: at(totalRow.values, 'd61', 3),
        days90Plus: at(totalRow.values, 'd90', 4),
        total: at(totalRow.values, 'total', 5),
      }
    : {
        current: round2(buckets.reduce((a, b) => a + b.current, 0)),
        days1to30: round2(buckets.reduce((a, b) => a + b.days1to30, 0)),
        days31to60: round2(buckets.reduce((a, b) => a + b.days31to60, 0)),
        days61to90: round2(buckets.reduce((a, b) => a + b.days61to90, 0)),
        days90Plus: round2(buckets.reduce((a, b) => a + b.days90Plus, 0)),
        total: round2(buckets.reduce((a, b) => a + b.total, 0)),
      };

  void columnIndex;
  return { asOf: flat.endPeriod, buckets, total };
}
