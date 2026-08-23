import { dateOnly, num, numOrNull, query, queryOne, withTransaction } from '../pool';
import type { AgingSnapshot, LocationMetrics, MonthlyMetrics, VendorSpend } from '../../finance/types';
import { normalizeMethod, type AccountingMethod } from '../../finance/basis';
import type { Period } from '../../util/dates';

const METRIC_COLUMNS = [
  'gross_sales', 'discounts', 'refunds', 'net_sales', 'cogs', 'gross_profit', 'gross_margin',
  'operating_expenses', 'payroll_expense', 'advertising_expense', 'rent_expense',
  'delivery_expense', 'freight_expense', 'warehouse_expense', 'financing_fees', 'merchant_fees',
  'bank_fees', 'interest_expense', 'utilities_expense', 'insurance_expense', 'repairs_expense',
  'vehicle_expense', 'professional_fees', 'software_expense', 'taxes_expense', 'other_opex',
  'net_operating_income', 'other_income', 'other_expense', 'net_income', 'net_margin',
  'cash', 'accounts_receivable', 'accounts_payable', 'inventory_value', 'other_current_assets',
  'current_assets', 'fixed_assets', 'total_assets', 'credit_cards', 'short_term_debt',
  'long_term_debt', 'current_liabilities', 'total_liabilities', 'equity',
  'unmapped_opex_amount', 'unmapped_opex_pct', 'balance_sheet_balanced',
] as const;

interface MetricsRow {
  company_id: string;
  period_start: string;
  period_end: string;
  [key: string]: unknown;
}

function toMetrics(row: MetricsRow): MonthlyMetrics {
  const n = (k: string) => num(row[k]);
  const nn = (k: string) => numOrNull(row[k]);
  return {
    companyId: row.company_id,
    period: {
      start: dateOnly(row.period_start),
      end: dateOnly(row.period_end),
    },
    accountingMethod: normalizeMethod(row['accounting_method']),
    grossSales: n('gross_sales'),
    discounts: n('discounts'),
    refunds: n('refunds'),
    netSales: n('net_sales'),
    cogs: n('cogs'),
    grossProfit: n('gross_profit'),
    grossMargin: nn('gross_margin'),
    operatingExpenses: n('operating_expenses'),
    payrollExpense: n('payroll_expense'),
    advertisingExpense: n('advertising_expense'),
    rentExpense: n('rent_expense'),
    deliveryExpense: n('delivery_expense'),
    freightExpense: n('freight_expense'),
    warehouseExpense: n('warehouse_expense'),
    financingFees: n('financing_fees'),
    merchantFees: n('merchant_fees'),
    bankFees: n('bank_fees'),
    interestExpense: n('interest_expense'),
    utilitiesExpense: n('utilities_expense'),
    insuranceExpense: n('insurance_expense'),
    repairsExpense: n('repairs_expense'),
    vehicleExpense: n('vehicle_expense'),
    professionalFees: n('professional_fees'),
    softwareExpense: n('software_expense'),
    taxesExpense: n('taxes_expense'),
    otherOpex: n('other_opex'),
    netOperatingIncome: n('net_operating_income'),
    otherIncome: n('other_income'),
    otherExpense: n('other_expense'),
    netIncome: n('net_income'),
    netMargin: nn('net_margin'),
    cash: nn('cash'),
    accountsReceivable: nn('accounts_receivable'),
    accountsPayable: nn('accounts_payable'),
    inventoryValue: nn('inventory_value'),
    otherCurrentAssets: nn('other_current_assets'),
    currentAssets: nn('current_assets'),
    fixedAssets: nn('fixed_assets'),
    totalAssets: nn('total_assets'),
    creditCards: nn('credit_cards'),
    shortTermDebt: nn('short_term_debt'),
    longTermDebt: nn('long_term_debt'),
    currentLiabilities: nn('current_liabilities'),
    totalLiabilities: nn('total_liabilities'),
    equity: nn('equity'),
    unmappedOpexAmount: n('unmapped_opex_amount'),
    unmappedOpexPct: n('unmapped_opex_pct'),
    balanceSheetBalanced: (row['balance_sheet_balanced'] as boolean | null) ?? null,
    sourceSnapshotIds: (row['source_snapshot_ids'] as string[] | null) ?? [],
    computedAt: (row['computed_at'] as Date | undefined)?.toISOString() ?? new Date().toISOString(),
  };
}

