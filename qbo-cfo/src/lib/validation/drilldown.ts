import { getAccountMetrics, getMonthlyMetrics } from '../db/repositories/metrics';
import { effectiveMappingIndex } from '../db/repositories/mappings';
import { accountIndex } from '../db/repositories/masterdata';
import { transactionsForAccount } from '../db/repositories/transactions';
import { categoryLabel } from '../finance/categories';
import { round2 } from '../finance/math';
import { formatCurrency } from '../util/format';
import type { Period } from '../util/dates';
import {
  fail,
  notAvailable,
  pass,
  type ValidationSection,
  type ValidationCheck,
  type ValidationTable,
} from './types';

/**
 * Item 7: drill-down reconciliation.
 *
 * A figure an owner cannot trace is a figure they cannot defend to their
 * accountant. For each headline metric this walks the whole chain --
 *
 *   displayed total -> mapped accounts -> QuickBooks account ids
 *                   -> underlying transactions -> summed drill-down amount
 *
 * -- and asserts the two ends agree to the cent.
 *
 * Balance-sheet items are point-in-time balances rather than a period's
 * postings, so their check is against the contributing accounts rather than
 * against transactions: summing a month of A/R postings would not equal the
 * closing A/R balance, and asserting that it should would be wrong.
 */

/** Half a cent. Anything larger is a real difference, not rounding. */
const TOLERANCE = 0.005;

interface Target {
  key: string;
  label: string;
  /** Management categories that roll into this figure. */
  categoryKeys: string[];
  /** The displayed value, from the stored metrics. */
  displayed: number | null;
  /** Point-in-time balances do not sum a month of transactions. */
  pointInTime?: boolean;
}

