import { describe, expect, it } from 'vitest';
import { AUTO_APPLY_CONFIDENCE, partitionSuggestions, suggestAll, suggestCategory } from '@/lib/finance/mapping';
import { CATEGORY_BY_KEY, categoryLabel, categorySection, DEFAULT_CATEGORIES } from '@/lib/finance/categories';
import type { AccountRecord } from '@/lib/finance/types';
import { MOCK_ACCOUNTS } from './fixtures/mock-reports';

function account(partial: Partial<AccountRecord> & { name: string }): AccountRecord {
  return {
    qboId: partial.qboId ?? 'x',
    name: partial.name,
    fullyQualifiedName: partial.fullyQualifiedName ?? partial.name,
    accountNumber: null,
    accountType: partial.accountType ?? 'Expense',
    accountSubType: partial.accountSubType ?? null,
    classification: partial.classification ?? 'Expense',
    parentQboId: null,
    isActive: partial.isActive ?? true,
    currentBalance: null,
  };
}

describe('category taxonomy', () => {
  it('has unique keys', () => {
    const keys = DEFAULT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every management category the report needs', () => {
    for (const key of [
      'revenue', 'discounts', 'returns', 'cogs', 'payroll', 'advertising', 'rent', 'delivery',
      'freight', 'warehouse', 'merchant_processing', 'financing_fees', 'utilities', 'insurance',
      'repairs', 'vehicles', 'professional_fees', 'software', 'interest', 'bank_fees', 'taxes',
      'other_opex',
    ]) {
      expect(CATEGORY_BY_KEY.has(key)).toBe(true);
    }
  });

  it('labels and sections unknown keys safely', () => {
    expect(categoryLabel(null)).toBe('Unmapped');
    expect(categoryLabel('custom_key')).toBe('Custom Key');
    expect(categorySection('not_a_category')).toBeNull();
  });
});

describe('mapping suggestions', () => {
  it('prefers the QuickBooks sub-type and marks it high confidence', () => {
    const s = suggestCategory(
      account({ name: 'Marketing & Media', accountSubType: 'AdvertisingPromotional' }),
    );
    expect(s?.categoryKey).toBe('advertising');
    expect(s?.confidence).toBeGreaterThanOrEqual(AUTO_APPLY_CONFIDENCE);
    expect(s?.reason).toMatch(/sub-type/i);
  });

  it('maps advertising vendors by name without hard-coding the account label', () => {
    for (const name of ['Facebook Advertising', 'Google Ads', 'TikTok Ads', 'Meta Ads Spend']) {
      expect(suggestCategory(account({ name }))?.categoryKey).toBe('advertising');
    }
  });

  it('maps a payroll-named delivery account by its strongest keyword', () => {
    // "Delivery Payroll" contains both keywords; the longer, more specific
    // match should not silently lose to the shorter one.
    const s = suggestCategory(account({ name: 'Delivery Payroll' }));
    expect(['delivery', 'payroll']).toContain(s?.categoryKey);
    expect(s?.confidence).toBeLessThan(AUTO_APPLY_CONFIDENCE);
  });

  it('falls back to the account type when no keyword matches', () => {
    const s = suggestCategory(account({ name: 'Zzz Miscellany', accountType: 'Expense' }));
    expect(s?.categoryKey).toBe('other_opex');
    expect(s?.confidence).toBeLessThan(AUTO_APPLY_CONFIDENCE);
  });

  it('classifies income accounts into revenue-side categories only', () => {
    const s = suggestCategory(account({ name: 'Furniture Sales', accountType: 'Income' }));
    expect(categorySection(s!.categoryKey)).toBe('revenue');
  });

  it('recognises contra revenue', () => {
    const s = suggestCategory(
      account({ name: 'Customer Discounts', accountType: 'Income', accountSubType: 'DiscountsRefundsGiven' }),
    );
    expect(s?.categoryKey).toBe('discounts');
  });

  it('ignores balance sheet accounts', () => {
    expect(suggestCategory(account({ name: 'Operating Checking', accountType: 'Bank' }))).toBeNull();
    expect(suggestCategory(account({ name: 'Accounts Payable', accountType: 'Accounts Payable' }))).toBeNull();
  });

  it('skips inactive accounts when suggesting in bulk', () => {
    const suggestions = suggestAll([
      account({ qboId: 'a', name: 'Meta Ads' }),
      account({ qboId: 'b', name: 'Google Ads', isActive: false }),
    ]);
    expect(suggestions.map((s) => s.accountQboId)).toEqual(['a']);
  });
});

describe('approval gating', () => {
  it('only auto-applies high-confidence suggestions', () => {
    const { autoApply, needsReview } = partitionSuggestions(suggestAll(MOCK_ACCOUNTS));
    expect(autoApply.every((s) => s.confidence >= AUTO_APPLY_CONFIDENCE)).toBe(true);
    expect(needsReview.every((s) => s.confidence < AUTO_APPLY_CONFIDENCE)).toBe(true);
  });

  it('sends the deliberately ambiguous account to review', () => {
    const { needsReview } = partitionSuggestions(suggestAll(MOCK_ACCOUNTS));
    expect(needsReview.some((s) => s.accountName === 'Uncategorized Expense')).toBe(true);
  });
});
