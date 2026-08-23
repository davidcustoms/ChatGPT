import {
  MOCK_AP_AGING,
  MOCK_AR_AGING,
  MOCK_BALANCE_SHEET,
  MOCK_PNL,
  MOCK_PNL_BY_LOCATION,
} from './mock-reports';
import type { QuickBooksClient } from '@/lib/qbo/client';
import type { QboReport } from '@/lib/qbo/report-types';

/**
 * An in-memory stand-in for the QuickBooks API.
 *
 * It returns the same fixture payloads every call, which is exactly what an
 * idempotency test needs: if repeated syncs of identical source data produce
 * anything other than identical stored rows, the fault is in this application.
 *
 * Every call is recorded so a test can assert on request counts, and any
 * request can be made to fail so failure handling can be exercised.
 */

export interface StubCall {
  kind: 'report' | 'query';
  name: string;
  params?: Record<string, string | undefined>;
}

export interface StubOptions {
  /** Report names that should throw instead of returning a payload. */
  failReports?: string[];
  /** Entity names whose queries should throw. */
  failEntities?: string[];
  /** Thrown for a failing call. Defaults to a generic Error. */
  error?: () => Error;
  /** Extra vendors to return, on top of the defaults. */
  extraVendors?: Array<{ Id: string; DisplayName: string }>;
  /** Extra transactions returned for every transaction entity query. */
  transactions?: Record<string, Array<Record<string, unknown>>>;
}

const DEFAULT_ACCOUNTS = [
  a('1', 'Furniture Sales', 'Income', 'SalesOfProductIncome', 'Revenue'),
  a('2', 'Customer Discounts', 'Income', 'DiscountsRefundsGiven', 'Revenue'),
  a('3', 'Sales Returns', 'Income', 'DiscountsRefundsGiven', 'Revenue'),
  a('4', 'Merchandise Cost', 'Cost of Goods Sold', 'SuppliesMaterialsCogs', 'Expense'),
  a('5', 'Sales Floor Payroll', 'Expense', 'PayrollWageExpenses', 'Expense'),
  a('6', 'Meta Ads', 'Expense', 'AdvertisingPromotional', 'Expense'),
  a('7', 'Showroom Rent', 'Expense', 'RentOrLeaseOfBuildings', 'Expense'),
  a('8', 'Uncategorized Expense', 'Expense', null, 'Expense'),
  a('9', 'Interest Expense', 'Other Expense', 'InterestPaid', 'Expense'),
  a('10', 'Vendor Rebates', 'Other Income', 'OtherMiscellaneousIncome', 'Revenue'),
  a('20', 'Operating Checking', 'Bank', 'Checking', 'Asset'),
  a('21', 'Accounts Receivable', 'Accounts Receivable', 'AccountsReceivable', 'Asset'),
  a('22', 'Merchandise Inventory', 'Other Current Asset', 'Inventory', 'Asset'),
  a('30', 'Accounts Payable', 'Accounts Payable', 'AccountsPayable', 'Liability'),
  a('40', 'Owner Equity', 'Equity', 'OwnersEquity', 'Equity'),
];

function a(
  Id: string, Name: string, AccountType: string,
  AccountSubType: string | null, Classification: string,
) {
  return { Id, Name, FullyQualifiedName: Name, AccountType, AccountSubType, Classification, Active: true };
}

const DEFAULT_VENDORS = [
  { Id: '100', DisplayName: 'Ashley Furniture Industries', Active: true },
  { Id: '101', DisplayName: 'Meta Platforms', Active: true },
  { Id: '102', DisplayName: 'Harborline Logistics', Active: true },
];

const DEFAULT_CUSTOMERS = [
  { Id: '200', DisplayName: 'Walk-in Retail', Active: true },
  { Id: '201', DisplayName: 'Cove Interiors LLC', Active: true },
];

const DEFAULT_DEPARTMENTS = [
  { Id: '300', Name: 'Riverside Showroom', FullyQualifiedName: 'Riverside Showroom', Active: true },
  { Id: '301', Name: 'Northgate Showroom', FullyQualifiedName: 'Northgate Showroom', Active: true },
];

const DEFAULT_ITEMS = [
  { Id: '400', Name: 'Sectional Sofa', Type: 'Inventory', QtyOnHand: 12, UnitPrice: 2400, Active: true },
];

const REPORTS: Record<string, QboReport> = {
  ProfitAndLoss: MOCK_PNL,
  BalanceSheet: MOCK_BALANCE_SHEET,
  AgedReceivables: MOCK_AR_AGING,
  AgedPayables: MOCK_AP_AGING,
};

/** Company info as the entities layer expects to receive it. */
export const STUB_COMPANY_INFO = {
  CompanyInfo: {
    CompanyName: 'Stub Furniture Co.',
    LegalName: 'Stub Furniture Co. LLC',
    Country: 'US',
    FiscalYearStartMonth: 'January',
  },
};

/** Builds a stubbed client plus the call log it records into. */
export function stubQboClient(options: StubOptions = {}): {
  client: QuickBooksClient;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const fail = options.error ?? (() => new Error('QuickBooks is unavailable'));

  const rowsFor = (entity: string): Array<Record<string, unknown>> => {
    if (options.failEntities?.includes(entity)) throw fail();
    switch (entity) {
      case 'Account':
        return DEFAULT_ACCOUNTS;
      case 'Vendor':
        return [...DEFAULT_VENDORS, ...(options.extraVendors ?? []).map((v) => ({ ...v, Active: true }))];
      case 'Customer':
        return DEFAULT_CUSTOMERS;
      case 'Department':
        return DEFAULT_DEPARTMENTS;
      case 'Class':
        return [];
      case 'Item':
        return DEFAULT_ITEMS;
      default:
        return options.transactions?.[entity] ?? [];
    }
  };

  const client = {
    async request<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
      calls.push({ kind: 'query', name: path, params });
      if (path === 'companyinfo/stub-realm' || path.startsWith('companyinfo/')) {
        return STUB_COMPANY_INFO as unknown as T;
      }
      if (path.startsWith('reports/')) {
        return client.report<T>(path.slice('reports/'.length), params);
      }
      throw new Error(`No stub response for ${path}`);
    },

    async report<T>(name: string, params: Record<string, string | undefined> = {}): Promise<T> {
      calls.push({ kind: 'report', name, params });
      if (options.failReports?.includes(name)) throw fail();
      if (name === 'ProfitAndLoss' && params['summarize_column_by']) {
        return MOCK_PNL_BY_LOCATION as unknown as T;
      }
      const payload = REPORTS[name];
      if (!payload) throw new Error(`No stub payload for report ${name}`);
      return payload as unknown as T;
    },

    async query<T>(statement: string): Promise<T> {
      calls.push({ kind: 'query', name: statement });
      return { QueryResponse: {} } as unknown as T;
    },

    async queryAll<T>(entity: string): Promise<T[]> {
      calls.push({ kind: 'query', name: entity });
      return rowsFor(entity) as unknown as T[];
    },
  };

  return { client: client as unknown as QuickBooksClient, calls };
}

