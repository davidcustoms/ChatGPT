import { describe, expect, it } from 'vitest';
import { classifyQuestion, resolvePeriodHint } from '@/lib/ai/intent';

const intentOf = (q: string) => classifyQuestion(q).intent;

describe('intent classification', () => {
  it('recognises the documented example questions', () => {
    expect(intentOf('How did we do last month?')).toBe('month_summary');
    expect(intentOf('Why did profit go down?')).toBe('expense_drivers');
    expect(intentOf('Which expense increased the most?')).toBe('expense_drivers');
    expect(intentOf('Compare July and August')).toBe('compare_periods');
    expect(intentOf('Which store performed best?')).toBe('store_performance');
    expect(intentOf('Which store has the highest payroll percentage?')).toBe('store_performance');
    expect(intentOf('Who are our largest vendors?')).toBe('vendor_spend');
    expect(intentOf('What is our gross margin trend?')).toBe('margin_trend');
    expect(intentOf('Are expenses growing faster than sales?')).toBe('expense_drivers');
    expect(intentOf('What should I pay attention to this month?')).toBe('attention');
    expect(intentOf('Show me our worst three months.')).toBe('worst_months');
    expect(intentOf('Compare this year to last year.')).toBe('year_comparison');
    expect(intentOf('What happened to cash?')).toBe('cash');
    expect(intentOf('Which overdue receivables need attention?')).toBe('receivables');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(intentOf('Tell me a joke')).toBe('unknown');
  });
});

describe('entity extraction', () => {
  it('extracts explicit YYYY-MM periods', () => {
    expect(classifyQuestion('How did 2026-07 look?').periodHints).toEqual(['2026-07']);
  });

  it('extracts month names with and without a year', () => {
    expect(classifyQuestion('Compare July 2026 and August 2026').periodHints).toEqual(['2026-07', '2026-08']);
    expect(classifyQuestion('How was August?').periodHints).toEqual(['????-08']);
  });

  it('extracts an expense category', () => {
    expect(classifyQuestion('What did we spend on advertising this year?').categoryHint).toBe('advertising');
    expect(classifyQuestion('How much was payroll?').categoryHint).toBe('payroll');
    expect(classifyQuestion('Show me merchant processing fees').categoryHint).toBe('merchant_processing');
  });

  it('extracts a vendor name', () => {
    expect(classifyQuestion('How much did we pay Meta Platforms?').vendorHint).toBe('Meta Platforms');
  });

  it('reads a numeric limit in digits and in words', () => {
    expect(classifyQuestion('Show me our worst 5 months').limit).toBe(5);
    expect(classifyQuestion('Show me our worst three months').limit).toBe(3);
    expect(classifyQuestion('Top ten vendors').limit).toBe(10);
    expect(classifyQuestion('Who are our largest vendors?').limit).toBe(10);
  });
});

describe('period hint resolution', () => {
  const available = ['2025-08', '2026-07', '2026-08'];

  it('accepts a period that exists', () => {
    expect(resolvePeriodHint('2026-07', available)).toBe('2026-07');
  });

  it('rejects a period with no stored data instead of inventing one', () => {
    expect(resolvePeriodHint('2024-01', available)).toBeNull();
  });

  it('resolves a bare month name to the most recent matching year', () => {
    expect(resolvePeriodHint('????-08', available)).toBe('2026-08');
  });

  it('returns null when a bare month has never occurred', () => {
    expect(resolvePeriodHint('????-03', available)).toBeNull();
  });
});
