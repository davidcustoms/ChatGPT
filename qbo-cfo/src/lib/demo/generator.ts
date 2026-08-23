import type { QboReport, QboRow } from '../qbo/report-types';
import { addMonths, monthPeriod, parseIsoDate, type Period } from '../util/dates';
import { DEMO_ACCOUNT_BY_ID, DEMO_STORES, DEMO_VENDORS } from './chart-of-accounts';
import { createRng, jitter, roundTo } from './random';

/**
 * Synthetic financial data for demo mode.
 *
 * The generator emits QuickBooks-shaped report JSON so demo companies exercise
 * exactly the same parsing, mapping, metric and anomaly code paths as a real
 * connection. No customer or vendor here is a real business relationship of the
 * operator: all names are invented for demonstration.
 */

export interface DemoMonth {
  period: Period;
  pnl: QboReport;
  pnlByLocation: QboReport;
  balanceSheet: QboReport;
  arAging: QboReport;
  apAging: QboReport;
  transactions: Array<{
    qboId: string;
    txnType: string;
    txnDate: string;
    docNumber: string;
    entityType: string;
    entityQboId: string;
    entityName: string;
    memo: string | null;
    totalAmount: number;
    locationQboId: string | null;
    accountQboId: string;
    accountName: string;
  }>;
}

/** Seasonal index for a furniture retailer (peaks around holidays and spring). */
const SEASONALITY = [0.88, 0.86, 1.02, 1.05, 1.12, 1.04, 0.98, 1.0, 0.97, 1.03, 1.16, 1.22];

interface MonthDrivers {
  revenue: number;
  grossMarginPct: number;
  discountPct: number;
  returnPct: number;
  adSpend: number;
  payrollPct: number;
}

function drivers(index: number, monthNumber: number, rng: () => number, totalMonths: number): MonthDrivers {
  const growth = 1 + 0.011 * index; // ~14% annual growth
  const base = 620_000 * growth * (SEASONALITY[monthNumber - 1] ?? 1);
  const revenue = roundTo(jitter(rng, base, 0.06));

  // Gross margin drifts down slightly over time, with a sharper dip in the
  // final two months so the anomaly engine has something real to find.
  const late = index >= totalMonths - 2 ? 0.012 : 0;
  const grossMarginPct = roundTo(0.468 - index * 0.00035 - late + (rng() - 0.5) * 0.008, 4);

  // Advertising accelerates in the last three months faster than revenue.
  const adBase = revenue * (0.045 + index * 0.0004);
  const adSpend = roundTo(index >= totalMonths - 3 ? adBase * 1.28 : jitter(rng, adBase, 0.12));

  return {
    revenue,
    grossMarginPct,
    discountPct: roundTo(0.052 + (rng() - 0.5) * 0.012, 4),
    returnPct: roundTo(0.031 + (rng() - 0.5) * 0.01, 4),
    adSpend,
    payrollPct: roundTo(0.152 + index * 0.00025 + (rng() - 0.5) * 0.006, 4),
  };
}

/**
 * Amount for every P&L account in a month, keyed by account id.
 *
 * Ratios are chosen to resemble a mid-size multi-location furniture retailer:
 * ~45% gross margin, payroll around 15% of net sales, occupancy near 5%,
 * finishing at a high-single-digit net margin.
 */
