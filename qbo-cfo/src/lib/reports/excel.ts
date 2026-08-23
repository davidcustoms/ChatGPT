import ExcelJS from 'exceljs';
import { AppError } from '../errors';
import type { ReportPayload } from './types';

/**
 * XLSX export.
 *
 * Where a figure is a subtotal or a ratio, a real Excel formula is written
 * instead of a literal, so the workbook recalculates if the owner edits an
 * input cell. Source values always come from the stored metrics.
 */

const NAVY = 'FF1E3A5F';
const HEADER_FILL = 'FFEEF2F7';
const MONEY = '#,##0.00;[Red](#,##0.00)';
const PERCENT = '0.0%';

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: NAVY }, size: 10 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  row.alignment = { vertical: 'middle' };
}

function addTable(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  numberFormats: Record<number, string> = {},
): void {
  const headerRow = sheet.addRow(headers);
  styleHeader(headerRow);
  for (const r of rows) {
    const row = sheet.addRow(r.map((v) => (v === null ? '' : v)));
    for (const [index, format] of Object.entries(numberFormats)) {
      const cell = row.getCell(Number(index));
      cell.numFmt = format;
    }
  }
  sheet.columns.forEach((col, i) => {
    const header = headers[i] ?? '';
    let width = Math.max(12, header.length + 2);
    if (i === 0) width = Math.max(width, 28);
    col.width = width;
  });
}