const CAMEL: Record<string, keyof MonthlyMetrics> = {
  gross_sales: 'grossSales', discounts: 'discounts', refunds: 'refunds', net_sales: 'netSales',
  cogs: 'cogs', gross_profit: 'grossProfit', gross_margin: 'grossMargin',
  operating_expenses: 'operatingExpenses', payroll_expense: 'payrollExpense',
  advertising_expense: 'advertisingExpense', rent_expense: 'rentExpense',
  delivery_expense: 'deliveryExpense', freight_expense: 'freightExpense',
  warehouse_expense: 'warehouseExpense', financing_fees: 'financingFees',
  merchant_fees: 'merchantFees', bank_fees: 'bankFees', interest_expense: 'interestExpense',
  utilities_expense: 'utilitiesExpense', insurance_expense: 'insuranceExpense',
  repairs_expense: 'repairsExpense', vehicle_expense: 'vehicleExpense',
  professional_fees: 'professionalFees', software_expense: 'softwareExpense',
  taxes_expense: 'taxesExpense', other_opex: 'otherOpex',
  net_operating_income: 'netOperatingIncome', other_income: 'otherIncome',
  other_expense: 'otherExpense', net_income: 'netIncome', net_margin: 'netMargin',
  cash: 'cash', accounts_receivable: 'accountsReceivable', accounts_payable: 'accountsPayable',
  inventory_value: 'inventoryValue', other_current_assets: 'otherCurrentAssets',
  current_assets: 'currentAssets', fixed_assets: 'fixedAssets', total_assets: 'totalAssets',
  credit_cards: 'creditCards', short_term_debt: 'shortTermDebt', long_term_debt: 'longTermDebt',
  current_liabilities: 'currentLiabilities', total_liabilities: 'totalLiabilities', equity: 'equity',
  unmapped_opex_amount: 'unmappedOpexAmount', unmapped_opex_pct: 'unmappedOpexPct',
  balance_sheet_balanced: 'balanceSheetBalanced',
};

/**
 * Upsert on (company, period) -- the unique constraint is what prevents a
 * duplicate snapshot when a month is re-imported.
 */
export async function saveMonthlyMetrics(metrics: MonthlyMetrics): Promise<void> {
  const cols = [
    'company_id', 'period_start', 'period_end',
    ...METRIC_COLUMNS,
    'source_snapshot_ids', 'accounting_method',
  ];
  const values: unknown[] = [metrics.companyId, metrics.period.start, metrics.period.end];
  for (const col of METRIC_COLUMNS) {
    values.push(metrics[CAMEL[col] as keyof MonthlyMetrics] ?? null);
  }
  values.push(metrics.sourceSnapshotIds);
  values.push(metrics.accountingMethod);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const updates = [...METRIC_COLUMNS, 'source_snapshot_ids', 'accounting_method']
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  await query(
    `INSERT INTO monthly_metrics (${cols.join(',')}) VALUES (${placeholders})
     ON CONFLICT (company_id, period_start, period_end)
     DO UPDATE SET ${updates}, computed_at = now()`,
    values,
  );
}

export async function getMonthlyMetrics(
  companyId: string,
  period: Period,
): Promise<MonthlyMetrics | null> {
  const row = await queryOne<MetricsRow>(
    'SELECT * FROM monthly_metrics WHERE company_id = $1 AND period_start = $2 AND period_end = $3',
    [companyId, period.start, period.end],
  );
  return row ? toMetrics(row) : null;
}