function monthAmounts(d: MonthDrivers, rng: () => number): Map<string, number> {
  const m = new Map<string, number>();
  const gross = d.revenue;

  m.set('4000', roundTo(gross * 0.52));
  m.set('4010', roundTo(gross * 0.23));
  m.set('4020', roundTo(gross * 0.14));
  m.set('4030', roundTo(gross * 0.06));
  m.set('4040', roundTo(gross * 0.05));
  // Contra revenue is negative on a QuickBooks P&L.
  m.set('4900', roundTo(-gross * d.discountPct));
  m.set('4910', roundTo(-gross * d.returnPct));

  const netSales = gross * (1 - d.discountPct - d.returnPct);
  const cogsTotal = netSales * (1 - d.grossMarginPct);
  m.set('5000', roundTo(cogsTotal * 0.9));
  m.set('5010', roundTo(cogsTotal * 0.08));
  m.set('5020', roundTo(cogsTotal * 0.02));

  const payroll = netSales * d.payrollPct;
  m.set('6000', roundTo(payroll * 0.42));
  m.set('6005', roundTo(payroll * 0.24));
  m.set('6010', roundTo(payroll * 0.14));
  m.set('6020', roundTo(payroll * 0.1));
  m.set('6030', roundTo(payroll * 0.1));

  m.set('6100', roundTo(d.adSpend * 0.44));
  m.set('6110', roundTo(d.adSpend * 0.31));
  m.set('6120', roundTo(d.adSpend * 0.15));
  m.set('6130', roundTo(d.adSpend * 0.1));

  // Occupancy is fixed rent, not a ratio -- that is what makes a weak month hurt.
  m.set('6200', 29_800);
  m.set('6210', 3_600);
  m.set('6300', roundTo(netSales * 0.019));
  m.set('6310', roundTo(netSales * 0.007));
  m.set('6400', roundTo(jitter(rng, 7_600, 0.08)));
  m.set('6500', roundTo(netSales * jitter(rng, 0.0205, 0.06)));
  m.set('6510', roundTo(netSales * jitter(rng, 0.0135, 0.15)));
  m.set('6600', roundTo(jitter(rng, 5_900, 0.14)));
  m.set('6610', roundTo(jitter(rng, 1_450, 0.06)));
  m.set('6700', 4_250);
  m.set('6800', roundTo(jitter(rng, 2_600, 0.4)));
  m.set('6810', roundTo(jitter(rng, 1_850, 0.1)));
  m.set('6900', roundTo(jitter(rng, 3_100, 0.18)));
  m.set('6910', roundTo(jitter(rng, 1_150, 0.6)));
  m.set('7000', roundTo(jitter(rng, 1_900, 0.5)));
  m.set('7010', 1_650);
  m.set('7100', roundTo(jitter(rng, 2_950, 0.1)));
  m.set('7200', roundTo(jitter(rng, 620, 0.3)));
  m.set('7300', roundTo(jitter(rng, 780, 0.25)));
  m.set('7400', roundTo(jitter(rng, 1_100, 0.2)));
  m.set('7900', roundTo(jitter(rng, 1_400, 0.9)));

  m.set('8000', roundTo(jitter(rng, 6_500, 0.3)));
  m.set('8100', roundTo(jitter(rng, 6_400, 0.05)));
  m.set('8200', 9_200);

  return m;
}

// --- QuickBooks report construction ---------------------------------------

function dataRow(id: string, label: string, values: number[]): QboRow {
  return {
    type: 'Data',
    ColData: [{ value: label, id }, ...values.map((v) => ({ value: v.toFixed(2) }))],
  };
}

function section(
  group: string,
  header: string,
  rows: QboRow[],
  summaryLabel: string,
  summaryValues: number[],
): QboRow {
  return {
    type: 'Section',
    group,
    Header: { ColData: [{ value: header }] },
    Rows: { Row: rows },
    Summary: {
      ColData: [{ value: summaryLabel }, ...summaryValues.map((v) => ({ value: v.toFixed(2) }))],
    },
  };
}

function summaryOnly(group: string, label: string, values: number[]): QboRow {
  return {
    type: 'Section',
    group,
    Summary: { ColData: [{ value: label }, ...values.map((v) => ({ value: v.toFixed(2) }))] },
  };
}

function columnsFor(titles: string[], metaIds: Array<string | null>): QboReport['Columns'] {
  return {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      ...titles.map((t, i) => ({
        ColTitle: t,
        ColType: 'Money',
        MetaData: metaIds[i] ? [{ Name: 'ID', Value: metaIds[i] as string }] : undefined,
      })),
    ],
  };
}

const GROUPS: Record<string, string[]> = {
  Income: ['4000', '4010', '4020', '4030', '4040', '4900', '4910'],
  COGS: ['5000', '5010', '5020'],
  Expenses: [
    '6000', '6005', '6010', '6020', '6030', '6100', '6110', '6120', '6130', '6200', '6210',
    '6300', '6310', '6400', '6500', '6510', '6600', '6610', '6700', '6800', '6810', '6900',
    '6910', '7000', '7010', '7100', '7200', '7300', '7400', '7900',
  ],
  OtherIncome: ['8000'],
  OtherExpenses: ['8100', '8200'],
};

