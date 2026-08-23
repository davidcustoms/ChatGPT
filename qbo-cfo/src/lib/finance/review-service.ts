import { listVendors } from '../db/repositories/masterdata';
import { getAccountMetrics } from '../db/repositories/metrics';
import { listDimensions } from '../db/repositories/masterdata';
import {
  amountStatsByType,
  duplicateCandidates,
  listTransactions,
  transactionsForAccount,
} from '../db/repositories/transactions';
import type { FlaggedTransaction } from './types';
import {
  duplicateKey,
  isUncategorizedAccount,
  reviewTransactions,
  UNCATEGORIZED_ACCOUNT_PATTERNS,
} from './transaction-review';
import type { Period } from '../util/dates';

/**
 * Assembles everything the "Transactions Needing Attention" page needs.
 * Review only: nothing here modifies a QuickBooks record.
 */
export async function buildReviewQueue(input: {
  companyId: string;
  period: Period;
  largeThreshold: number;
}): Promise<{ flagged: FlaggedTransaction[]; scanned: number; uncategorizedAccounts: string[] }> {
  const { companyId, period } = input;

  const [transactions, vendors, stats, duplicates, accountRows, locations] = await Promise.all([
    listTransactions(companyId, period, 1500),
    listVendors(companyId),
    amountStatsByType(companyId, period.start, 12),
    duplicateCandidates(companyId, period, Math.max(500, input.largeThreshold / 10)),
    getAccountMetrics(companyId, period),
    listDimensions('locations', companyId),
  ]);

  const uncategorizedAccounts = accountRows
    .filter((r) => isUncategorizedAccount(r.accountName))
    .map((r) => r.accountName);

  const locationByQboId = new Map(locations.map((l) => [l.qboId, l.displayName ?? l.name]));

  // Attach the posting account for the transactions that have one line-level account.
  const uncategorizedAccountIds = accountRows
    .filter((r) => isUncategorizedAccount(r.accountName))
    .map((r) => r.accountQboId)
    .filter((id) => !id.startsWith('__'));
  const uncategorizedTxns = await transactionsForAccount(
    companyId,
    uncategorizedAccountIds,
    period,
    300,
  );
  const accountByTxnId = new Map(uncategorizedTxns.map((t) => [t.id, t.accountName]));

  const flagged = reviewTransactions({
    transactions: transactions.map((t) => ({
      id: t.id,
      qboId: t.qboId,
      txnType: t.txnType,
      txnDate: t.txnDate,
      docNumber: t.docNumber,
      entityName: t.entityName,
      memo: t.memo,
      amount: t.amount,
      accountName: accountByTxnId.get(t.id) ?? null,
      locationName: t.locationQboId ? (locationByQboId.get(t.locationQboId) ?? null) : null,
    })),
    historyByType: stats,
    knownVendorNames: new Set(vendors.map((v) => v.name)),
    duplicateKeys: new Set(duplicates.map((d) => duplicateKey(d.entityName, d.amount))),
    largeThreshold: input.largeThreshold,
    roundDollarThreshold: Math.max(1000, input.largeThreshold / 5),
    uncategorizedAccountNames: new Set([
      ...UNCATEGORIZED_ACCOUNT_PATTERNS,
      ...uncategorizedAccounts.map((n) => n.toLowerCase()),
    ]),
  });

  return { flagged, scanned: transactions.length, uncategorizedAccounts };
}