export async function renderReportWorkbook(payload: ReportPayload): Promise<Buffer> {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QuickBooks CFO Reporting Agent';
    wb.created = new Date(payload.generatedAt);

    // --- Executive Summary --------------------------------------------------
    const summary = wb.addWorksheet('Executive Summary');
    summary.addRow([payload.companyName]).font = { bold: true, size: 16, color: { argb: NAVY } };
    summary.addRow([`${payload.periodLabel} Executive Financial Report`]).font = { size: 12 };
    summary.addRow([`Data through ${payload.dataThrough} · Source: ${payload.sourceSystem}`]);
    summary.addRow([`Report confidence: ${payload.dataQuality.confidence.toUpperCase()}`]);
    summary.addRow([]);
    addTable(
      summary,
      ['Metric', 'Value', 'Change vs prior month', 'Change %', 'YoY %'],
      payload.headline.map((h) => [
        h.label,
        h.value,
        h.changeAmount,
        h.format === 'percent' ? h.changePoints : h.changePct,
        h.yoyPct,
      ]),
      { 2: MONEY, 3: MONEY, 4: PERCENT, 5: PERCENT },
    );
    summary.addRow([]);
    summary.addRow(['Observations']).font = { bold: true, color: { argb: NAVY } };
    for (const o of payload.observations) summary.addRow([o]);
    if (payload.executiveSummary) {
      summary.addRow([]);
      summary.addRow(['Executive summary']).font = { bold: true, color: { argb: NAVY } };
      summary.addRow([payload.executiveSummary]);
    }

    // --- P&L ----------------------------------------------------------------
    const pnl = wb.addWorksheet('P&L');
    const pnlHeaders = ['Line', 'Current', 'Prior Month', 'Change $', 'Change %', 'Same Month Last Year', 'YoY %'];
    styleHeader(pnl.addRow(pnlHeaders));
    payload.pnlRows.forEach((r) => {
      const row = pnl.addRow([
        r.label,
        r.current,
        r.previous,
        null, // formula below
        null,
        r.lastYear,
        null,
      ]);
      const n = row.number;
      // Formulas keep the workbook live if an owner edits current/prior values.
      row.getCell(4).value = { formula: `IF(ISNUMBER(C${n}),B${n}-C${n},"")` };
      row.getCell(5).value = { formula: `IF(AND(ISNUMBER(C${n}),C${n}<>0),(B${n}-C${n})/ABS(C${n}),"N/M")` };
      row.getCell(7).value = { formula: `IF(AND(ISNUMBER(F${n}),F${n}<>0),(B${n}-F${n})/ABS(F${n}),"N/M")` };
      const fmt = r.kind === 'percent' ? PERCENT : MONEY;
      [2, 3, 4, 6].forEach((c) => {
        row.getCell(c).numFmt = fmt;
      });
      row.getCell(5).numFmt = PERCENT;
      row.getCell(7).numFmt = PERCENT;
      if (r.emphasis === 'total' || r.emphasis === 'subtotal') row.font = { bold: true };
    });
    pnl.columns.forEach((c, i) => {
      c.width = i === 0 ? 30 : 18;
    });

    // --- Balance Sheet ------------------------------------------------------
    const bs = wb.addWorksheet('Balance Sheet');
    addTable(
      bs,
      ['Line', `As of ${payload.period.end}`, 'Prior Month', 'Change'],
      payload.balanceSheetRows.map((r) => [r.label, r.current, r.previous, r.changeAmount]),
      { 2: MONEY, 3: MONEY, 4: MONEY },
    );

    // --- Cash ---------------------------------------------------------------
    const cash = wb.addWorksheet('Cash');
    addTable(
      cash,
      ['Item', 'Amount'],
      [
        ['Beginning cash', payload.cashPosition.beginningCash],
        ['Ending cash', payload.cashPosition.endingCash],
        ['Increase / (decrease)', payload.cashPosition.netChange],
        ['Operating cash flow', payload.cashPosition.operating],
        ['Investing cash flow', payload.cashPosition.investing],
        ['Financing cash flow', payload.cashPosition.financing],
      ],
      { 2: MONEY },
    );
    cash.addRow([]);
    cash.addRow([payload.cashPosition.note]);

    // --- Aging --------------------------------------------------------------
    // Excel forbids / \ ? * [ ] : in worksheet names, so "A/R" becomes "AR".
    for (const [name, aging] of [
      ['AR Aging', payload.arAging],
      ['AP Aging', payload.apAging],
    ] as const) {
      const sheet = wb.addWorksheet(name);
      if (!aging) {
        sheet.addRow([`No ${name} data captured for ${payload.periodLabel}.`]);
        continue;
      }
      addTable(
        sheet,
        ['Name', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'],
        [
          ['TOTAL', aging.total.current, aging.total.days1to30, aging.total.days31to60, aging.total.days61to90, aging.total.days90Plus, aging.total.total],
          ...aging.entities.map((e) => [
            e.entityName, e.current, e.days1to30, e.days31to60, e.days61to90, e.days90Plus, e.total,
          ]),
        ],
        { 2: MONEY, 3: MONEY, 4: MONEY, 5: MONEY, 6: MONEY, 7: MONEY },
      );
    }

    // --- Expense analysis ---------------------------------------------------
    const expenses = wb.addWorksheet('Expense Analysis');
    const expenseHeaders = ['Category', 'Current', 'Prior', 'Change $', 'Change %', '% of Revenue', 'T12 Average', 'Material'];
    styleHeader(expenses.addRow(expenseHeaders));
    payload.expenseAnalysis.forEach((r) => {
      const row = expenses.addRow([r.label, r.current, r.previous, null, null, null, r.trailing12Average, r.material ? 'Yes' : '']);
      const n = row.number;
      row.getCell(4).value = { formula: `IF(ISNUMBER(C${n}),B${n}-C${n},"")` };
      row.getCell(5).value = { formula: `IF(AND(ISNUMBER(C${n}),C${n}<>0),(B${n}-C${n})/ABS(C${n}),"N/M")` };
      row.getCell(6).value = payload.metrics.netSales
        ? { formula: `B${n}/${payload.metrics.netSales}` }
        : 'N/M';
      [2, 3, 4, 7].forEach((c) => {
        row.getCell(c).numFmt = MONEY;
      });
      row.getCell(5).numFmt = PERCENT;
      row.getCell(6).numFmt = PERCENT;
    });
    expenses.columns.forEach((c, i) => {
      c.width = i === 0 ? 30 : 16;
    });

    // --- Vendor spend -------------------------------------------------------
    const vendors = wb.addWorksheet('Vendor Spend');
    addTable(
      vendors,
      ['Vendor', 'Current Month', 'Prior Month', 'Change $', 'Change %', 'Year to Date', 'Flagged'],
      payload.vendorSpend.map((v) => [
        v.vendorName, v.current, v.previous, v.changeAmount, v.changePct, v.yearToDate, v.flagged ? 'Yes' : '',
      ]),
      { 2: MONEY, 3: MONEY, 4: MONEY, 5: PERCENT, 6: MONEY },
    );

    // --- Store performance --------------------------------------------------
    const stores = wb.addWorksheet('Store Performance');
    stores.addRow([payload.storeNote]).font = { italic: true };
    stores.addRow([]);
    addTable(
      stores,
      ['Rank', 'Store', 'Revenue', 'MoM %', 'YoY %', 'Gross Profit', 'Gross Margin', 'Payroll', 'Payroll %', 'Operating Expenses', payload.storeContributionLabel, 'Contribution %'],
      payload.stores.map((s) => [
        s.rank, s.dimensionName, s.netSales, s.revenueMoM, s.revenueYoY, s.grossProfit, s.grossMargin,
        s.payrollExpense, s.payrollPct, s.operatingExpenses, s.contributionProfit, s.contributionMargin,
      ]),
      { 3: MONEY, 4: PERCENT, 5: PERCENT, 6: MONEY, 7: PERCENT, 8: MONEY, 9: PERCENT, 10: MONEY, 11: MONEY, 12: PERCENT },
    );

    // --- Monthly trends -----------------------------------------------------
    const trends = wb.addWorksheet('Monthly Trends');
    addTable(
      trends,
      ['Month', 'Revenue', 'Gross Profit', 'Gross Margin', 'Operating Expenses', 'Net Income', 'Cash', 'A/R', 'A/P', 'Payroll % Rev', 'Advertising % Rev'],
      payload.trends.map((t) => [
        t.label, t.revenue, t.grossProfit, t.grossMargin, t.operatingExpenses, t.netIncome, t.cash,
        t.accountsReceivable, t.accountsPayable, t.payrollPctRevenue, t.advertisingPctRevenue,
      ]),
      { 2: MONEY, 3: MONEY, 4: PERCENT, 5: MONEY, 6: MONEY, 7: MONEY, 8: MONEY, 9: MONEY, 10: PERCENT, 11: PERCENT },
    );

    // --- Raw metrics --------------------------------------------------------
    const raw = wb.addWorksheet('Raw Metrics');
    const metricEntries = Object.entries(payload.metrics).filter(
      ([, v]) => typeof v === 'number' || v === null,
    );
    addTable(
      raw,
      ['Metric', 'Value'],
      metricEntries.map(([k, v]) => [k, v as number | null]),
      { 2: MONEY },
    );
    raw.addRow([]);
    raw.addRow(['KPI', 'Value']).font = { bold: true };
    for (const [k, v] of Object.entries(payload.kpis)) {
      raw.addRow([k, v as number | null]);
    }

    // --- Anomalies ----------------------------------------------------------
    const anomalies = wb.addWorksheet('Anomalies');
    addTable(
      anomalies,
      ['Severity', 'Category', 'Title', 'Detail', 'Current', 'Comparison', 'Change $', 'Change %'],
      payload.anomalies.map((a) => [
        a.severity, a.category, a.title, a.detail, a.currentValue, a.comparisonValue, a.deltaAmount, a.deltaPct,
      ]),
      { 5: MONEY, 6: MONEY, 7: MONEY, 8: PERCENT },
    );
    anomalies.getColumn(4).width = 70;

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    throw new AppError('EXCEL_ERROR', 'The Excel workbook could not be generated.', {
      cause: err,
      retryable: true,
    });
  }
}
