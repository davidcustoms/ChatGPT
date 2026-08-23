import type { QboReport } from '@/lib/qbo/report-types';
import type { AccountRecord } from '@/lib/finance/types';

/**
 * Mock QuickBooks payloads for development and tests.
 * Shapes mirror what the Intuit reports API actually returns.
 */

export const MOCK_ACCOUNTS: AccountRecord[] = [
  acc('1', 'Furniture Sales', 'Income', 'SalesOfProductIncome', 'Revenue'),
  acc('2', 'Customer Discounts', 'Income', 'DiscountsRefundsGiven', 'Revenue'),
  acc('3', 'Sales Returns', 'Income', 'DiscountsRefundsGiven', 'Revenue'),
  acc('4', 'Merchandise Cost', 'Cost of Goods Sold', 'SuppliesMaterialsCogs', 'Expense'),
  acc('5', 'Sales Floor Payroll', 'Expense', 'PayrollWageExpenses', 'Expense'),
  acc('6', 'Meta Ads', 'Expense', 'AdvertisingPromotional', 'Expense'),
  acc('7', 'Showroom Rent', 'Expense', 'RentOrLeaseOfBuildings', 'Expense'),
  acc('8', 'Uncategorized Expense', 'Expense', null, 'Expense'),
  acc('9', 'Interest Expense', 'Other Expense', 'InterestPaid', 'Expense'),
  acc('10', 'Vendor Rebates', 'Other Income', 'OtherMiscellaneousIncome', 'Revenue'),
  acc('20', 'Operating Checking', 'Bank', 'Checking', 'Asset'),
  acc('21', 'Accounts Receivable', 'Accounts Receivable', 'AccountsReceivable', 'Asset'),
  acc('22', 'Merchandise Inventory', 'Other Current Asset', 'Inventory', 'Asset'),
  acc('23', 'Prepaid Expenses', 'Other Current Asset', 'PrepaidExpenses', 'Asset'),
  acc('24', 'Leasehold Improvements', 'Fixed Asset', 'LeaseholdImprovements', 'Asset'),
  acc('30', 'Accounts Payable', 'Accounts Payable', 'AccountsPayable', 'Liability'),
  acc('31', 'Business Credit Card', 'Credit Card', 'CreditCard', 'Liability'),
  acc('32', 'Floor Plan Line of Credit', 'Other Current Liability', 'LineOfCredit', 'Liability'),
  acc('33', 'Equipment Loan', 'Long Term Liability', 'NotesPayable', 'Liability'),
  acc('40', 'Owner Equity', 'Equity', 'OwnersEquity', 'Equity'),
];

function acc(
  qboId: string,
  name: string,
  accountType: string,
  accountSubType: string | null,
  classification: string,
): AccountRecord {
  return {
    qboId,
    name,
    fullyQualifiedName: name,
    accountNumber: null,
    accountType,
    accountSubType,
    classification,
    parentQboId: null,
    isActive: true,
    currentBalance: null,
  };
}

export const MOCK_ACCOUNT_INDEX = new Map(MOCK_ACCOUNTS.map((a) => [a.qboId, a]));

function row(id: string, label: string, ...values: number[]) {
  return {
    type: 'Data',
    ColData: [{ value: label, id }, ...values.map((v) => ({ value: v.toFixed(2) }))],
  };
}

function section(group: string, header: string, rows: unknown[], summaryLabel: string, ...values: number[]) {
  return {
    type: 'Section',
    group,
    Header: { ColData: [{ value: header }] },
    Rows: { Row: rows },
    Summary: { ColData: [{ value: summaryLabel }, ...values.map((v) => ({ value: v.toFixed(2) }))] },
  };
}

function summary(group: string, label: string, ...values: number[]) {
  return {
    type: 'Section',
    group,
    Summary: { ColData: [{ value: label }, ...values.map((v) => ({ value: v.toFixed(2) }))] },
  };
}

/**
 * A single-column Profit & Loss.
 * Gross sales 500,000, discounts 20,000, returns 10,000 -> net 470,000.
 * COGS 258,500 -> gross profit 211,500 (45.0% margin).
 */
export const MOCK_PNL: QboReport = {
  Header: {
    ReportName: 'ProfitAndLoss',
    StartPeriod: '2026-06-01',
    EndPeriod: '2026-06-30',
    Currency: 'USD',
  },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      section(
        'Income',
        'Income',
        [row('1', 'Furniture Sales', 500_000), row('2', 'Customer Discounts', -20_000), row('3', 'Sales Returns', -10_000)],
        'Total Income',
        470_000,
      ),
      section('COGS', 'Cost of Goods Sold', [row('4', 'Merchandise Cost', 258_500)], 'Total Cost of Goods Sold', 258_500),
      summary('GrossProfit', 'Gross Profit', 211_500),
      section(
        'Expenses',
        'Expenses',
        [
          row('5', 'Sales Floor Payroll', 80_000),
          row('6', 'Meta Ads', 30_000),
          row('7', 'Showroom Rent', 25_000),
          row('8', 'Uncategorized Expense', 15_000),
        ],
        'Total Expenses',
        150_000,
      ),
      summary('NetOperatingIncome', 'Net Operating Income', 61_500),
      section('OtherIncome', 'Other Income', [row('10', 'Vendor Rebates', 5_000)], 'Total Other Income', 5_000),
      section('OtherExpenses', 'Other Expenses', [row('9', 'Interest Expense', 6_500)], 'Total Other Expenses', 6_500),
      summary('NetOtherIncome', 'Net Other Income', -1_500),
      summary('NetIncome', 'Net Income', 60_000),
    ],
  },
};

