import { num, query, withTransaction } from '../pool';
import type { Period } from '../../util/dates';

export interface TransactionInput {
  qboId: string;
  txnType: string;
  txnDate: string;
  docNumber?: string | null;
  entityType?: string | null;
  entityQboId?: string | null;
  entityName?: string | null;
  memo?: string | null;
  totalAmount: number;
  locationQboId?: string | null;
  classQboId?: string | null;
  lines?: Array<{
    lineNum?: number | null;
    description?: string | null;
    amount: number;
    accountQboId?: string | null;
    accountName?: string | null;
    itemQboId?: string | null;
    classQboId?: string | null;
    locationQboId?: string | null;
    customerQboId?: string | null;
    quantity?: number | null;
    detailType?: string | null;
  }>;
}

export async function upsertTransactions(
  companyId: string,
  transactions: TransactionInput[],
): Promise<number> {
  if (transactions.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const t of transactions) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO transactions
           (company_id, qbo_id, txn_type, txn_date, doc_number, entity_type, entity_qbo_id,
            entity_name, memo, total_amount, location_qbo_id, class_qbo_id, source_fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         ON CONFLICT (company_id, txn_type, qbo_id) DO UPDATE SET
           txn_date = EXCLUDED.txn_date, doc_number = EXCLUDED.doc_number,
           entity_type = EXCLUDED.entity_type, entity_qbo_id = EXCLUDED.entity_qbo_id,
           entity_name = EXCLUDED.entity_name, memo = EXCLUDED.memo,
           total_amount = EXCLUDED.total_amount, location_qbo_id = EXCLUDED.location_qbo_id,
           class_qbo_id = EXCLUDED.class_qbo_id, source_fetched_at = now()
         RETURNING id`,
        [
          companyId, t.qboId, t.txnType, t.txnDate, t.docNumber ?? null, t.entityType ?? null,
          t.entityQboId ?? null, t.entityName ?? null, t.memo ?? null, t.totalAmount,
          t.locationQboId ?? null, t.classQboId ?? null,
        ],
      );
      const txnId = res.rows[0]?.id;
      if (!txnId || !t.lines?.length) continue;
      await client.query('DELETE FROM transaction_lines WHERE transaction_id = $1', [txnId]);
      for (const l of t.lines) {
        await client.query(
          `INSERT INTO transaction_lines
             (transaction_id, company_id, line_num, description, amount, account_qbo_id, account_name,
              item_qbo_id, class_qbo_id, location_qbo_id, customer_qbo_id, quantity, detail_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            txnId, companyId, l.lineNum ?? null, l.description ?? null, l.amount,
            l.accountQboId ?? null, l.accountName ?? null, l.itemQboId ?? null,
            l.classQboId ?? null, l.locationQboId ?? null, l.customerQboId ?? null,
            l.quantity ?? null, l.detailType ?? null,
          ],
        );
      }
    }
  });
  return transactions.length;
}

export interface TransactionRow {
  id: string;
  qboId: string;
  txnType: string;
  txnDate: string;
  docNumber: string | null;
  entityName: string | null;
  entityQboId: string | null;
  memo: string | null;
  amount: number;
  locationQboId: string | null;
  classQboId: string | null;
}

const SELECT_TXN = `SELECT id, qbo_id, txn_type, txn_date, doc_number, entity_name, entity_qbo_id,
                           memo, total_amount, location_qbo_id, class_qbo_id FROM transactions`;

function mapTxn(r: Record<string, unknown>): TransactionRow {
  return {
    id: r['id'] as string,
    qboId: r['qbo_id'] as string,
    txnType: r['txn_type'] as string,
    txnDate: (r['txn_date'] as Date).toISOString().slice(0, 10),
    docNumber: (r['doc_number'] as string | null) ?? null,
    entityName: (r['entity_name'] as string | null) ?? null,
    entityQboId: (r['entity_qbo_id'] as string | null) ?? null,
    memo: (r['memo'] as string | null) ?? null,
    amount: num(r['total_amount']),
    locationQboId: (r['location_qbo_id'] as string | null) ?? null,
    classQboId: (r['class_qbo_id'] as string | null) ?? null,
  };
}

export async function listTransactions(
  companyId: string,
  period: Period,
  limit = 2000,
): Promise<TransactionRow[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT_TXN} WHERE company_id = $1 AND txn_date >= $2 AND txn_date <= $3
      ORDER BY ABS(total_amount) DESC LIMIT $4`,
    [companyId, period.start, period.end, limit],
  );
  return rows.map(mapTxn);
}

export async function transactionsForAccount(
  companyId: string,
  accountQboIds: string[],
  period: Period,
  limit = 500,
): Promise<Array<TransactionRow & { accountName: string | null; lineAmount: number }>> {
  if (accountQboIds.length === 0) return [];
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.qbo_id, t.txn_type, t.txn_date, t.doc_number, t.entity_name, t.entity_qbo_id,
            t.memo, t.total_amount, t.location_qbo_id, t.class_qbo_id,
            l.account_name, l.amount AS line_amount
       FROM transactions t
       JOIN transaction_lines l ON l.transaction_id = t.id
      WHERE t.company_id = $1 AND t.txn_date >= $2 AND t.txn_date <= $3
        AND l.account_qbo_id = ANY($4)
      ORDER BY ABS(l.amount) DESC LIMIT $5`,
    [companyId, period.start, period.end, accountQboIds, limit],
  );
  return rows.map((r) => ({
    ...mapTxn(r),
    accountName: (r['account_name'] as string | null) ?? null,
    lineAmount: num(r['line_amount']),
  }));
}