function buildPnl(
  period: Period,
  columnAmounts: Array<Map<string, number>>,
  titles: string[],
  metaIds: Array<string | null>,
): QboReport {
  const total = (ids: string[]): number[] =>
    columnAmounts.map((amounts) => roundTo(ids.reduce((a, id) => a + (amounts.get(id) ?? 0), 0)));

  const rowsFor = (ids: string[]): QboRow[] =>
    ids.map((id) =>
      dataRow(
        id,
        DEMO_ACCOUNT_BY_ID.get(id)?.name ?? id,
        columnAmounts.map((a) => roundTo(a.get(id) ?? 0)),
      ),
    );

  const income = total(GROUPS['Income'] as string[]);
  const cogs = total(GROUPS['COGS'] as string[]);
  const expenses = total(GROUPS['Expenses'] as string[]);
  const otherIncome = total(GROUPS['OtherIncome'] as string[]);
  const otherExpenses = total(GROUPS['OtherExpenses'] as string[]);
  const grossProfit = income.map((v, i) => roundTo(v - (cogs[i] ?? 0)));
  const noi = grossProfit.map((v, i) => roundTo(v - (expenses[i] ?? 0)));
  const netOther = otherIncome.map((v, i) => roundTo(v - (otherExpenses[i] ?? 0)));
  const netIncome = noi.map((v, i) => roundTo(v + (netOther[i] ?? 0)));

  return {
    Header: {
      ReportName: 'ProfitAndLoss',
      StartPeriod: period.start,
      EndPeriod: period.end,
      Currency: 'USD',
      ReportBasis: 'Accrual',
    },
    Columns: columnsFor(titles, metaIds),
    Rows: {
      Row: [
        section('Income', 'Income', rowsFor(GROUPS['Income'] as string[]), 'Total Income', income),
        section('COGS', 'Cost of Goods Sold', rowsFor(GROUPS['COGS'] as string[]), 'Total Cost of Goods Sold', cogs),
        summaryOnly('GrossProfit', 'Gross Profit', grossProfit),
        section('Expenses', 'Expenses', rowsFor(GROUPS['Expenses'] as string[]), 'Total Expenses', expenses),
        summaryOnly('NetOperatingIncome', 'Net Operating Income', noi),
        section('OtherIncome', 'Other Income', rowsFor(GROUPS['OtherIncome'] as string[]), 'Total Other Income', otherIncome),
        section('OtherExpenses', 'Other Expenses', rowsFor(GROUPS['OtherExpenses'] as string[]), 'Total Other Expenses', otherExpenses),
        summaryOnly('NetOtherIncome', 'Net Other Income', netOther),
        summaryOnly('NetIncome', 'Net Income', netIncome),
      ],
    },
  };
}

interface BalanceState {
  cash: number;
  ar: number;
  inventory: number;
  prepaid: number;
  leasehold: number;
  vehicles: number;
  ap: number;
  creditCard: number;
  deposits: number;
  lineOfCredit: number;
  equipmentLoan: number;
  ownerEquity: number;
  retainedEarnings: number;
}

function buildBalanceSheet(period: Period, s: BalanceState): QboReport {
  const rows: Array<[string, number]> = [
    ['1000', roundTo(s.cash * 0.78)],
    ['1010', roundTo(s.cash * 0.22)],
    ['1100', s.ar],
    ['1200', s.inventory],
    ['1300', s.prepaid],
    ['1500', s.leasehold],
    ['1510', s.vehicles],
    ['2000', s.ap],
    ['2100', s.creditCard],
    ['2200', s.deposits],
    ['2300', s.lineOfCredit],
    ['2500', s.equipmentLoan],
    ['3000', s.ownerEquity],
    ['3100', s.retainedEarnings],
  ];
  return {
    Header: {
      ReportName: 'BalanceSheet',
      StartPeriod: period.start,
      EndPeriod: period.end,
      Currency: 'USD',
      ReportBasis: 'Accrual',
    },
    Columns: columnsFor(['Total'], [null]),
    Rows: {
      Row: rows.map(([id, value]) =>
        dataRow(id, DEMO_ACCOUNT_BY_ID.get(id)?.name ?? id, [roundTo(value)]),
      ),
    },
  };
}

