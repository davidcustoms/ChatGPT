import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricsFixture } from '../fixtures/metrics';

/**
 * Calendar dates must not depend on the server's timezone.
 *
 * `pg` parses a DATE column into a JS `Date` at **local** midnight. Read back
 * with `toISOString()` anywhere east of UTC, `2026-07-01` becomes
 * `2026-06-30`: every reporting period shifts a day, and a month boundary
 * shifts the whole month. A report headed "July 2026" would carry June's
 * figures, and nothing in the UI would say so.
 *
 * The fix is at the driver boundary -- DATE columns arrive as the string
 * Postgres already formatted -- so this suite asserts the round trip is exact
 * under the timezone that used to break it.
 *
 * Run the whole file under a shifted TZ:
 *   TZ=Asia/Tokyo npx vitest run tests/integration/timezone.test.ts
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

suite('calendar dates are timezone-independent', () => {
  let pool: typeof import('@/lib/db/pool');
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { createCompany } = await import('@/lib/db/repositories/companies');
    const { saveMonthlyMetrics } = await import('@/lib/db/repositories/metrics');

    await runMigrations();
    const email = 'timezone-test@example.invalid';
    const existing = await findUserByEmail(email);
    userId = existing?.id ?? (await createUser({ email, password: 'timezone-test-password' })).id;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);

    const company = await createCompany({
      ownerUserId: userId,
      name: 'Timezone Test Co.',
      fiscalYearStartMonth: 1,
    });
    companyId = company.id;

    // January and December are the months a one-day shift moves across a year
    // boundary, so they are the ones worth storing.
    for (const key of ['2025-12', '2026-01', '2026-06', '2026-07']) {
      await saveMonthlyMetrics(
        metricsFixture(companyId, key, {
          grossSales: 400_000, netSales: 400_000, cogs: 220_000,
          grossProfit: 180_000, grossMargin: 0.45,
          operatingExpenses: 140_000, netOperatingIncome: 40_000,
          netIncome: 40_000, netMargin: 0.1, cash: 250_000,
        }),
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.getPool().end();
  });

  it('reads a DATE column back as the exact string it was written as', async () => {
    const rows = await pool.query<{ d: unknown }>("SELECT '2026-07-01'::date AS d");
    // A string, not a Date. A Date here is the bug, whatever its value today.
    expect(typeof rows[0]?.d).toBe('string');
    expect(rows[0]?.d).toBe('2026-07-01');
  });

  it('round-trips every stored period without shifting a day', async () => {
    const { listAllMetrics } = await import('@/lib/db/repositories/metrics');
    const stored = await listAllMetrics(companyId, 48);
    const periods = stored.map((m) => `${m.period.start}..${m.period.end}`).sort();

    expect(periods).toEqual([
      '2025-12-01..2025-12-31',
      '2026-01-01..2026-01-31',
      '2026-06-01..2026-06-30',
      '2026-07-01..2026-07-31',
    ]);
  });

  it('does not shift a January period back into the previous year', async () => {
    const { getMonthlyMetrics } = await import('@/lib/db/repositories/metrics');
    const { monthPeriodOf, monthLabel } = await import('@/lib/util/dates');

    const january = await getMonthlyMetrics(companyId, monthPeriodOf('2026-01-01'));
    expect(january?.period.start).toBe('2026-01-01');
    // The label an owner reads at the top of the report.
    expect(monthLabel(monthPeriodOf(january!.period.start))).toBe('January 2026');
  });

  it('reports the latest period as the month it actually is', async () => {
    const { latestMetricsPeriod } = await import('@/lib/db/repositories/metrics');
    const { monthLabel } = await import('@/lib/util/dates');

    const latest = await latestMetricsPeriod(companyId);
    expect(latest).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(monthLabel(latest!)).toBe('July 2026');
  });

  it('keeps a transaction on the first of the month in that month', async () => {
    const { upsertTransactions, listTransactions } = await import('@/lib/db/repositories/transactions');
    const { monthPeriodOf } = await import('@/lib/util/dates');

    await upsertTransactions(companyId, [
      {
        qboId: 'tz-first', txnType: 'Bill', txnDate: '2026-07-01',
        totalAmount: 1_000, entityName: 'First of Month Co.',
        lines: [{ amount: 1_000, accountQboId: '4' }],
      },
      {
        qboId: 'tz-last', txnType: 'Bill', txnDate: '2026-07-31',
        totalAmount: 2_000, entityName: 'Last of Month Co.',
        lines: [{ amount: 2_000, accountQboId: '4' }],
      },
    ]);

    const july = await listTransactions(companyId, monthPeriodOf('2026-07-01'));
    const dates = july.map((t) => t.txnDate).sort();
    expect(dates).toEqual(['2026-07-01', '2026-07-31']);

    // Neither leaked into an adjacent month.
    const june = await listTransactions(companyId, monthPeriodOf('2026-06-01'));
    const august = await listTransactions(companyId, monthPeriodOf('2026-08-01'));
    expect(june).toHaveLength(0);
    expect(august).toHaveLength(0);
  });

  it('stores and reads a snapshot period without shifting it', async () => {
    const { saveSnapshot, listSnapshotPeriods } = await import('@/lib/db/repositories/snapshots');
    const { monthPeriodOf } = await import('@/lib/util/dates');

    const period = monthPeriodOf('2026-01-01');
    await saveSnapshot({ companyId, reportType: 'TrialBalance', period, payload: { marker: 'tz' } });

    const periods = await listSnapshotPeriods(companyId, 'TrialBalance');
    expect(periods).toEqual([{ start: '2026-01-01', end: '2026-01-31' }]);
  });

  it('labels a generated report with the month it was generated for', async () => {
    const { monthPeriodOf, monthLabel } = await import('@/lib/util/dates');
    const period = monthPeriodOf('2026-01-01');

    const rows = await pool.query<{ id: string }>(
      `INSERT INTO generated_reports (company_id, period_start, period_end, title, status)
       VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
      [companyId, period.start, period.end, monthLabel(period)],
    );

    const { getReport } = await import('@/lib/db/repositories/reports');
    const report = await getReport(rows[0]!.id);
    expect(report?.period).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(monthLabel(report!.period)).toBe('January 2026');
    expect(report?.title).toBe('January 2026');
  });

  it('renders a DATE that arrives as a local-midnight Date correctly', async () => {
    const { dateOnly } = await import('@/lib/db/pool');
    // What `pg` produces without the type parser: local midnight.
    const localMidnight = new Date(2026, 6, 1, 0, 0, 0, 0);
    expect(dateOnly(localMidnight)).toBe('2026-07-01');
    // And the string form is passed through untouched.
    expect(dateOnly('2026-07-01')).toBe('2026-07-01');
  });
});
