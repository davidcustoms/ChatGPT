import { query, queryOne } from '../pool';
import type { Period } from '../../util/dates';

export type ReportType =
  | 'ProfitAndLoss'
  | 'BalanceSheet'
  | 'CashFlow'
  | 'TrialBalance'
  | 'GeneralLedger'
  | 'TransactionList'
  | 'AgedReceivables'
  | 'AgedReceivableDetail'
  | 'AgedPayables'
  | 'AgedPayableDetail'
  | 'CustomerBalance'
  | 'VendorBalance'
  | 'CustomerSales'
  | 'ItemSales'
  | 'VendorExpenses'
  | 'InventoryValuationSummary'
  | 'ProfitAndLossDetail';

export type SnapshotDimension = 'total' | 'location' | 'class' | 'customer' | 'vendor' | 'item';

export interface SnapshotInput {
  companyId: string;
  reportType: ReportType | string;
  period: Period;
  dimension?: SnapshotDimension;
  accountingMethod?: 'Accrual' | 'Cash';
  payload: unknown;
  sourceRealmId?: string | null;
  syncJobId?: string | null;
}

/**
 * Stores the raw QuickBooks response verbatim. Snapshots are the audit trail:
 * every derived metric can be re-computed from them without re-querying Intuit.
 */
export async function saveSnapshot(input: SnapshotInput): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO report_snapshots
       (company_id, report_type, period_start, period_end, dimension, accounting_method,
        payload, source_realm_id, sync_job_id, source_fetched_at)
     VALUES ($1,$2,$3,$4,COALESCE($5,'total'),COALESCE($6,'Accrual'),$7,$8,$9, now())
     ON CONFLICT (company_id, report_type, period_start, period_end, dimension, accounting_method)
     DO UPDATE SET payload = EXCLUDED.payload,
                   source_fetched_at = now(),
                   sync_job_id = EXCLUDED.sync_job_id
     RETURNING id`,
    [
      input.companyId,
      input.reportType,
      input.period.start,
      input.period.end,
      input.dimension ?? null,
      input.accountingMethod ?? null,
      JSON.stringify(input.payload),
      input.sourceRealmId ?? null,
      input.syncJobId ?? null,
    ],
  );
  return row?.id as string;
}

export interface SnapshotRow<T = unknown> {
  id: string;
  reportType: string;
  period: Period;
  dimension: SnapshotDimension;
  payload: T;
  fetchedAt: string;
}

export async function getSnapshot<T = unknown>(
  companyId: string,
  reportType: ReportType | string,
  period: Period,
  dimension: SnapshotDimension = 'total',
): Promise<SnapshotRow<T> | null> {
  const row = await queryOne<{
    id: string;
    report_type: string;
    period_start: Date;
    period_end: Date;
    dimension: SnapshotDimension;
    payload: T;
    source_fetched_at: Date;
  }>(
    `SELECT id, report_type, period_start, period_end, dimension, payload, source_fetched_at
       FROM report_snapshots
      WHERE company_id = $1 AND report_type = $2 AND period_start = $3 AND period_end = $4 AND dimension = $5
      LIMIT 1`,
    [companyId, reportType, period.start, period.end, dimension],
  );
  if (!row) return null;
  return {
    id: row.id,
    reportType: row.report_type,
    period: { start: period.start, end: period.end },
    dimension: row.dimension,
    payload: row.payload,
    fetchedAt: row.source_fetched_at.toISOString(),
  };
}

export async function listSnapshotPeriods(
  companyId: string,
  reportType: ReportType | string,
): Promise<Period[]> {
  const rows = await query<{ period_start: Date; period_end: Date }>(
    `SELECT period_start, period_end FROM report_snapshots
      WHERE company_id = $1 AND report_type = $2 AND dimension = 'total'
      ORDER BY period_start`,
    [companyId, reportType],
  );
  return rows.map((r) => ({
    start: r.period_start.toISOString().slice(0, 10),
    end: r.period_end.toISOString().slice(0, 10),
  }));
}

/** Data-retention pruning: drop snapshots older than N months. */
export async function pruneSnapshots(companyId: string, retentionMonths: number): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM report_snapshots
        WHERE company_id = $1
          AND period_end < (date_trunc('month', now()) - ($2 || ' months')::interval)::date
       RETURNING 1)
     SELECT COUNT(*)::text AS count FROM deleted`,
    [companyId, String(retentionMonths)],
  );
  return Number(rows[0]?.count ?? 0);
}