function buildAging(
  period: Period,
  kind: 'AgedReceivables' | 'AgedPayables',
  entities: Array<{ id: string; name: string; buckets: number[] }>,
): QboReport {
  const totals = [0, 0, 0, 0, 0, 0];
  for (const e of entities) {
    e.buckets.forEach((v, i) => {
      totals[i] = roundTo((totals[i] ?? 0) + v);
    });
  }
  return {
    Header: { ReportName: kind, StartPeriod: period.start, EndPeriod: period.end, Currency: 'USD' },
    Columns: columnsFor(['Current', '1 - 30', '31 - 60', '61 - 90', '91 and over', 'Total'], [null, null, null, null, null, null]),
    Rows: {
      Row: [
        ...entities.map((e) => dataRow(e.id, e.name, e.buckets)),
        summaryOnly('Total', 'TOTAL', totals),
      ],
    },
  };
}

export interface GenerateOptions {
  months: number;
  /** Last month included (defaults to the last closed month). */
  endPeriod: Period;
  seed?: number;
}

export function generateDemoData(options: GenerateOptions): DemoMonth[] {
  const rng = createRng(options.seed ?? 20260823);
  const months: DemoMonth[] = [];
  const total = options.months;

  const state: BalanceState = {
    cash: 412_000,
    ar: 186_000,
    inventory: 1_240_000,
    prepaid: 42_000,
    leasehold: 385_000,
    vehicles: 218_000,
    ap: 496_000,
    creditCard: 84_000,
    deposits: 212_000,
    lineOfCredit: 640_000,
    equipmentLoan: 154_000,
    ownerEquity: 350_000,
    retainedEarnings: 947_000,
  };

  let txnCounter = 1;

  for (let i = 0; i < total; i += 1) {
    const period = addMonths(options.endPeriod, -(total - 1 - i));
    const { year, month } = parseIsoDate(period.start);
    const d = drivers(i, month, rng, total);
    const amounts = monthAmounts(d, rng);

    // The deliberately reviewable items planted in the most recent month are
    // real expenses, so they must also appear in that month's Profit & Loss --
    // otherwise the review queue would contradict the financial statements.
    if (i === total - 1) {
      amounts.set('7900', roundTo((amounts.get('7900') ?? 0) + 12_000));
    }

    // Per-store columns: each store gets its share, with its own margin bias.
    // Each store follows its own trajectory: a slow ramp plus a store-specific
    // seasonal phase, so no two stores post identical growth rates. Shares are
    // then renormalised so the store columns still sum to the company total,
    // exactly as a real QuickBooks location report does.
    const drifts = DEMO_STORES.map(
      (store, storeIndex) => 1 + store.growthBias * i + Math.sin((i + storeIndex * 2.5) / 2.6) * 0.07,
    );
    const driftedShares = DEMO_STORES.map((store, idx) => store.share * (drifts[idx] ?? 1));
    const shareTotal = driftedShares.reduce((a, b) => a + b, 0);
    const demandShares = driftedShares.map((v) => v / shareTotal);

    const storeAmounts = DEMO_STORES.map((store, storeIndex) => {
      const scaled = new Map<string, number>();
      const demandShare = demandShares[storeIndex] ?? store.share;
      for (const [id, value] of amounts) {
        let share = demandShare;
        // Rent, payroll and advertising do not track revenue share: a
        // showroom carries fixed occupancy and staffing regardless of a slow
        // month, and the online channel carries almost none.
        if (id === '6200' || id === '6210') share = store.qboId === '4' ? 0.02 : store.share * 1.08;
        else if (id.startsWith('60')) share = demandShare * store.payrollBias;
        else if (id.startsWith('61')) share = demandShare * store.adBias;
        else if (id === '7000' || id === '7010' || id === '7100') share = demandShare;
        let amount = value * share;
        if (id.startsWith('5')) amount *= 1 - store.marginBias * 2;
        scaled.set(id, roundTo(amount));
      }
      return scaled;
    });

    const pnl = buildPnl(period, [amounts], ['Total'], [null]);
    const pnlByLocation = buildPnl(
      period,
      [...storeAmounts, amounts],
      [...DEMO_STORES.map((s) => s.name), 'Total'],
      [...DEMO_STORES.map((s) => s.qboId), null],
    );

    // Roll the balance sheet forward with plausible movements.
    const netSales = roundTo(
      (GROUPS['Income'] as string[]).reduce((a, id) => a + (amounts.get(id) ?? 0), 0),
    );
    const netIncome = roundTo(
      netSales -
        (GROUPS['COGS'] as string[]).reduce((a, id) => a + (amounts.get(id) ?? 0), 0) -
        (GROUPS['Expenses'] as string[]).reduce((a, id) => a + (amounts.get(id) ?? 0), 0) +
        (amounts.get('8000') ?? 0) -
        (amounts.get('8100') ?? 0) -
        (amounts.get('8200') ?? 0),
    );

    const distributions = i >= total - 2 ? 95_000 : jitter(rng, 38_000, 0.4);
    const inventoryBuild = i >= total - 3 ? jitter(rng, 78_000, 0.3) : jitter(rng, 12_000, 1.2);

    state.ar = roundTo(jitter(rng, netSales * 0.28, 0.08));
    state.inventory = roundTo(state.inventory + inventoryBuild);
    state.ap = roundTo(jitter(rng, netSales * 0.62, 0.09));
    state.creditCard = roundTo(jitter(rng, 88_000, 0.2));
    state.deposits = roundTo(jitter(rng, netSales * 0.3, 0.1));
    state.lineOfCredit = roundTo(state.lineOfCredit + inventoryBuild * 0.55);
    state.equipmentLoan = roundTo(Math.max(0, state.equipmentLoan - 3_800));
    state.retainedEarnings = roundTo(state.retainedEarnings + netIncome - distributions);
    state.cash = roundTo(
      state.cash + netIncome + 12_400 - inventoryBuild * 0.45 - distributions + (rng() - 0.5) * 24_000,
    );
    state.leasehold = roundTo(state.leasehold - 3_200);
    state.vehicles = roundTo(state.vehicles - 4_100);

    // Force the sheet to balance the way QuickBooks always does.
    const assets = state.cash + state.ar + state.inventory + state.prepaid + state.leasehold + state.vehicles;
    const liabilities =
      state.ap + state.creditCard + state.deposits + state.lineOfCredit + state.equipmentLoan;
    state.ownerEquity = roundTo(assets - liabilities - state.retainedEarnings);

    const balanceSheet = buildBalanceSheet(period, state);

    const arEntities = ['Harborview Apartments', 'Sunrise Senior Living', 'Copper Creek Builders', 'Lakeside Hotel Group', 'Walk-in Retail']
      .map((name, idx) => {
        const weight = [0.31, 0.24, 0.19, 0.15, 0.11][idx] ?? 0.1;
        const totalBal = state.ar * weight;
        const aged = i >= total - 2 && idx < 2 ? 0.22 : 0.06;
        const buckets = [
          roundTo(totalBal * (0.62 - aged / 2)),
          roundTo(totalBal * 0.2),
          roundTo(totalBal * 0.1),
          roundTo(totalBal * 0.05),
          roundTo(totalBal * aged),
        ];
        return { id: String(100 + idx), name, buckets: [...buckets, roundTo(buckets.reduce((a, b) => a + b, 0))] };
      });

    const apEntities = DEMO_VENDORS.slice(0, 6).map((name, idx) => {
      const weight = [0.3, 0.22, 0.17, 0.13, 0.1, 0.08][idx] ?? 0.05;
      const totalBal = state.ap * weight;
      const buckets = [
        roundTo(totalBal * 0.7),
        roundTo(totalBal * 0.18),
        roundTo(totalBal * 0.07),
        roundTo(totalBal * 0.03),
        roundTo(totalBal * 0.02),
      ];
      return { id: String(200 + idx), name, buckets: [...buckets, roundTo(buckets.reduce((a, b) => a + b, 0))] };
    });

    // Vendor-level transactions for spend analysis and the review queue.
    const transactions: DemoMonth['transactions'] = [];
    const spendAccounts: Array<[string, string[]]> = [
      ['5000', ['Ashley Furniture Industries', 'Coaster Fine Furniture', 'Sealy Mattress Co', 'Modway Imports']],
      ['5010', ['Regional Freight Lines']],
      ['6100', ['Meta Platforms']],
      ['6110', ['Google LLC']],
      ['6120', ['TikTok Ads']],
      ['6200', ['Riverside Property Group', 'Northgate Retail Partners', 'Westport Commercial Realty']],
      ['6300', ['Metro Last Mile Delivery']],
      ['6500', ['Clover Payment Systems']],
      ['6510', ['Synchrony Retail Finance']],
      ['6600', ['City Power & Light']],
      ['6700', ['Guardian Business Insurance']],
      ['6810', ['Sparkle Janitorial Services']],
      ['6900', ['Fleet Fuel Card']],
      ['7000', ['Harbor Legal Group']],
      ['7010', ['Ledgerline Bookkeeping']],
      ['7100', ['Shopify']],
      ['7200', ['Northstar Bank']],
      ['6400', ['Summit Storage Solutions']],
    ];

    for (const [accountId, vendorNames] of spendAccounts) {
      const monthTotal = amounts.get(accountId) ?? 0;
      if (monthTotal <= 0) continue;
      const per = monthTotal / vendorNames.length;
      vendorNames.forEach((vendorName, vIdx) => {
        const splits = accountId === '5000' ? 3 : 1;
        // Uneven splits: identical amounts would trip the duplicate detector
        // with an artefact of the generator rather than a real finding.
        const weights = splits === 3 ? [0.45, 0.33, 0.22] : [1];
        for (let s = 0; s < splits; s += 1) {
          const day = Math.min(28, 3 + ((vIdx * 7 + s * 9 + i * 3) % 25));
          transactions.push({
            qboId: `demo-${txnCounter++}`,
            txnType: accountId.startsWith('5') ? 'Bill' : 'Purchase',
            txnDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            docNumber: `D-${1000 + txnCounter}`,
            entityType: 'Vendor',
            entityQboId: String(DEMO_VENDORS.indexOf(vendorName) + 1),
            entityName: vendorName,
            memo: null,
            totalAmount: roundTo(per * (weights[s] ?? 1 / splits)),
            locationQboId: DEMO_STORES[(vIdx + s) % DEMO_STORES.length]?.qboId ?? null,
            accountQboId: accountId,
            accountName: DEMO_ACCOUNT_BY_ID.get(accountId)?.name ?? accountId,
          });
        }
      });
    }

    // A handful of deliberately reviewable items in the most recent month.
    if (i === total - 1) {
      transactions.push({
        qboId: `demo-${txnCounter++}`,
        txnType: 'Purchase',
        txnDate: `${year}-${String(month).padStart(2, '0')}-14`,
        docNumber: 'D-DUP-1',
        entityType: 'Vendor',
        entityQboId: '99',
        entityName: 'BrightSign Digital Displays',
        memo: 'Showroom display refresh',
        totalAmount: 6_000,
        locationQboId: '1',
        accountQboId: '7900',
        accountName: 'Uncategorized Expense',
      });
      transactions.push({
        qboId: `demo-${txnCounter++}`,
        txnType: 'Purchase',
        txnDate: `${year}-${String(month).padStart(2, '0')}-16`,
        docNumber: 'D-DUP-2',
        entityType: 'Vendor',
        entityQboId: '99',
        entityName: 'BrightSign Digital Displays',
        memo: 'Showroom display refresh',
        totalAmount: 6_000,
        locationQboId: '1',
        accountQboId: '7900',
        accountName: 'Uncategorized Expense',
      });
      transactions.push({
        qboId: `demo-${txnCounter++}`,
        txnType: 'Purchase',
        txnDate: `${year}-${String(month).padStart(2, '0')}-28`,
        docNumber: 'D-OWNER',
        entityType: 'Vendor',
        entityQboId: '98',
        entityName: 'Owner Distribution',
        memo: 'Quarterly owner distribution',
        totalAmount: 95_000,
        locationQboId: null,
        accountQboId: '3200',
        accountName: 'Owner Distributions',
      });
    }

    months.push({
      period,
      pnl,
      pnlByLocation,
      balanceSheet,
      arAging: buildAging(period, 'AgedReceivables', arEntities),
      apAging: buildAging(period, 'AgedPayables', apEntities),
      transactions,
    });
  }

  return months;
}

export { monthPeriod };
