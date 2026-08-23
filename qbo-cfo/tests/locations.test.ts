import { describe, expect, it } from 'vitest';
import { buildLocationMetrics, rankStores, CONTRIBUTION_LABEL } from '@/lib/finance/locations';
import { flattenReport } from '@/lib/qbo/parse';
import { monthPeriod } from '@/lib/util/dates';
import { MOCK_ACCOUNT_INDEX, MOCK_MAPPING, MOCK_PNL_BY_LOCATION } from './fixtures/mock-reports';

const period = monthPeriod(2026, 6);

function build(displayNames?: Map<string, string>) {
  return buildLocationMetrics({
    flat: flattenReport(MOCK_PNL_BY_LOCATION),
    accounts: MOCK_ACCOUNT_INDEX,
    mapping: MOCK_MAPPING,
    dimension: 'location',
    period,
    ...(displayNames ? { displayNames } : {}),
  });
}

describe('location metric extraction', () => {
  const rows = build();

  it('produces one row per dimension column and excludes the total column', () => {
    expect(rows.map((r) => r.dimensionName).sort()).toEqual(['Northgate', 'Riverside']);
  });

  it('reads each column as its own profit and loss', () => {
    const riverside = rows.find((r) => r.dimensionName === 'Riverside');
    expect(riverside?.netSales).toBe(282_000);
    expect(riverside?.cogs).toBe(150_000);
    expect(riverside?.grossProfit).toBe(132_000);
    expect(riverside?.grossMargin).toBeCloseTo(132_000 / 282_000, 10);
  });

  it('attributes payroll, advertising and rent through the account mapping', () => {
    const northgate = rows.find((r) => r.dimensionName === 'Northgate');
    expect(northgate?.payrollExpense).toBe(35_000);
    expect(northgate?.advertisingExpense).toBe(12_000);
    expect(northgate?.rentExpense).toBe(10_000);
  });

  it('computes contribution as gross profit less directly-attributed expenses', () => {
    const riverside = rows.find((r) => r.dimensionName === 'Riverside');
    expect(riverside?.operatingExpenses).toBe(78_000);
    expect(riverside?.contributionProfit).toBe(54_000);
    expect(riverside?.contributionMargin).toBeCloseTo(54_000 / 282_000, 10);
  });

  it('never claims corporate overhead has been allocated', () => {
    for (const row of rows) expect(row.overheadAllocated).toBe(false);
    expect(CONTRIBUTION_LABEL).toBe('Store Contribution Before Corporate Overhead');
  });

  it('carries the dimension id so a store can be renamed for reporting', () => {
    const renamed = build(new Map([['1', 'Riverside Showroom']]));
    expect(renamed.find((r) => r.dimensionQboId === '1')?.dimensionName).toBe('Riverside Showroom');
  });

  it('sorts by revenue, largest first', () => {
    expect(rows[0]?.dimensionName).toBe('Riverside');
  });

  it('drops columns with no activity rather than showing empty stores', () => {
    const empty = structuredClone(MOCK_PNL_BY_LOCATION);
    empty.Columns!.Column!.splice(2, 0, { ColTitle: 'Closed Store', ColType: 'Money', MetaData: [{ Name: 'ID', Value: '9' }] });
    for (const section of empty.Rows!.Row!) {
      for (const r of section.Rows?.Row ?? []) r.ColData?.splice(2, 0, { value: '0.00' });
      section.Summary?.ColData?.splice(2, 0, { value: '0.00' });
    }
    const rowsWithEmpty = buildLocationMetrics({
      flat: flattenReport(empty),
      accounts: MOCK_ACCOUNT_INDEX,
      mapping: MOCK_MAPPING,
      dimension: 'location',
      period,
    });
    expect(rowsWithEmpty.map((r) => r.dimensionName)).not.toContain('Closed Store');
  });
});

describe('store ranking', () => {
  const current = build();

  it('ranks by contribution margin, strongest first', () => {
    const ranked = rankStores(current, [], []);
    expect(ranked[0]?.dimensionName).toBe('Riverside');
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);
  });

  it('computes month-over-month and year-over-year growth per store', () => {
    const prior = current.map((r) => ({ ...r, netSales: r.netSales * 0.9 }));
    const lastYear = current.map((r) => ({ ...r, netSales: r.netSales * 0.8 }));
    const ranked = rankStores(current, prior, lastYear);
    expect(ranked[0]?.revenueMoM).toBeCloseTo(1 / 9, 5);
    expect(ranked[0]?.revenueYoY).toBeCloseTo(0.25, 5);
  });

  it('leaves growth null for a store with no comparable period', () => {
    const ranked = rankStores(current, [], []);
    expect(ranked[0]?.revenueMoM).toBeNull();
    expect(ranked[0]?.revenueYoY).toBeNull();
  });

  it('computes payroll as a share of each store revenue', () => {
    const ranked = rankStores(current, [], []);
    const northgate = ranked.find((r) => r.dimensionName === 'Northgate');
    expect(northgate?.payrollPct).toBeCloseTo(35_000 / 188_000, 10);
  });
});