/** Multi-column P&L summarised by Location, with two stores plus a Total column. */
export const MOCK_PNL_BY_LOCATION: QboReport = {
  Header: { ReportName: 'ProfitAndLoss', StartPeriod: '2026-06-01', EndPeriod: '2026-06-30' },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      { ColTitle: 'Riverside', ColType: 'Money', MetaData: [{ Name: 'ID', Value: '1' }] },
      { ColTitle: 'Northgate', ColType: 'Money', MetaData: [{ Name: 'ID', Value: '2' }] },
      { ColTitle: 'Total', ColType: 'Money' },
    ],
  },
  Rows: {
    Row: [
      section(
        'Income',
        'Income',
        [row('1', 'Furniture Sales', 300_000, 200_000, 500_000), row('2', 'Customer Discounts', -12_000, -8_000, -20_000), row('3', 'Sales Returns', -6_000, -4_000, -10_000)],
        'Total Income',
        282_000,
        188_000,
        470_000,
      ),
      section('COGS', 'Cost of Goods Sold', [row('4', 'Merchandise Cost', 150_000, 108_500, 258_500)], 'Total Cost of Goods Sold', 150_000, 108_500, 258_500),
      summary('GrossProfit', 'Gross Profit', 132_000, 79_500, 211_500),
      section(
        'Expenses',
        'Expenses',
        [row('5', 'Sales Floor Payroll', 45_000, 35_000, 80_000), row('6', 'Meta Ads', 18_000, 12_000, 30_000), row('7', 'Showroom Rent', 15_000, 10_000, 25_000)],
        'Total Expenses',
        78_000,
        57_000,
        135_000,
      ),
      summary('NetOperatingIncome', 'Net Operating Income', 54_000, 22_500, 76_500),
      summary('NetIncome', 'Net Income', 54_000, 22_500, 76_500),
    ],
  },
};

/** Balance sheet that balances: assets 1,000,000 = liabilities 600,000 + equity 400,000. */
export const MOCK_BALANCE_SHEET: QboReport = {
  Header: { ReportName: 'BalanceSheet', StartPeriod: '2026-06-01', EndPeriod: '2026-06-30' },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      row('20', 'Operating Checking', 150_000),
      row('21', 'Accounts Receivable', 120_000),
      row('22', 'Merchandise Inventory', 480_000),
      row('23', 'Prepaid Expenses', 50_000),
      row('24', 'Leasehold Improvements', 200_000),
      row('30', 'Accounts Payable', 250_000),
      row('31', 'Business Credit Card', 50_000),
      row('32', 'Floor Plan Line of Credit', 200_000),
      row('33', 'Equipment Loan', 100_000),
      row('40', 'Owner Equity', 400_000),
    ],
  },
};

/** Aged receivables summary with the standard bucket columns. */
export const MOCK_AR_AGING: QboReport = {
  Header: { ReportName: 'AgedReceivables', StartPeriod: '2026-06-01', EndPeriod: '2026-06-30' },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Customer' },
      { ColTitle: 'Current', ColType: 'Money' },
      { ColTitle: '1 - 30', ColType: 'Money' },
      { ColTitle: '31 - 60', ColType: 'Money' },
      { ColTitle: '61 - 90', ColType: 'Money' },
      { ColTitle: '91 and over', ColType: 'Money' },
      { ColTitle: 'Total', ColType: 'Money' },
    ],
  },
  Rows: {
    Row: [
      row('101', 'Harborview Apartments', 30_000, 10_000, 5_000, 2_000, 8_000, 55_000),
      row('102', 'Sunrise Senior Living', 20_000, 6_000, 3_000, 1_000, 0, 30_000),
      row('103', 'Copper Creek Builders', 25_000, 4_000, 2_000, 500, 3_500, 35_000),
      summary('Total', 'TOTAL', 75_000, 20_000, 10_000, 3_500, 11_500, 120_000),
    ],
  },
};

/** Same shape for payables. */
export const MOCK_AP_AGING: QboReport = {
  Header: { ReportName: 'AgedPayables', StartPeriod: '2026-06-01', EndPeriod: '2026-06-30' },
  Columns: MOCK_AR_AGING.Columns,
  Rows: {
    Row: [
      row('201', 'Ashley Furniture Industries', 90_000, 20_000, 8_000, 2_000, 5_000, 125_000),
      row('202', 'Regional Freight Lines', 40_000, 10_000, 4_000, 1_000, 0, 55_000),
      summary('Total', 'TOTAL', 130_000, 30_000, 12_000, 3_000, 5_000, 180_000),
    ],
  },
};

/** Approved mapping used by the metric tests. Account 8 is deliberately unmapped. */
export const MOCK_MAPPING = new Map<string, string>([
  ['1', 'revenue'],
  ['2', 'discounts'],
  ['3', 'returns'],
  ['4', 'cogs'],
  ['5', 'payroll'],
  ['6', 'advertising'],
  ['7', 'rent'],
  ['9', 'interest'],
  ['10', 'other_income'],
]);
