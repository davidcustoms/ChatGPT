import { round2 } from './math';
import type { FlaggedTransaction, Severity } from './types';
import { isWeekend } from '../util/dates';

/**
 * "Transactions Needing Attention" -- review only.
 *
 * Nothing in this module writes to QuickBooks; it produces a ranked list for a
 * human (or their bookkeeper) to inspect.
 */

export interface ReviewInput {
  transactions: Array<{
    id: string;
    qboId: string;
    txnType: string;
    txnDate: string;
    docNumber: string | null;
    entityName: string | null;
    memo: string | null;
    amount: number;
    accountName?: string | null;
    locationName?: string | null;
    accountCategoryKey?: string | null;
  }>;
  /** Per-transaction-type historical medians/p90, used for "unusually large". */
  historyByType: Map<string, { median: number; p90: number; count: number }>;
  knownVendorNames: Set<string>;
  duplicateKeys: Set<string>;
  largeThreshold: number;
  roundDollarThreshold: number;
  /** Account names that indicate an uncategorised bucket. */
  uncategorizedAccountNames: Set<string>;
  distributionKeywords?: string[];
}

const DEFAULT_DISTRIBUTION_KEYWORDS = ['owner', 'distribution', 'draw', 'shareholder', 'dividend'];

export function reviewTransactions(input: ReviewInput): FlaggedTransaction[] {
  const flagged: FlaggedTransaction[] = [];
  const distributionKeywords = input.distributionKeywords ?? DEFAULT_DISTRIBUTION_KEYWORDS;

  for (const txn of input.transactions) {
    const reasons: string[] = [];
    const magnitude = Math.abs(txn.amount);
    let weight = 0;

    if (magnitude >= input.largeThreshold) {
      reasons.push(`Large transaction (${magnitude >= input.largeThreshold * 3 ? 'well ' : ''}above the ${input.largeThreshold.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} review threshold)`);
      weight += 3;
    }

    const history = input.historyByType.get(txn.txnType);
    if (history && history.count >= 8 && history.p90 > 0 && magnitude > history.p90 * 1.5) {
      reasons.push(
        `Materially above the historical pattern for ${txn.txnType} (90th percentile ${round2(history.p90).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })})`,
      );
      weight += 2;
    }

    if (txn.entityName && !input.knownVendorNames.has(txn.entityName)) {
      reasons.push('Payee is not in the QuickBooks vendor list');
      weight += 1;
    }

    if (txn.accountName && input.uncategorizedAccountNames.has(txn.accountName.toLowerCase())) {
      reasons.push(`Posted to an uncategorised account (${txn.accountName})`);
      weight += 3;
    }

    if (input.duplicateKeys.has(duplicateKey(txn.entityName, txn.amount))) {
      reasons.push('Same payee and amount appears more than once this month');
      weight += 2;
    }

    if (magnitude >= input.roundDollarThreshold && magnitude % 1000 === 0) {
      reasons.push('Round-dollar amount');
      weight += 1;
    }

    if (isWeekend(txn.txnDate) && magnitude >= input.largeThreshold / 2) {
      reasons.push('Large transaction dated on a weekend');
      weight += 1;
    }

    const haystack = `${txn.entityName ?? ''} ${txn.memo ?? ''} ${txn.accountName ?? ''}`.toLowerCase();
    if (distributionKeywords.some((k) => haystack.includes(k)) && magnitude >= input.largeThreshold / 2) {
      reasons.push('Looks like an owner distribution or draw');
      weight += 2;
    }
    if (/transfer/i.test(haystack) && magnitude >= input.largeThreshold) {
      reasons.push('Large transfer between accounts');
      weight += 1;
    }
    if (
      (txn.txnType === 'RefundReceipt' || txn.txnType === 'CreditMemo' || /refund/i.test(haystack)) &&
      magnitude >= input.largeThreshold / 5
    ) {
      reasons.push('Large refund or credit memo');
      weight += 2;
    }
    if (!txn.locationName && magnitude >= input.largeThreshold / 2) {
      reasons.push('No location or class assigned');
      weight += 1;
    }

    if (reasons.length === 0) continue;

    const severity: Severity =
      weight >= 6 ? 'CRITICAL' : weight >= 4 ? 'IMPORTANT' : weight >= 2 ? 'WATCH' : 'INFO';

    flagged.push({
      id: txn.id,
      qboId: txn.qboId,
      txnType: txn.txnType,
      txnDate: txn.txnDate,
      docNumber: txn.docNumber,
      entityName: txn.entityName,
      memo: txn.memo,
      amount: txn.amount,
      accountName: txn.accountName ?? null,
      locationName: txn.locationName ?? null,
      reasons,
      severity,
      score: round2(weight * 10 + Math.min(magnitude / 1000, 100)),
    });
  }

  return flagged.sort((a, b) => b.score - a.score);
}

export function duplicateKey(entityName: string | null, amount: number): string {
  return `${(entityName ?? '').toLowerCase()}|${amount.toFixed(2)}`;
}

/** Account names that commonly indicate an unclassified bucket. */
export const UNCATEGORIZED_ACCOUNT_PATTERNS = [
  'uncategorized expense',
  'uncategorised expense',
  'uncategorized income',
  'uncategorised income',
  'uncategorized asset',
  'uncategorised asset',
  'ask my accountant',
  'suspense',
  'unapplied cash',
  'opening balance equity',
];

export function isUncategorizedAccount(name: string): boolean {
  const lower = name.toLowerCase();
  return UNCATEGORIZED_ACCOUNT_PATTERNS.some((p) => lower.includes(p));
}
