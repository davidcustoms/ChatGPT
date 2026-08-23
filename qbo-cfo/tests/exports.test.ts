import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { renderReportPdf } from '@/lib/reports/pdf';
import { renderReportWorkbook } from '@/lib/reports/excel';
import { DEFAULT_BRANDING } from '@/lib/db/repositories/companies';
import type { ReportPayload } from '@/lib/reports/types';
import { reportPayload } from './fixtures/report';
import { inspectPdf } from './fixtures/pdf-text';

/**
 * Export QA.
 *
 * Both exporters are run against a deliberately hostile report: a 40-character
 * vendor name, a negative net income, a zero-revenue store, a nine-figure
 * balance, twelve months of trend, and several stores. The assertions are on
 * what actually lands in the file, not on whether the render threw.
 */

const LONG_VENDOR =
  'Kensington & Brightwater Contract Furnishings International Holdings LLC';

function stressPayload(): ReportPayload {
  return reportPayload({
    companyName: 'Harborline Furniture Co.',
    vendorSpend: [
      vendor(LONG_VENDOR, 128_450_000.55, 96_000_000, 1_012_450_000.2, true),
      vendor('Zero Spend Supplier', 0, 0, 0, false),
      vendor('Refund Heavy Co.', -18_275.4, 4_100.1, -12_000, false),
    ],
    stores: [
      store(1, 'Riverside Showroom', 420_000, 0.46, 24_000, 0.057),
      store(2, 'Northgate Showroom', 0, null, -12_500, null),
      store(3, LONG_VENDOR, 118_000_000, 0.31, -3_400_000, -0.029),
    ],
    storeDimension: 'location',
    pnlRows: [
      pnl('net_sales', 'Net sales', 'money', 681_370, 640_000, 'subtotal'),
      pnl('cogs', 'Cost of goods sold', 'money', 374_549, 352_000),
      pnl('gross_profit', 'Gross profit', 'money', 306_821, 288_000, 'subtotal'),
      pnl('gross_margin', 'Gross margin', 'percent', 0.45, 0.491),
      // A prior of zero exercises the divide-by-zero guard in the formulas.
      pnl('other_income', 'Other income', 'money', 6_500, 0),
      pnl('net_income', 'Net income', 'money', 17_079, -4_200, 'total'),
    ],
    balanceSheetRows: [
      { key: 'cash', label: 'Cash', current: 557_555, previous: 657_510, changeAmount: -99_955 },
      { key: 'total_assets', label: 'Total assets', current: 2_928_174.55, previous: 2_900_000, changeAmount: 28_174.55, emphasis: 'total' },
    ],
    trends: Array.from({ length: 12 }, (_, i) => ({
      period: `2025-${String(i + 1).padStart(2, '0')}-01`,
      label: `M${i + 1}`,
      revenue: 500_000 + i * 12_000,
      grossProfit: 220_000 + i * 5_000,
      grossMargin: 0.44 + i * 0.002,
      operatingExpenses: 190_000,
      netIncome: i === 3 ? -42_000 : 30_000 + i * 1_000,
      cash: 300_000,
      accountsReceivable: 150_000,
      accountsPayable: 90_000,
      payrollPctRevenue: 0.22,
      advertisingPctRevenue: 0.06,
    })),
    expenseAnalysis: [
      expense('advertising', 'Advertising', 52_841.13, 38_245.9),
      expense('payroll', 'Payroll', 0, 0),
      expense('interest', 'Interest', -1_200.5, 900.25),
      expense('long', LONG_VENDOR, 987_654_321.99, 1.01),
    ],
    anomalies: [
      {
        ruleKey: 'margin_drop', severity: 'CRITICAL', category: 'Margin',
        title: 'Gross margin fell 4.1 pts', detail: 'From 49.1% to 45.0%.',
        metricKey: 'gross_margin', currentValue: 0.45, comparisonValue: 0.491,
        deltaAmount: -28_000, deltaPct: -0.083, score: 90, evidence: {},
      },
    ] as ReportPayload['anomalies'],
    insights: [
      {
        category: 'Margin', severity: 'CRITICAL',
        observation: 'Gross margin fell to 45.0% from 49.1%.',
        supportingMetrics: ['Gross margin: 45.0%'],
        likelyImplication: 'Discounting is outpacing cost reductions.',
        recommendedAction: 'Review the discount authority matrix by store.',
        confidence: 'high',
      },
    ],
  });
}

function pnl(
  key: string,
  label: string,
  kind: 'money' | 'percent',
  current: number,
  previous: number,
  emphasis: 'total' | 'subtotal' | 'normal' = 'normal',
): ReportPayload['pnlRows'][number] {
  return {
    key, label, kind, emphasis, current, previous,
    changeAmount: current - previous,
    changePct: previous === 0 ? null : (current - previous) / Math.abs(previous),
    lastYear: null,
    yoyPct: null,
  };
}

function vendor(
  vendorName: string,
  current: number,
  previous: number,
  yearToDate: number,
  flagged: boolean,
): ReportPayload['vendorSpend'][number] {
  return {
    vendorName,
    current,
    previous,
    changeAmount: current - previous,
    changePct: previous === 0 ? null : (current - previous) / Math.abs(previous),
    yearToDate,
    flagged,
  };
}

