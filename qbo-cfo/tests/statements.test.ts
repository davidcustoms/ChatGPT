import { describe, expect, it } from 'vitest';
import { flattenReport, isEmptyReport, parseAmount, summaryByGroup } from '@/lib/qbo/parse';
import { parseAgingSummary, parseBalanceSheet, parseProfitAndLoss } from '@/lib/qbo/statements';
import {
  MOCK_ACCOUNT_INDEX,
  MOCK_AP_AGING,
  MOCK_AR_AGING,
  MOCK_BALANCE_SHEET,
  MOCK_PNL,
} from './fixtures/mock-reports';

describe('amount parsing', () => {
  it('reads plain, negative and parenthesised amounts', () => {
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('-1234.56')).toBe(-1234.56);
    expect(parseAmount('(1234.56)')).toBe(-1234.56);
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('returns null for blanks rather than zero', () => {
    // A blank cell means "no value", which is different from a real zero.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });
});

describe('report flattening', () => {
  const flat = flattenReport(MOCK_PNL);

  it('extracts leaf rows with their QuickBooks account ids', () => {
    const sales = flat.rows.find((r) => r.id === '1');
    expect(sales?.label).toBe('Furniture Sales');
    expect(sales?.values[0]).toBe(500_000);
  });

  it('captures section subtotals by group', () => {
    expect(summaryByGroup(flat, 'Income')).toBe(470_000);
    expect(summaryByGroup(flat, 'GrossProfit')).toBe(211_500);
    expect(summaryByGroup(flat, 'NetIncome')).toBe(60_000);
  });

  it('recognises an empty report', () => {
    expect(isEmptyReport(flat)).toBe(false);
    expect(isEmptyReport(flattenReport({ Rows: { Row: [] } }))).toBe(true);
  });
});

describe('profit and loss parsing', () => {
  const pnl = parseProfitAndLoss(flattenReport(MOCK_PNL), MOCK_ACCOUNT_INDEX);

  it('uses QuickBooks own subtotals', () => {
    expect(pnl.totalIncome).toBe(470_000);
    expect(pnl.totalCogs).toBe(258_500);
    expect(pnl.grossProfit).toBe(211_500);
    expect(pnl.totalExpenses).toBe(150_000);
    expect(pnl.netIncome).toBe(60_000);
  });

  it('classifies each line by account type, not by label', () => {
    const byId = new Map(pnl.lines.map((l) => [l.accountQboId, l]));
    expect(byId.get('1')?.section).toBe('income');
    expect(byId.get('4')?.section).toBe('cogs');
    expect(byId.get('5')?.section).toBe('expense');
    expect(byId.get('9')?.section).toBe('other_expense');
    expect(byId.get('10')?.section).toBe('other_income');
  });

  it('keeps contra revenue negative as QuickBooks reports it', () => {
    const discounts = pnl.lines.find((l) => l.accountQboId === '2');
    expect(discounts?.amount).toBe(-20_000);
  });
});

describe('balance sheet parsing', () => {
  const bs = parseBalanceSheet(flattenReport(MOCK_BALANCE_SHEET), MOCK_ACCOUNT_INDEX);

  it('groups by QuickBooks account type', () => {
    expect(bs.cash).toBe(150_000);
    expect(bs.accountsReceivable).toBe(120_000);
    expect(bs.inventory).toBe(480_000);
    expect(bs.otherCurrentAssets).toBe(50_000);
    expect(bs.currentAssets).toBe(800_000);
    expect(bs.fixedAssets).toBe(200_000);
    expect(bs.totalAssets).toBe(1_000_000);
  });

  it('separates current from long-term liabilities', () => {
    expect(bs.accountsPayable).toBe(250_000);
    expect(bs.creditCards).toBe(50_000);
    expect(bs.currentLiabilities).toBe(500_000);
    expect(bs.longTermDebt).toBe(100_000);
    expect(bs.totalLiabilities).toBe(600_000);
    expect(bs.equity).toBe(400_000);
  });

  it('identifies short-term debt by sub-type', () => {
    expect(bs.shortTermDebt).toBe(200_000);
  });

  it('verifies that the sheet balances', () => {
    expect(bs.balanced).toBe(true);
  });

  it('reports an unbalanced sheet rather than hiding it', () => {
    const broken = structuredClone(MOCK_BALANCE_SHEET);
    // Drop the equity row: assets no longer equal liabilities plus equity.
    broken.Rows!.Row = broken.Rows!.Row!.filter((r) => r.ColData?.[0]?.id !== '40');
    const parsed = parseBalanceSheet(flattenReport(broken), MOCK_ACCOUNT_INDEX);
    expect(parsed.balanced).toBe(false);
  });

  it('returns nulls when nothing could be classified', () => {
    const parsed = parseBalanceSheet(flattenReport(MOCK_BALANCE_SHEET), new Map());
    expect(parsed.totalAssets).toBeNull();
    expect(parsed.balanced).toBeNull();
    expect(parsed.unclassified.length).toBeGreaterThan(0);
  });
});

describe('aging parsing', () => {
  it('maps receivable buckets by column title', () => {
    const ar = parseAgingSummary(flattenReport(MOCK_AR_AGING));
    expect(ar.total.current).toBe(75_000);
    expect(ar.total.days1to30).toBe(20_000);
    expect(ar.total.days31to60).toBe(10_000);
    expect(ar.total.days61to90).toBe(3_500);
    expect(ar.total.days90Plus).toBe(11_500);
    expect(ar.total.total).toBe(120_000);
    expect(ar.buckets).toHaveLength(3);
  });

  it('buckets sum to the reported total', () => {
    const ar = parseAgingSummary(flattenReport(MOCK_AR_AGING));
    const sum =
      ar.total.current + ar.total.days1to30 + ar.total.days31to60 + ar.total.days61to90 + ar.total.days90Plus;
    expect(sum).toBe(ar.total.total);
  });

  it('parses payables with the same shape', () => {
    const ap = parseAgingSummary(flattenReport(MOCK_AP_AGING));
    expect(ap.total.total).toBe(180_000);
    expect(ap.total.days90Plus).toBe(5_000);
    expect(ap.buckets[0]?.entityName).toBe('Ashley Furniture Industries');
  });

  it('falls back to positional columns when titles are missing', () => {
    const untitled = structuredClone(MOCK_AR_AGING);
    untitled.Columns!.Column = untitled.Columns!.Column!.map((c) => ({ ...c, ColTitle: '' }));
    const ar = parseAgingSummary(flattenReport(untitled));
    expect(ar.total.total).toBe(120_000);
  });
});
