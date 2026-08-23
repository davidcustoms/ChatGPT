import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stubQboClient } from '../fixtures/stub-qbo';
import { monthPeriodOf } from '@/lib/util/dates';

/**
 * Duplicate import protection.
 *
 * The brief is blunt about the bar: sync the same month ten times and the
 * stored results must be unchanged. Every write in the import path is an
 * upsert keyed on natural business identity — (company, period) for metrics,
 * (company, report type, dimension, period, basis) for snapshots, (company,
 * QuickBooks id) for master data and transactions — so re-running an import is
 * a no-op rather than an accumulation.
 *
 * A retry that doubled revenue would be the single worst bug this application
 * could have, so this suite counts rows and compares full content hashes.
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

const REPEATS = 10;
const PERIOD = monthPeriodOf('2026-07-01');

suite('duplicate import protection', () => {
  let pool: typeof import('@/lib/db/pool');
  let userId: string;
  let companyId: string;

  /** Every table the import writes to, with the count that matters. */
  async function counts(): Promise<Record<string, number>> {
    const tables = [
      'report_snapshots',
      'accounts',
      'vendors',
      'customers',
      'locations',
      'classes',
      'items',
      'transactions',
      'transaction_lines',
      'monthly_metrics',
      'monthly_account_metrics',
      'monthly_location_metrics',
      'monthly_vendor_spend',
      'aging_snapshots',
      'account_mappings',
    ];
    const out: Record<string, number> = {};
    for (const table of tables) {
      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE company_id = $1`,
        [companyId],
      );
      out[table] = Number(rows[0]?.n ?? 0);
    }
    return out;
  }

  /** A content fingerprint of the derived figures, ignoring timestamps. */
  async function metricsFingerprint(): Promise<string> {
    const rows = await pool.query<{ digest: string }>(
      `SELECT md5(string_agg(t.line, '|' ORDER BY t.line)) AS digest FROM (
         SELECT period_start::text || ':' || net_sales::text || ':' || cogs::text || ':'
                || gross_profit::text || ':' || operating_expenses::text || ':'
                || net_income::text || ':' || coalesce(cash::text, '-') AS line
         FROM monthly_metrics WHERE company_id = $1
       ) t`,
      [companyId],
    );
    return rows[0]?.digest ?? '';
  }

  async function runSync(): Promise<string[]> {
    const { syncMasterData, syncMonth } = await import('@/lib/qbo/sync');
    const { client } = stubQboClient({
      transactions: {
        Bill: [
          {
            Id: '900', TxnDate: '2026-07-14', DocNumber: 'B-900',
            VendorRef: { value: '100', name: 'Ashley Furniture Industries' },
            TotalAmt: 48_250.75, PrivateNote: 'Q3 container',
            Line: [{ Amount: 48_250.75, DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: { AccountRef: { value: '4', name: 'Merchandise Cost' } } }],
          },
        ],
        Purchase: [
          {
            Id: '901', TxnDate: '2026-07-20',
            EntityRef: { value: '101', name: 'Meta Platforms' },
            TotalAmt: 12_400, PrivateNote: 'July campaigns',
            Line: [{ Amount: 12_400, DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: { AccountRef: { value: '6', name: 'Meta Ads' } } }],
          },
        ],
      },
    });
    await syncMasterData(client, companyId, 'stub-realm');
    const { warnings } = await syncMonth({
      client,
      companyId,
      realmId: 'stub-realm',
      period: PERIOD,
      dimension: 'location',
      accountingMethod: 'Accrual',
    });
    return warnings;
  }

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { createCompany } = await import('@/lib/db/repositories/companies');

    await runMigrations();
    const email = 'idempotency-test@example.invalid';
    const existing = await findUserByEmail(email);
    userId = existing?.id ?? (await createUser({ email, password: 'idempotency-test-password' })).id;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);

    const company = await createCompany({
      ownerUserId: userId,
      name: 'Idempotency Test Co.',
      fiscalYearStartMonth: 1,
    });
    companyId = company.id;
  }, 120_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.getPool().end();
  });

  it(`stores identical data after ${REPEATS} syncs of the same month`, async () => {
    const warnings = await runSync();
    expect(warnings.filter((w) => !/Cash Flows/i.test(w))).toEqual([]);

    const afterFirst = await counts();
    const fingerprintAfterFirst = await metricsFingerprint();

    // The first sync must actually have stored something, or this test proves
    // nothing at all.
    expect(afterFirst['monthly_metrics']).toBe(1);
    expect(afterFirst['report_snapshots']).toBeGreaterThan(0);
    expect(afterFirst['accounts']).toBeGreaterThan(0);
    expect(afterFirst['transactions']).toBe(2);
    expect(afterFirst['monthly_vendor_spend']).toBeGreaterThan(0);

    for (let i = 2; i <= REPEATS; i += 1) {
      await runSync();
      expect(await counts(), `after sync ${i}`).toEqual(afterFirst);
      expect(await metricsFingerprint(), `after sync ${i}`).toBe(fingerprintAfterFirst);
    }
  }, 180_000);

  it('keeps one snapshot per report type, dimension, period and basis', async () => {
    const rows = await pool.query<{ report_type: string; dimension: string; n: string }>(
      `SELECT report_type, dimension, count(*)::text AS n
         FROM report_snapshots WHERE company_id = $1
        GROUP BY report_type, dimension, period_start, period_end, accounting_method`,
      [companyId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Number(row.n), `${row.report_type}/${row.dimension}`).toBe(1);
    }
  });

  it('never accumulates duplicate transaction lines', async () => {
    const rows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM transaction_lines l
         JOIN transactions t ON t.id = l.transaction_id
        WHERE t.company_id = $1`,
      [companyId],
    );
    // Two transactions, one line each, however many times they were imported.
    expect(Number(rows[0]?.n ?? 0)).toBe(2);
  });

  it('holds the month lock so two concurrent syncs cannot interleave', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/db/repositories/locks');
    const key = `sync:${PERIOD.start}`;

    const first = await acquireLock(companyId, key);
    expect(first).not.toBeNull();

    // A second worker — a cron firing while a manual sync runs — is refused.
    const second = await acquireLock(companyId, key);
    expect(second).toBeNull();

    await releaseLock(first!);
    const third = await acquireLock(companyId, key);
    expect(third).not.toBeNull();
    await releaseLock(third!);
  });

  it('scopes the lock to the company and month, not globally', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/db/repositories/locks');
    const july = await acquireLock(companyId, `sync:${PERIOD.start}`);
    const august = await acquireLock(companyId, 'sync:2026-08-01');
    expect(july).not.toBeNull();
    // A different month for the same company is independent work.
    expect(august).not.toBeNull();
    await releaseLock(july!);
    await releaseLock(august!);
  });

  it('recomputing a month from stored snapshots changes nothing', async () => {
    const { recomputeMonth } = await import('@/lib/qbo/sync');
    const before = await metricsFingerprint();
    const beforeCounts = await counts();

    await recomputeMonth({ companyId, period: PERIOD, dimension: 'location', accountingMethod: 'Accrual' });

    expect(await metricsFingerprint()).toBe(before);
    expect(await counts()).toEqual(beforeCounts);
  }, 60_000);
});