export async function getMetricsRange(
  companyId: string,
  from: string,
  to: string,
): Promise<MonthlyMetrics[]> {
  const rows = await query<MetricsRow>(
    `SELECT * FROM monthly_metrics
      WHERE company_id = $1 AND period_start >= $2 AND period_start <= $3
      ORDER BY period_start`,
    [companyId, from, to],
  );
  return rows.map(toMetrics);
}

export async function listAllMetrics(companyId: string, limit = 48): Promise<MonthlyMetrics[]> {
  const rows = await query<MetricsRow>(
    'SELECT * FROM monthly_metrics WHERE company_id = $1 ORDER BY period_start DESC LIMIT $2',
    [companyId, limit],
  );
  return rows.map(toMetrics).reverse();
}

export async function latestMetricsPeriod(companyId: string): Promise<Period | null> {
  const row = await queryOne<{ period_start: string; period_end: string }>(
    'SELECT period_start, period_end FROM monthly_metrics WHERE company_id = $1 ORDER BY period_start DESC LIMIT 1',
    [companyId],
  );
  if (!row) return null;
  return {
    start: dateOnly(row.period_start),
    end: dateOnly(row.period_end),
  };
}

// --- account-level detail --------------------------------------------------

export interface AccountMetricRow {
  accountQboId: string;
  accountName: string;
  classification: string | null;
  categoryKey: string | null;
  amount: number;
}

export async function saveAccountMetrics(
  companyId: string,
  period: Period,
  rows: AccountMetricRow[],
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM monthly_account_metrics WHERE company_id = $1 AND period_start = $2',
      [companyId, period.start],
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO monthly_account_metrics
           (company_id, period_start, period_end, account_qbo_id, account_name, classification, category_key, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (company_id, period_start, account_qbo_id)
         DO UPDATE SET amount = EXCLUDED.amount, category_key = EXCLUDED.category_key,
                       account_name = EXCLUDED.account_name, computed_at = now()`,
        [
          companyId,
          period.start,
          period.end,
          r.accountQboId,
          r.accountName,
          r.classification,
          r.categoryKey,
          r.amount,
        ],
      );
    }
  });
}

export async function getAccountMetrics(
  companyId: string,
  period: Period,
): Promise<AccountMetricRow[]> {
  const rows = await query<{
    account_qbo_id: string;
    account_name: string;
    classification: string | null;
    category_key: string | null;
    amount: string;
  }>(
    `SELECT account_qbo_id, account_name, classification, category_key, amount
       FROM monthly_account_metrics WHERE company_id = $1 AND period_start = $2
      ORDER BY amount DESC`,
    [companyId, period.start],
  );
  return rows.map((r) => ({
    accountQboId: r.account_qbo_id,
    accountName: r.account_name,
    classification: r.classification,
    categoryKey: r.category_key,
    amount: num(r.amount),
  }));
}

/** Category totals across a range of months (used for trailing averages). */
export async function categoryTotalsByPeriod(
  companyId: string,
  from: string,
  to: string,
): Promise<Array<{ periodStart: string; categoryKey: string | null; amount: number }>> {
  const rows = await query<{ period_start: string; category_key: string | null; amount: string }>(
    `SELECT period_start, category_key, SUM(amount)::text AS amount
       FROM monthly_account_metrics
      WHERE company_id = $1 AND period_start >= $2 AND period_start <= $3
      GROUP BY period_start, category_key
      ORDER BY period_start`,
    [companyId, from, to],
  );
  return rows.map((r) => ({
    periodStart: dateOnly(r.period_start),
    categoryKey: r.category_key,
    amount: num(r.amount),
  }));
}

// --- location / class metrics ---------------------------------------------

export async function saveLocationMetrics(
  companyId: string,
  period: Period,
  rows: LocationMetrics[],
  accountingMethod: AccountingMethod = 'Accrual',
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM monthly_location_metrics WHERE company_id = $1 AND period_start = $2',
      [companyId, period.start],
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO monthly_location_metrics
           (company_id, period_start, period_end, dimension, dimension_qbo_id, dimension_name,
            net_sales, cogs, gross_profit, gross_margin, payroll_expense, advertising_expense,
            rent_expense, operating_expenses, contribution_profit, contribution_margin,
            overhead_allocated, accounting_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (company_id, period_start, dimension, dimension_name) DO UPDATE SET
           net_sales = EXCLUDED.net_sales, cogs = EXCLUDED.cogs, gross_profit = EXCLUDED.gross_profit,
           gross_margin = EXCLUDED.gross_margin, payroll_expense = EXCLUDED.payroll_expense,
           advertising_expense = EXCLUDED.advertising_expense, rent_expense = EXCLUDED.rent_expense,
           operating_expenses = EXCLUDED.operating_expenses,
           contribution_profit = EXCLUDED.contribution_profit,
           contribution_margin = EXCLUDED.contribution_margin, computed_at = now()`,
        [
          companyId, period.start, period.end, r.dimension, r.dimensionQboId, r.dimensionName,
          r.netSales, r.cogs, r.grossProfit, r.grossMargin, r.payrollExpense, r.advertisingExpense,
          r.rentExpense, r.operatingExpenses, r.contributionProfit, r.contributionMargin,
          r.overheadAllocated, accountingMethod,
        ],
      );
    }
  });
}

