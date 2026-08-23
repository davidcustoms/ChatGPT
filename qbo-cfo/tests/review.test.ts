import { describe, expect, it } from 'vitest';
import {
  duplicateKey,
  isUncategorizedAccount,
  reviewTransactions,
  UNCATEGORIZED_ACCOUNT_PATTERNS,
} from '@/lib/finance/transaction-review';

const base = {
  historyByType: new Map([['Purchase', { median: 3_000, p90: 8_000, count: 40 }]]),
  knownVendorNames: new Set(['Ashley Furniture Industries']),
  duplicateKeys: new Set<string>(),
  largeThreshold: 25_000,
  roundDollarThreshold: 5_000,
  uncategorizedAccountNames: new Set(UNCATEGORIZED_ACCOUNT_PATTERNS),
};

function txn(overrides: Partial<Parameters<typeof reviewTransactions>[0]['transactions'][number]> = {}) {
  return {
    id: 't1',
    qboId: 'q1',
    txnType: 'Purchase',
    txnDate: '2026-08-12',
    docNumber: 'D-1',
    entityName: 'Ashley Furniture Industries',
    memo: null,
    amount: 1_200,
    accountName: 'Merchandise Cost',
    locationName: 'Riverside',
    ...overrides,
  };
}

describe('transaction review', () => {
  it('leaves ordinary transactions alone', () => {
    expect(reviewTransactions({ ...base, transactions: [txn()] })).toHaveLength(0);
  });

  it('flags a transaction above the large threshold', () => {
    const [flagged] = reviewTransactions({ ...base, transactions: [txn({ amount: 40_000 })] });
    expect(flagged?.reasons.some((r) => /Large transaction/.test(r))).toBe(true);
  });

  it('flags an amount well above the historical pattern for its type', () => {
    const [flagged] = reviewTransactions({ ...base, transactions: [txn({ amount: 30_000 })] });
    expect(flagged?.reasons.some((r) => /historical pattern/.test(r))).toBe(true);
  });

  it('flags an unknown payee', () => {
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ entityName: 'Brand New Supplier', amount: 26_000 })],
    });
    expect(flagged?.reasons.some((r) => /not in the QuickBooks vendor list/.test(r))).toBe(true);
  });

  it('flags a posting to an uncategorised account', () => {
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ accountName: 'Uncategorized Expense', amount: 6_000 })],
    });
    expect(flagged?.reasons.some((r) => /uncategorised account/i.test(r))).toBe(true);
  });

  it('flags duplicate payee and amount pairs', () => {
    const [flagged] = reviewTransactions({
      ...base,
      duplicateKeys: new Set([duplicateKey('Ashley Furniture Industries', 6_000)]),
      transactions: [txn({ amount: 6_000 })],
    });
    expect(flagged?.reasons.some((r) => /more than once this month/.test(r))).toBe(true);
  });

  it('flags round-dollar amounts above the threshold', () => {
    const [flagged] = reviewTransactions({ ...base, transactions: [txn({ amount: 12_000 })] });
    expect(flagged?.reasons.some((r) => /Round-dollar/.test(r))).toBe(true);
  });

  it('flags a large weekend transaction', () => {
    // 2026-08-22 is a Saturday.
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ amount: 13_500, txnDate: '2026-08-22' })],
    });
    expect(flagged?.reasons.some((r) => /weekend/.test(r))).toBe(true);
  });

  it('flags an owner distribution', () => {
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ entityName: 'Owner Distribution', amount: 95_000, memo: 'Quarterly owner distribution' })],
    });
    expect(flagged?.reasons.some((r) => /owner distribution/i.test(r))).toBe(true);
    expect(flagged?.severity).toBe('CRITICAL');
  });

  it('flags a large refund', () => {
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ txnType: 'RefundReceipt', amount: 7_500 })],
    });
    expect(flagged?.reasons.some((r) => /refund or credit memo/i.test(r))).toBe(true);
  });

  it('flags a missing location on a material transaction', () => {
    const [flagged] = reviewTransactions({
      ...base,
      transactions: [txn({ amount: 14_500, locationName: null })],
    });
    expect(flagged?.reasons.some((r) => /No location or class assigned/.test(r))).toBe(true);
  });

  it('ranks the most serious findings first', () => {
    const flagged = reviewTransactions({
      ...base,
      transactions: [
        txn({ id: 'a', amount: 12_000 }),
        txn({ id: 'b', amount: 95_000, entityName: 'Owner Distribution', memo: 'draw' }),
      ],
    });
    expect(flagged[0]?.id).toBe('b');
    expect(flagged[0]!.score).toBeGreaterThan(flagged[1]!.score);
  });
});

describe('uncategorised account detection', () => {
  it('recognises the common suspense account names', () => {
    for (const name of [
      'Uncategorized Expense',
      'Uncategorised Income',
      'Ask My Accountant',
      'Suspense Account',
      'Opening Balance Equity',
    ]) {
      expect(isUncategorizedAccount(name)).toBe(true);
    }
  });

  it('does not flag ordinary accounts', () => {
    expect(isUncategorizedAccount('Merchandise Cost')).toBe(false);
    expect(isUncategorizedAccount('Showroom Rent')).toBe(false);
  });
});