function store(
  rank: number,
  dimensionName: string,
  netSales: number,
  grossMargin: number | null,
  contributionProfit: number,
  contributionMargin: number | null,
): ReportPayload['stores'][number] {
  return {
    period: { start: '2026-07-01', end: '2026-07-31' },
    dimension: 'location',
    dimensionQboId: String(rank),
    dimensionName,
    rank,
    netSales,
    cogs: netSales * 0.55,
    grossProfit: netSales * 0.45,
    grossMargin,
    payrollExpense: netSales * 0.18,
    advertisingExpense: netSales * 0.04,
    rentExpense: netSales * 0.06,
    operatingExpenses: Math.abs(contributionProfit),
    contributionProfit,
    contributionMargin,
    overheadAllocated: false,
    revenueMoM: null,
    revenueYoY: null,
    payrollPct: netSales === 0 ? null : 0.18,
  };
}

function expense(
  categoryKey: string,
  label: string,
  current: number,
  previous: number,
): ReportPayload['expenseAnalysis'][number] {
  return {
    categoryKey,
    label,
    current,
    previous,
    changeAmount: current - previous,
    changePct: previous === 0 ? null : (current - previous) / Math.abs(previous),
    pctOfRevenue: 0.077,
    trailing12Average: previous,
    material: true,
  };
}

describe('PDF export', () => {
  // Rendered once: the render is the expensive part of this suite.
  let pdf: Buffer;
  let doc: ReturnType<typeof inspectPdf>;

  beforeAll(async () => {
    pdf = await renderReportPdf(stressPayload(), DEFAULT_BRANDING);
    doc = inspectPdf(pdf);
  }, 60_000);

  it('produces a structurally valid, multi-page PDF', () => {
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-8).toString()).toContain('EOF');
    expect(doc.pageCount).toBeGreaterThanOrEqual(12);
    expect(doc.pages.length).toBe(doc.pageCount);
  });

  it('has no blank page', () => {
    doc.pages.forEach((text, i) => {
      expect(text.trim().length, `page ${i + 1}`).toBeGreaterThan(40);
    });
  });

  it('labels the accounting basis on every page', () => {
    for (const [i, text] of doc.pages.entries()) {
      expect(text, `page ${i + 1}`).toContain('Accrual Basis');
    }
  });

  it('renders a long vendor name without dropping it entirely', () => {
    // Truncation for layout is acceptable; silent omission is not.
    expect(doc.text).toContain('Kensington');
  });

  it('renders negative values with a sign, never as a bare magnitude', () => {
    expect(doc.text).toMatch(/-\$18,275|\(\$18,275/);
    expect(doc.text).toMatch(/-\$3,400,000|\(\$3,400,000/);
  });

  it('renders zero and nine-figure values', () => {
    expect(doc.text).toMatch(/\$0\b/);
    expect(doc.text).toMatch(/\$128,450,00\d/);
  });

  it('renders percentages with a percent sign', () => {
    expect(doc.text).toMatch(/45\.0%/);
    // A store with no revenue has no margin: it must read as not meaningful,
    // never as 0.0% or NaN.
    expect(doc.text).not.toMatch(/NaN|Infinity/);
  });

  it('includes all twelve trend months', () => {
    for (let i = 1; i <= 12; i += 1) {
      expect(doc.text, `M${i}`).toContain(`M${i}`);
    }
  });

  it('includes every store', () => {
    expect(doc.text).toContain('Riverside Showroom');
    expect(doc.text).toContain('Northgate Showroom');
  });

  it('carries the confidence score and source attribution', () => {
    expect(doc.text).toMatch(/100\/100|Excellent/);
    expect(doc.text).toContain('QuickBooks Online');
  });

  it('states that it is not an audit', () => {
    expect(doc.text).toMatch(/not an audit/i);
  });

  it('renders a report with no optional sections at all', async () => {
    const bare = reportPayload({
      vendorSpend: [], stores: [], trends: [], expenseAnalysis: [],
      anomalies: [], insights: [], arAging: null, apAging: null,
      topOverdueReceivables: [], topPayables: [], observations: [],
    });
    const buffer = await renderReportPdf(bare, DEFAULT_BRANDING);
    const empty = inspectPdf(buffer);
    expect(empty.pageCount).toBeGreaterThanOrEqual(12);
    empty.pages.forEach((text, i) => {
      expect(text.trim().length, `page ${i + 1}`).toBeGreaterThan(20);
    });
  }, 60_000);
});