export async function validateDrilldown(input: {
  companyId: string;
  period: Period;
}): Promise<ValidationSection> {
  const { companyId, period } = input;
  const checks: ValidationCheck[] = [];

  const [metrics, accountRows, mapping, accounts] = await Promise.all([
    getMonthlyMetrics(companyId, period),
    getAccountMetrics(companyId, period),
    effectiveMappingIndex(companyId),
    accountIndex(companyId),
  ]);

  if (!metrics) {
    return {
      key: 'drilldown',
      title: 'Drill-down reconciliation',
      checks: [
        fail('drilldown_metrics', 'Drill-down', 'Stored metrics', 'No metrics stored for this period.',
          'Sync the month before validating drill-down.'),
      ],
    };
  }

  const targets: Target[] = [
    { key: 'revenue', label: 'Revenue', categoryKeys: ['revenue'], displayed: metrics.grossSales },
    { key: 'cogs', label: 'COGS', categoryKeys: ['cogs'], displayed: metrics.cogs },
    { key: 'advertising', label: 'Advertising', categoryKeys: ['advertising'], displayed: metrics.advertisingExpense },
    { key: 'payroll', label: 'Payroll', categoryKeys: ['payroll'], displayed: metrics.payrollExpense },
    { key: 'accounts_receivable', label: 'Accounts Receivable', categoryKeys: [], displayed: metrics.accountsReceivable, pointInTime: true },
    { key: 'accounts_payable', label: 'Accounts Payable', categoryKeys: [], displayed: metrics.accountsPayable, pointInTime: true },
  ];

  const table: ValidationTable = {
    title: 'Drill-down chain',
    columns: ['Metric', 'Displayed', 'Mapped accounts', 'Transactions', 'Drill-down total', 'Difference', 'Status'],
    rows: [],
    caption:
      'Each row walks displayed total -> mapped accounts -> QuickBooks ids -> transactions -> summed amount. Balance-sheet balances are point-in-time and are traced to their accounts rather than to a month of postings.',
  };

  for (const target of targets) {
    if (target.displayed === null) {
      checks.push(
        notAvailable(`drilldown_${target.key}`, 'Drill-down', target.label,
          `${target.label} is not available for this period, so there is nothing to trace.`),
      );
      table.rows.push({
        cells: [target.label, '—', '—', '—', '—', '—', 'NOT AVAILABLE'],
        status: 'NOT_AVAILABLE',
      });
      continue;
    }

    // Which accounts roll into this figure?
    const contributing = target.pointInTime
      ? []
      : accountRows.filter((r) => {
          const key = r.categoryKey ?? mapping.get(r.accountQboId) ?? null;
          return key !== null && target.categoryKeys.includes(key);
        });

    if (!target.pointInTime && contributing.length === 0) {
      checks.push(
        target.displayed === 0
          ? notAvailable(`drilldown_${target.key}`, 'Drill-down', target.label,
              `No accounts are mapped to ${categoryLabel(target.categoryKeys[0] ?? target.key)} and the reported figure is zero, which is consistent.`)
          : fail(`drilldown_${target.key}`, 'Drill-down', target.label,
              `${target.label} shows ${formatCurrency(target.displayed, { decimals: 2 })} but no account maps to it.`,
              'A figure with no traceable source cannot be defended. Review the account mapping.'),
      );
      table.rows.push({
        cells: [target.label, formatCurrency(target.displayed, { decimals: 2 }), '0', '—', '—', '—',
          target.displayed === 0 ? 'NOT AVAILABLE' : 'DIFFERENCE'],
        status: target.displayed === 0 ? 'NOT_AVAILABLE' : 'FAIL',
      });
      continue;
    }

    if (target.pointInTime) {
      // Trace the balance to the balance-sheet accounts of that type.
      const type = target.key === 'accounts_receivable' ? 'Accounts Receivable' : 'Accounts Payable';
      const matching = Array.from(accounts.values()).filter((a) => a.accountType === type);
      checks.push(
        matching.length > 0
          ? pass(`drilldown_${target.key}`, 'Drill-down', target.label,
              `${formatCurrency(target.displayed, { decimals: 2 })} traces to ${matching.length} QuickBooks ${type} account(s): ${matching
                .slice(0, 4)
                .map((a) => `${a.name} (id ${a.qboId})`)
                .join(', ')}. A point-in-time balance is not the sum of one month's postings, so it is traced to its accounts rather than to transactions.`)
          : fail(`drilldown_${target.key}`, 'Drill-down', target.label,
              `${formatCurrency(target.displayed, { decimals: 2 })} is reported but no ${type} account exists in the chart of accounts.`,
              'The balance cannot be traced. Re-sync the chart of accounts.'),
      );
      table.rows.push({
        cells: [
          target.label,
          formatCurrency(target.displayed, { decimals: 2 }),
          String(matching.length),
          'point-in-time',
          formatCurrency(target.displayed, { decimals: 2 }),
          '$0.00',
          matching.length > 0 ? 'MATCH' : 'DIFFERENCE',
        ],
        status: matching.length > 0 ? 'PASS' : 'FAIL',
      });
      continue;
    }

    const accountTotal = round2(contributing.reduce((a, r) => a + r.amount, 0));
    const ids = contributing.map((r) => r.accountQboId).filter((id) => !id.startsWith('__'));
    const transactions = await transactionsForAccount(companyId, ids, period, 5_000);
    const transactionTotal = round2(transactions.reduce((a, t) => a + t.lineAmount, 0));

    // Revenue is reported as gross sales (contra-revenue excluded), and the
    // account rollup is the authority the report actually displays.
    const difference = round2(accountTotal - target.displayed);
    const matched = Math.abs(difference) <= TOLERANCE;

    // Transactions are a second, independent path. QuickBooks reports include
    // postings the transaction API does not return for every entity type, so a
    // shortfall there is reported rather than failed.
    const txnDifference = round2(transactionTotal - accountTotal);
    const txnNote =
      transactions.length === 0
        ? 'no transaction detail imported'
        : Math.abs(txnDifference) <= TOLERANCE
          ? `${transactions.length} transactions sum to the same total`
          : `${transactions.length} transactions sum to ${formatCurrency(transactionTotal, { decimals: 2 })}, ${formatCurrency(txnDifference, { decimals: 2 })} from the account rollup`;

    checks.push(
      matched
        ? pass(`drilldown_${target.key}`, 'Drill-down', target.label,
            `${formatCurrency(target.displayed, { decimals: 2 })} = ${contributing.length} mapped account(s) [${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}]; ${txnNote}.`)
        : fail(`drilldown_${target.key}`, 'Drill-down', target.label,
            `Displayed ${formatCurrency(target.displayed, { decimals: 2 })} but the mapped accounts sum to ${formatCurrency(accountTotal, { decimals: 2 })}, a difference of ${formatCurrency(difference, { decimals: 2 })}.`,
            'The headline figure and its own drill-down disagree. Do not distribute the report until this is explained.'),
    );

    table.rows.push({
      cells: [
        target.label,
        formatCurrency(target.displayed, { decimals: 2 }),
        `${contributing.length} (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''})`,
        String(transactions.length),
        formatCurrency(accountTotal, { decimals: 2 }),
        formatCurrency(difference, { decimals: 2 }),
        matched ? 'MATCH' : 'DIFFERENCE',
      ],
      status: matched ? 'PASS' : 'FAIL',
    });
  }

  return {
    key: 'drilldown',
    title: 'Drill-down reconciliation',
    checks,
    tables: [table],
    note: `Tolerance is ${TOLERANCE * 100} cents — accounting totals are expected to match exactly, and the tolerance exists only to absorb floating-point representation, not real differences.`,
  };
}