export async function getLocationMetrics(
  companyId: string,
  period: Period,
): Promise<LocationMetrics[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM monthly_location_metrics
      WHERE company_id = $1 AND period_start = $2 ORDER BY net_sales DESC`,
    [companyId, period.start],
  );
  return rows.map((r) => ({
    period,
    dimension: r['dimension'] as 'location' | 'class',
    dimensionQboId: (r['dimension_qbo_id'] as string | null) ?? null,
    dimensionName: r['dimension_name'] as string,
    netSales: num(r['net_sales']),
    cogs: num(r['cogs']),
    grossProfit: num(r['gross_profit']),
    grossMargin: numOrNull(r['gross_margin']),
    payrollExpense: num(r['payroll_expense']),
    advertisingExpense: num(r['advertising_expense']),
    rentExpense: num(r['rent_expense']),
    operatingExpenses: num(r['operating_expenses']),
    contributionProfit: num(r['contribution_profit']),
    contributionMargin: numOrNull(r['contribution_margin']),
    overheadAllocated: Boolean(r['overhead_allocated']),
  }));
}

// --- vendor spend ----------------------------------------------------------

export async function saveVendorSpend(
  companyId: string,
  period: Period,
  rows: VendorSpend[],
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM monthly_vendor_spend WHERE company_id = $1 AND period_start = $2',
      [companyId, period.start],
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO monthly_vendor_spend
           (company_id, period_start, period_end, vendor_qbo_id, vendor_name, amount, txn_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_id, period_start, vendor_name)
         DO UPDATE SET amount = EXCLUDED.amount, txn_count = EXCLUDED.txn_count, computed_at = now()`,
        [companyId, period.start, period.end, r.vendorQboId, r.vendorName, r.amount, r.txnCount],
      );
    }
  });
}

export async function getVendorSpend(companyId: string, period: Period): Promise<VendorSpend[]> {
  const rows = await query<{
    vendor_qbo_id: string | null;
    vendor_name: string;
    amount: string;
    txn_count: number;
  }>(
    `SELECT vendor_qbo_id, vendor_name, amount, txn_count FROM monthly_vendor_spend
      WHERE company_id = $1 AND period_start = $2 ORDER BY amount DESC`,
    [companyId, period.start],
  );
  return rows.map((r) => ({
    vendorQboId: r.vendor_qbo_id,
    vendorName: r.vendor_name,
    amount: num(r.amount),
    txnCount: r.txn_count,
  }));
}