/** Vendor spend aggregated from stored transactions (fallback when the QBO report is unavailable). */
export async function vendorSpendFromTransactions(
  companyId: string,
  period: Period,
): Promise<Array<{ vendorQboId: string | null; vendorName: string; amount: number; txnCount: number }>> {
  const rows = await query<{
    entity_qbo_id: string | null;
    entity_name: string;
    amount: string;
    txn_count: string;
  }>(
    `SELECT entity_qbo_id, COALESCE(entity_name,'(no vendor)') AS entity_name,
            SUM(total_amount)::text AS amount, COUNT(*)::text AS txn_count
       FROM transactions
      WHERE company_id = $1 AND txn_date >= $2 AND txn_date <= $3
        AND entity_type = 'Vendor'
      GROUP BY entity_qbo_id, entity_name
      ORDER BY SUM(total_amount) DESC`,
    [companyId, period.start, period.end],
  );
  return rows.map((r) => ({
    vendorQboId: r.entity_qbo_id,
    vendorName: r.entity_name,
    amount: num(r.amount),
    txnCount: Number(r.txn_count),
  }));
}

/** Historical statistics used to decide whether a transaction is unusually large. */
export async function amountStatsByType(
  companyId: string,
  beforeDate: string,
  months = 12,
): Promise<Map<string, { median: number; p90: number; count: number }>> {
  const rows = await query<{
    txn_type: string;
    median: string;
    p90: string;
    count: string;
  }>(
    `SELECT txn_type,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(total_amount))::text AS median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY ABS(total_amount))::text AS p90,
            COUNT(*)::text AS count
       FROM transactions
      WHERE company_id = $1
        AND txn_date < $2
        AND txn_date >= ($2::date - ($3 || ' months')::interval)
      GROUP BY txn_type`,
    [companyId, beforeDate, String(months)],
  );
  return new Map(
    rows.map((r) => [
      r.txn_type,
      { median: num(r.median), p90: num(r.p90), count: Number(r.count) },
    ]),
  );
}

/** Vendors whose first-ever transaction falls inside the period. */
export async function newVendorsInPeriod(
  companyId: string,
  period: Period,
): Promise<Array<{ vendorName: string; amount: number }>> {
  const rows = await query<{ entity_name: string; amount: string }>(
    `WITH first_seen AS (
       SELECT entity_name, MIN(txn_date) AS first_date
         FROM transactions
        WHERE company_id = $1 AND entity_type = 'Vendor' AND entity_name IS NOT NULL
        GROUP BY entity_name)
     SELECT f.entity_name, SUM(t.total_amount)::text AS amount
       FROM first_seen f
       JOIN transactions t ON t.entity_name = f.entity_name AND t.company_id = $1
      WHERE f.first_date >= $2 AND f.first_date <= $3
        AND t.txn_date >= $2 AND t.txn_date <= $3
      GROUP BY f.entity_name
      ORDER BY SUM(t.total_amount) DESC`,
    [companyId, period.start, period.end],
  );
  return rows.map((r) => ({ vendorName: r.entity_name, amount: num(r.amount) }));
}

/** Same vendor, same amount, within a few days -- a duplicate-payment signature. */
export async function duplicateCandidates(
  companyId: string,
  period: Period,
  minAmount = 500,
): Promise<Array<{ entityName: string | null; amount: number; dates: string[]; count: number }>> {
  const rows = await query<{
    entity_name: string | null;
    amount: string;
    dates: Date[];
    count: string;
  }>(
    `SELECT entity_name, total_amount::text AS amount,
            ARRAY_AGG(txn_date ORDER BY txn_date) AS dates, COUNT(*)::text AS count
       FROM transactions
      WHERE company_id = $1 AND txn_date >= $2 AND txn_date <= $3
        AND ABS(total_amount) >= $4
      GROUP BY entity_name, total_amount
     HAVING COUNT(*) > 1`,
    [companyId, period.start, period.end, minAmount],
  );
  return rows.map((r) => ({
    entityName: r.entity_name,
    amount: num(r.amount),
    dates: r.dates.map((d) => d.toISOString().slice(0, 10)),
    count: Number(r.count),
  }));
}

/** Transaction lines with no location/class assigned (missing dimension coverage). */
export async function missingDimensionCount(
  companyId: string,
  period: Period,
  dimension: 'location' | 'class',
): Promise<{ missing: number; total: number }> {
  const column = dimension === 'location' ? 'location_qbo_id' : 'class_qbo_id';
  const rows = await query<{ missing: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE ${column} IS NULL)::text AS missing, COUNT(*)::text AS total
       FROM transactions WHERE company_id = $1 AND txn_date >= $2 AND txn_date <= $3`,
    [companyId, period.start, period.end],
  );
  return { missing: Number(rows[0]?.missing ?? 0), total: Number(rows[0]?.total ?? 0) };
}
