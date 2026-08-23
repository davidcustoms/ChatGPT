import type { QuickBooksClient } from '../qbo/client';
import type { QboReport } from '../qbo/report-types';
import {
  TRANSACTION_ENTITIES,
  fetchAccounts,
  fetchClasses,
  fetchCompanyInfo,
  fetchCustomers,
  fetchLocations,
  fetchTransactions,
  fetchVendors,
} from '../qbo/entities';
import { flattenReport, isEmptyReport } from '../qbo/parse';
import { getValidAccessToken } from '../qbo/token-manager';
import { AppError } from '../errors';
import type { Period } from '../util/dates';
import {
  fail,
  notAvailable,
  pass,
  type ValidationCheck,
  type ValidationSection,
} from './types';

/**
 * Item 3: the live connection checklist.
 *
 * Everything QuickBooks is asked for, with PASS / FAIL / NOT AVAILABLE for
 * each. The distinction that matters: a company with no Locations returns
 * NOT_AVAILABLE, not FAIL. Most QuickBooks companies do not use Locations, and
 * that says nothing about this application.
 */

function message(err: unknown): string {
  if (err instanceof AppError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - startedAt };
}

/** Codes that mean "this company cannot produce that", not "we are broken". */
function isUnavailable(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.code === 'QBO_REPORT_UNAVAILABLE' || err.code === 'QBO_EMPTY_PERIOD';
}

export interface ConnectionResult {
  section: ValidationSection;
  /** Counts the later sections need. */
  facts: {
    accountCount: number;
    vendorCount: number;
    customerCount: number;
    locationCount: number;
    classCount: number;
    transactionCount: number;
    hasProfitAndLoss: boolean;
    hasBalanceSheet: boolean;
    hasReceivableAging: boolean;
    hasPayableAging: boolean;
    quickbooksCompanyName: string | null;
    fiscalYearStartMonth: number | null;
  };
}