describe('Excel export', () => {
  const EXPECTED_SHEETS = [
    'Executive Summary', 'P&L', 'Balance Sheet', 'Cash', 'AR Aging', 'AP Aging',
    'Expense Analysis', 'Vendor Spend', 'Store Performance', 'Monthly Trends',
    'Raw Metrics', 'Data Quality', 'Close Checks', 'Anomalies',
  ];

  async function reopen(payload: ReportPayload): Promise<ExcelJS.Workbook> {
    const buffer = await renderReportWorkbook(payload);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const wb = new ExcelJS.Workbook();
    // Re-reading through ExcelJS is the corruption check: a malformed archive
    // or an illegal sheet name throws here.
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    return wb;
  }

  it('contains every expected sheet, with legal names', async () => {
    const wb = await reopen(stressPayload());
    const names = wb.worksheets.map((s) => s.name);
    for (const expected of EXPECTED_SHEETS) {
      expect(names, expected).toContain(expected);
    }
    for (const name of names) {
      // Excel forbids these characters and caps names at 31 characters.
      expect(name, name).not.toMatch(/[\/\\?*\[\]:]/);
      expect(name.length, name).toBeLessThanOrEqual(31);
    }
  }, 60_000);

  it('writes money as numbers, not text', async () => {
    const wb = await reopen(stressPayload());
    const vendors = wb.getWorksheet('Vendor Spend')!;
    const amount = vendors.getRow(2).getCell(2).value;
    expect(typeof amount).toBe('number');
    expect(amount).toBeCloseTo(128_450_000.55, 2);
  }, 60_000);

  it('keeps negatives negative rather than flipping the sign', async () => {
    const wb = await reopen(stressPayload());
    const vendors = wb.getWorksheet('Vendor Spend')!;
    const values: number[] = [];
    vendors.eachRow((row, n) => {
      if (n === 1) return;
      const v = row.getCell(2).value;
      if (typeof v === 'number') values.push(v);
    });
    expect(values.some((v) => v < 0)).toBe(true);
    expect(values).toContain(0);
  }, 60_000);

  it('formats percentage cells as percentages', async () => {
    const wb = await reopen(stressPayload());
    const pnl = wb.getWorksheet('P&L')!;
    let sawPercentFormat = false;
    pnl.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(5).numFmt ?? '').includes('%')) sawPercentFormat = true;
    });
    expect(sawPercentFormat).toBe(true);
  }, 60_000);

  it('writes real formulas that Excel will recalculate', async () => {
    const wb = await reopen(stressPayload());
    const pnl = wb.getWorksheet('P&L')!;
    const formulas: string[] = [];
    pnl.eachRow((row) => {
      for (const col of [4, 5, 7]) {
        const cell = row.getCell(col);
        if (cell.formula) formulas.push(cell.formula);
      }
    });
    expect(formulas.length).toBeGreaterThan(0);
    // Guarded against divide-by-zero rather than emitting #DIV/0!.
    expect(formulas.some((f) => f.includes('N/M'))).toBe(true);
    expect(formulas.every((f) => !f.includes('undefined') && !f.includes('NaN'))).toBe(true);
  }, 60_000);

  it('records the reporting basis and the data source', async () => {
    const wb = await reopen(stressPayload());
    const summary = wb.getWorksheet('Executive Summary')!;
    const text: string[] = [];
    summary.eachRow((row) => {
      row.eachCell((cell) => text.push(String(cell.value ?? '')));
    });
    const joined = text.join(' | ');
    expect(joined).toContain('Accrual Basis');
    expect(joined).toContain('QuickBooks Online');
  }, 60_000);

  it('stores the created date as a real date', async () => {
    const payload = stressPayload();
    const wb = await reopen(payload);
    expect(wb.created instanceof Date).toBe(true);
    expect(Number.isNaN(wb.created.getTime())).toBe(false);
    expect(wb.created.toISOString()).toBe(new Date(payload.generatedAt).toISOString());
  }, 60_000);

  it('survives a long name without producing an illegal sheet or cell', async () => {
    const wb = await reopen(stressPayload());
    const stores = wb.getWorksheet('Store Performance')!;
    // The sheet opens with a note row, then the header, then the stores;
    // column 1 is the rank and column 2 the name.
    const names: string[] = [];
    stores.eachRow((row) => {
      const value = row.getCell(2).value;
      if (typeof value === 'string') names.push(value);
    });
    expect(names.some((n) => n.includes('Kensington'))).toBe(true);
    // Excel's per-cell limit is 32,767 characters.
    for (const name of names) expect(name.length).toBeLessThan(32_767);
  }, 60_000);

  it('renders an empty report without corruption', async () => {
    const wb = await reopen(
      reportPayload({
        vendorSpend: [], stores: [], trends: [], expenseAnalysis: [],
        anomalies: [], insights: [], arAging: null, apAging: null,
        topOverdueReceivables: [], topPayables: [], observations: [],
      }),
    );
    const names = wb.worksheets.map((s) => s.name);
    for (const expected of EXPECTED_SHEETS) {
      expect(names, expected).toContain(expected);
    }
  }, 60_000);

  it('never writes NaN, Infinity or undefined into a cell', async () => {
    const wb = await reopen(stressPayload());
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          const value = cell.value;
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${sheet.name} R${rowNumber}C${colNumber}`).toBe(true);
          }
          if (typeof value === 'string') {
            expect(value, `${sheet.name} R${rowNumber}C${colNumber}`).not.toMatch(
              /NaN|Infinity|undefined|\[object Object\]/,
            );
          }
        });
      });
    }
  }, 60_000);
});