export async function getVendorSpendRange(
  companyId: string,
  from: string,
  to: string,
): Promise<Array<VendorSpend & { periodStart: string }>> {
  const rows = await query<{
    period_start: string;
    vendor_qbo_id: string | null;
    vendor_name: string;
    amount: string;
    txn_count: number;
  }>(
    `SELECT period_start, vendor_qbo_id, vendor_name, amount, txn_count
       FROM monthly_vendor_spend
      WHERE company_id = $1 AND period_start >= $2 AND period_start <= $3
      ORDER BY period_start`,
    [companyId, from, to],
  );
  return rows.map((r) => ({
    periodStart: dateOnly(r.period_start),
    vendorQboId: r.vendor_qbo_id,
    vendorName: r.vendor_name,
    amount: num(r.amount),
    txnCount: r.txn_count,
  }));
}

// --- aging -----------------------------------------------------------------

export async function saveAging(companyId: string, snapshot: AgingSnapshot): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM aging_snapshots WHERE company_id = $1 AND as_of_date = $2 AND kind = $3',
      [companyId, snapshot.asOf, snapshot.kind],
    );
    const all = [{ ...snapshot.total, entityName: '__TOTAL__', entityQboId: null }, ...snapshot.entities];
    for (const b of all) {
      await client.query(
        `INSERT INTO aging_snapshots
           (company_id, as_of_date, kind, entity_name, entity_qbo_id,
            current_amount, days_1_30, days_31_60, days_61_90, days_90_plus, total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (company_id, as_of_date, kind, entity_name) DO UPDATE SET
           current_amount = EXCLUDED.current_amount, days_1_30 = EXCLUDED.days_1_30,
           days_31_60 = EXCLUDED.days_31_60, days_61_90 = EXCLUDED.days_61_90,
           days_90_plus = EXCLUDED.days_90_plus, total_amount = EXCLUDED.total_amount,
           computed_at = now()`,
        [
          companyId, snapshot.asOf, snapshot.kind, b.entityName, b.entityQboId,
          b.current, b.days1to30, b.days31to60, b.days61to90, b.days90Plus, b.total,
        ],
      );
    }
  });
}

export async function getAging(
  companyId: string,
  kind: 'receivable' | 'payable',
  asOf: string,
): Promise<AgingSnapshot | null> {
  const rows = await query<{
    entity_name: string;
    entity_qbo_id: string | null;
    current_amount: string;
    days_1_30: string;
    days_31_60: string;
    days_61_90: string;
    days_90_plus: string;
    total_amount: string;
  }>(
    `SELECT * FROM aging_snapshots WHERE company_id = $1 AND kind = $2 AND as_of_date = $3
      ORDER BY total_amount DESC`,
    [companyId, kind, asOf],
  );
  if (rows.length === 0) return null;
  const map = (r: (typeof rows)[number]) => ({
    entityName: r.entity_name,
    entityQboId: r.entity_qbo_id,
    current: num(r.current_amount),
    days1to30: num(r.days_1_30),
    days31to60: num(r.days_31_60),
    days61to90: num(r.days_61_90),
    days90Plus: num(r.days_90_plus),
    total: num(r.total_amount),
  });
  const totalRow = rows.find((r) => r.entity_name === '__TOTAL__');
  const entities = rows.filter((r) => r.entity_name !== '__TOTAL__').map(map);
  const total = totalRow
    ? map(totalRow)
    : {
        entityName: '__TOTAL__',
        entityQboId: null,
        current: entities.reduce((a, b) => a + b.current, 0),
        days1to30: entities.reduce((a, b) => a + b.days1to30, 0),
        days31to60: entities.reduce((a, b) => a + b.days31to60, 0),
        days61to90: entities.reduce((a, b) => a + b.days61to90, 0),
        days90Plus: entities.reduce((a, b) => a + b.days90Plus, 0),
        total: entities.reduce((a, b) => a + b.total, 0),
      };
  return { asOf, kind, total, entities };
}

export async function latestAgingDate(
  companyId: string,
  kind: 'receivable' | 'payable',
): Promise<string | null> {
  const row = await queryOne<{ as_of_date: string }>(
    'SELECT as_of_date FROM aging_snapshots WHERE company_id = $1 AND kind = $2 ORDER BY as_of_date DESC LIMIT 1',
    [companyId, kind],
  );
  return row ? dateOnly(row.as_of_date) : null;
}