export async function validateConnection(input: {
  client: QuickBooksClient;
  connectionId: string;
  realmId: string;
  period: Period;
  priorPeriod: Period;
  accountingMethod: 'Accrual' | 'Cash';
}): Promise<ConnectionResult> {
  const checks: ValidationCheck[] = [];
  const facts: ConnectionResult['facts'] = {
    accountCount: 0, vendorCount: 0, customerCount: 0, locationCount: 0,
    classCount: 0, transactionCount: 0, hasProfitAndLoss: false,
    hasBalanceSheet: false, hasReceivableAging: false, hasPayableAging: false,
    quickbooksCompanyName: null, fiscalYearStartMonth: null,
  };

  // --- CompanyInfo ---------------------------------------------------------
  try {
    const { value: info, ms } = await timed(() => fetchCompanyInfo(input.client, input.realmId));
    facts.quickbooksCompanyName = info.companyName ?? null;
    facts.fiscalYearStartMonth = info.fiscalYearStartMonth;
    checks.push(
      pass(
        'company_info', 'Connection', 'CompanyInfo',
        `${info.companyName ?? 'unnamed company'}${info.country ? ` (${info.country})` : ''}, fiscal year starts ${
          info.fiscalYearStartMonth ? `month ${info.fiscalYearStartMonth}` : 'unreported — the configured value is used'
        }.`,
        ms,
      ),
    );
  } catch (err) {
    checks.push(
      fail('company_info', 'Connection', 'CompanyInfo', message(err),
        'The connection cannot read the company. Reconnect QuickBooks in Settings.'),
    );
  }

  // --- Master data ---------------------------------------------------------
  const entity = async (
    key: string,
    name: string,
    fetcher: () => Promise<unknown[]>,
    onCount: (n: number) => void,
    optional: boolean,
  ): Promise<void> => {
    try {
      const { value, ms } = await timed(fetcher);
      onCount(value.length);
      if (value.length === 0 && optional) {
        checks.push(
          notAvailable(key, 'Master data', name,
            `This QuickBooks company has no ${name.toLowerCase()}. Not an error — the feature is simply not in use.`),
        );
        return;
      }
      if (value.length === 0) {
        checks.push(
          fail(key, 'Master data', name, `QuickBooks returned no ${name.toLowerCase()}.`,
            `A company with no ${name.toLowerCase()} cannot be reported on. Check the connected company is the right one.`),
        );
        return;
      }
      checks.push(pass(key, 'Master data', name, `${value.length} returned.`, ms));
    } catch (err) {
      checks.push(
        fail(key, 'Master data', name, message(err),
          'Retry the validation. If it persists, the connected user may lack permission for this entity.'),
      );
    }
  };

  await entity('accounts', 'Chart of Accounts', () => fetchAccounts(input.client), (n) => { facts.accountCount = n; }, false);
  await entity('vendors', 'Vendors', () => fetchVendors(input.client), (n) => { facts.vendorCount = n; }, true);
  await entity('customers', 'Customers', () => fetchCustomers(input.client), (n) => { facts.customerCount = n; }, true);
  await entity('locations', 'Locations', () => fetchLocations(input.client), (n) => { facts.locationCount = n; }, true);
  await entity('classes', 'Classes', () => fetchClasses(input.client), (n) => { facts.classCount = n; }, true);

  // --- Reports -------------------------------------------------------------
  const report = async (
    key: string,
    name: string,
    params: Record<string, string>,
    reportName: string,
    required: boolean,
    onOk: () => void,
  ): Promise<void> => {
    try {
      const { value, ms } = await timed(() =>
        input.client.report<QboReport>(reportName, params),
      );
      const flat = flattenReport(value);
      if (isEmptyReport(flat)) {
        checks.push(
          notAvailable(key, 'Reports', name,
            `QuickBooks returned the report with no rows for this period. That usually means no activity, not a fault.`),
        );
        return;
      }
      onOk();
      checks.push(pass(key, 'Reports', name, `${flat.rows.length} rows, ${flat.summaries.length} subtotals.`, ms));
    } catch (err) {
      if (isUnavailable(err) || !required) {
        checks.push(
          notAvailable(key, 'Reports', name,
            `QuickBooks cannot produce this report for this company: ${message(err)}. The related figures are shown as unavailable rather than estimated.`),
        );
        return;
      }
      checks.push(
        fail(key, 'Reports', name, message(err),
          'This report is required to produce a monthly report. Retry, then check the connected user has full reporting access.'),
      );
    }
  };

  const range = { start_date: input.period.start, end_date: input.period.end, accounting_method: input.accountingMethod };

  await report('pnl', 'Profit & Loss', range, 'ProfitAndLoss', true, () => { facts.hasProfitAndLoss = true; });
  await report('balance_sheet', 'Balance Sheet', range, 'BalanceSheet', true, () => { facts.hasBalanceSheet = true; });
  await report('cash_flow', 'Statement of Cash Flows',
    { start_date: input.period.start, end_date: input.period.end }, 'CashFlow', false, () => undefined);
  await report('ar_aging', 'A/R Aging', { report_date: input.period.end }, 'AgedReceivables', false,
    () => { facts.hasReceivableAging = true; });
  await report('ap_aging', 'A/P Aging', { report_date: input.period.end }, 'AgedPayables', false,
    () => { facts.hasPayableAging = true; });

  // A historical period, to prove report retrieval is not limited to the
  // current month.
  await report('historical_pnl', 'Historical report retrieval',
    { start_date: input.priorPeriod.start, end_date: input.priorPeriod.end, accounting_method: input.accountingMethod },
    'ProfitAndLoss', false, () => undefined);

  // --- Transactions --------------------------------------------------------
  try {
    let total = 0;
    const perEntity: string[] = [];
    const startedAt = Date.now();
    for (const name of TRANSACTION_ENTITIES) {
      const rows = await fetchTransactions(input.client, name, input.period.start, input.period.end);
      total += rows.length;
      if (rows.length > 0) perEntity.push(`${name} ${rows.length}`);
    }
    facts.transactionCount = total;
    checks.push(
      total === 0
        ? notAvailable('transactions', 'Transactions', 'Transaction retrieval',
            'No transactions of any type in this period. Vendor analysis and drill-down will be empty for it.')
        : pass('transactions', 'Transactions', 'Transaction retrieval',
            `${total} across ${perEntity.length} types (${perEntity.join(', ')}).`, Date.now() - startedAt),
    );
  } catch (err) {
    checks.push(
      fail('transactions', 'Transactions', 'Transaction retrieval', message(err),
        'Vendor spend and drill-down depend on this. Retry; if it persists the connected user may lack transaction access.'),
    );
  }

  // --- Token refresh -------------------------------------------------------
  try {
    const { value: token, ms } = await timed(() => getValidAccessToken(input.connectionId));
    checks.push(
      token
        ? pass('token_refresh', 'Connection', 'Token refresh',
            'A valid access token was obtained. Expiry is tracked and refreshed automatically before each sync.', ms)
        : fail('token_refresh', 'Connection', 'Token refresh', 'No access token was returned.',
            'Reconnect QuickBooks in Settings.'),
    );
  } catch (err) {
    checks.push(
      fail('token_refresh', 'Connection', 'Token refresh', message(err),
        'Reconnect QuickBooks in Settings. The refresh token may have expired (Intuit expires them after 100 days idle).'),
    );
  }

  return {
    section: {
      key: 'connection',
      title: 'Live connection checklist',
      checks,
      note: 'Every call above is a GET. A report or entity this QuickBooks company does not offer is reported as NOT AVAILABLE, which is not an application failure.',
    },
    facts,
  };
}
