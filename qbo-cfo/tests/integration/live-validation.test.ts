import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthPeriodOf, type Period } from '@/lib/util/dates';

/**
 * The live-validation engine, exercised against stored data.
 *
 * Seven of the nine validators read only this application's database, so they
 * can be run for real here. The two that need a live Intuit connection --
 * the connection checklist and the read-only proof -- are covered by
 * `tests/qbo-client.test.ts` and by the run's own precondition gate, which is
 * asserted below to refuse rather than pretend.
 *
 * The point of this suite is that when someone finally does connect a
 * production company, the engine has already been proved to work; only the
 * live calls are new.
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

suite('live validation engine', () => {
  let pool: typeof import('@/lib/db/pool');
  let userId: string;
  let companyId: string;
  let period: Period;
  let reportId: string;

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { seedDemoCompany } = await import('@/lib/demo/seed');
    const { latestMetricsPeriod } = await import('@/lib/db/repositories/metrics');
    const { generateMonthlyReport } = await import('@/lib/reports/generate');

    await runMigrations();
    const email = 'validation-engine-test@example.invalid';
    const existing = await findUserByEmail(email);
    userId = existing?.id ?? (await createUser({ email, password: 'validation-engine-password' })).id;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);

    const seeded = await seedDemoCompany({ userId, months: 14 });
    companyId = seeded.companyId;
    period = (await latestMetricsPeriod(companyId))!;

    const generated = await generateMonthlyReport({ companyId, period, requestedBy: userId });
    reportId = generated.reportId;
  }, 300_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.getPool().end();
  });

  /** No check may be left in a state the UI cannot render. */
  function assertWellFormed(section: { checks: Array<{ key: string; status: string; detail: string; remedy?: string }> }) {
    expect(section.checks.length).toBeGreaterThan(0);
    for (const check of section.checks) {
      expect(['PASS', 'FAIL', 'NOT_AVAILABLE', 'NEEDS_REVIEW']).toContain(check.status);
      expect(check.detail.length, check.key).toBeGreaterThan(10);
      // A failure the owner cannot act on is not a useful failure.
      if (check.status === 'FAIL' || check.status === 'NEEDS_REVIEW') {
        expect(check.remedy, `${check.key} must say what to do`).toBeTruthy();
      }
    }
  }

  describe('preconditions refuse rather than pretend', () => {
    it('refuses a demo company', async () => {
      const { runLiveValidation } = await import('@/lib/validation/run');
      const run = await runLiveValidation({ companyId, userId });

      expect(run.productionReady).toBe(false);
      expect(run.fatal).toMatch(/cannot be automated|Production OAuth/i);
      // The demo company is caught by name, not by accident.
      const demo = run.sections[0]?.checks.find((c) => c.key === 'not_demo');
      expect(demo?.status).toBe('FAIL');
    }, 60_000);

    it('reports every gate criterion as blocked, not silently passing', async () => {
      const { runLiveValidation } = await import('@/lib/validation/run');
      const { GATE_CRITERIA } = await import('@/lib/validation/types');
      const run = await runLiveValidation({ companyId, userId });

      expect(run.gate).toHaveLength(GATE_CRITERIA.length);
      expect(run.gate.every((g) => g.status !== 'PASS' || g.blocker === null)).toBe(true);
      // Nothing may pass when QuickBooks was never contacted.
      expect(run.gate.filter((g) => g.status === 'PASS')).toHaveLength(0);
      expect(run.blockers.length).toBe(GATE_CRITERIA.length);
      for (const blocker of run.blockers) expect(blocker.length).toBeGreaterThan(10);
    }, 60_000);

    it('refuses the sandbox environment', async () => {
      const original = process.env['INTUIT_ENVIRONMENT'];
      process.env['INTUIT_ENVIRONMENT'] = 'sandbox';
      try {
        const { runLiveValidation } = await import('@/lib/validation/run');
        const run = await runLiveValidation({ companyId, userId });
        const env = run.sections[0]?.checks.find((c) => c.key === 'env_production');
        expect(env?.status).toBe('FAIL');
        expect(env?.detail).toMatch(/Sandbox results do not validate production/i);
      } finally {
        if (original === undefined) delete process.env['INTUIT_ENVIRONMENT'];
        else process.env['INTUIT_ENVIRONMENT'] = original;
      }
    }, 60_000);
  });

  describe('date validation', () => {
    it('passes against a correctly imported month', async () => {
      const { validateDates } = await import('@/lib/validation/dates');
      const section = await validateDates({ companyId, period, fiscalYearStartMonth: 1, reportId });

      assertWellFormed(section);
      const failures = section.checks.filter((c) => c.status === 'FAIL');
      expect(failures.map((f) => `${f.key}: ${f.detail}`)).toEqual([]);

      // The checks that must actually have run, not been skipped.
      const bounds = section.checks.find((c) => c.key === 'dates_month_bounds');
      expect(bounds?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'dates_are_strings')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'dates_report_period')?.status).toBe('PASS');
    }, 60_000);

    it('catches a report built from a different month than it is labelled with', async () => {
      const { validateDates } = await import('@/lib/validation/dates');
      const wrongMonth = monthPeriodOf('2020-01-01');
      const section = await validateDates({
        companyId,
        period: wrongMonth,
        fiscalYearStartMonth: 1,
        reportId,
      });
      // No metrics for 2020, so it fails at the first hurdle rather than
      // reporting a comfortable pass on data it never looked at.
      expect(section.checks.some((c) => c.status === 'FAIL')).toBe(true);
    }, 60_000);

    it('reports a non-January fiscal year as the fiscal window, not the calendar one', async () => {
      const { validateDates } = await import('@/lib/validation/dates');
      const section = await validateDates({ companyId, period, fiscalYearStartMonth: 7, reportId });
      const ytd = section.checks.find((c) => c.key === 'dates_ytd_start');

      expect(ytd?.status).toBe('PASS');
      expect(ytd?.detail).toMatch(/not the calendar year/);
    }, 60_000);
  });

  describe('drill-down reconciliation', () => {
    it('reproduces every headline total from its mapped accounts', async () => {
      const { validateDrilldown } = await import('@/lib/validation/drilldown');
      const section = await validateDrilldown({ companyId, period });

      assertWellFormed(section);
      const failures = section.checks.filter((c) => c.status === 'FAIL');
      expect(failures.map((f) => `${f.key}: ${f.detail}`)).toEqual([]);

      // Revenue and COGS must have been traced, not reported unavailable.
      expect(section.checks.find((c) => c.key === 'drilldown_revenue')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'drilldown_cogs')?.status).toBe('PASS');

      const table = section.tables?.[0];
      expect(table?.rows.length).toBe(6);
      // Every row states a difference, and the traced ones are zero.
      for (const row of table?.rows ?? []) {
        if (row.status === 'PASS') expect(row.cells[5]).toBe('$0.00');
      }
    }, 60_000);
  });

  describe('mapping review', () => {
    it('reports coverage and never auto-approves an uncertain mapping', async () => {
      const { validateMapping } = await import('@/lib/validation/mapping');
      const section = await validateMapping({ companyId, period });

      assertWellFormed(section);
      expect(section.note).toMatch(/Nothing is auto-approved/);

      const table = section.tables?.[0];
      expect(table?.columns).toEqual([
        'QuickBooks Account', 'Account Type', 'Account Subtype', 'Management Category',
        'Confidence', 'Period activity', 'Needs Review',
      ]);
      expect(table?.rows.length).toBeGreaterThan(0);

      // Revenue, COGS and expense coverage are each reported.
      for (const key of ['mapping_revenue', 'mapping_cogs', 'mapping_expenses', 'mapping_overall']) {
        expect(section.checks.find((c) => c.key === key), key).toBeDefined();
      }
      // Nothing may be mapped across the revenue/expense boundary.
      expect(section.checks.find((c) => c.key === 'mapping_suspicious')?.status).toBe('PASS');
    }, 60_000);
  });

  describe('location and store validation', () => {
    it('does not assume a Location is a store', async () => {
      const { validateLocations } = await import('@/lib/validation/locations');
      const result = await validateLocations({ companyId, period, trackingDimension: 'auto' });

      assertWellFormed(result.section);
      // 'auto' means nobody chose, so the analysis is provisional.
      expect(result.storeMappingConfirmed).toBe(false);
      expect(result.section.note).toMatch(/PROVISIONAL/);
      expect(result.section.checks.find((c) => c.key === 'locations_confirmed')?.status).toBe('NEEDS_REVIEW');

      const table = result.section.tables?.[0];
      expect(table?.columns).toEqual([
        'QuickBooks Name', 'Type', 'Transaction Count', 'Revenue (from report)', 'Potential Store Mapping',
      ]);
    }, 60_000);

    it('treats a confirmed dimension as final', async () => {
      const { validateLocations } = await import('@/lib/validation/locations');
      const result = await validateLocations({ companyId, period, trackingDimension: 'location' });

      expect(result.storeMappingConfirmed).toBe(true);
      expect(result.section.note).toBeUndefined();
      expect(result.section.checks.find((c) => c.key === 'locations_confirmed')?.status).toBe('PASS');
    }, 60_000);
  });

  describe('live chat QA', () => {
    it('answers the live question set without an unsupported figure', async () => {
      const { validateChat } = await import('@/lib/validation/chat');
      const section = await validateChat({ companyId, period, hasStoreData: true });

      assertWellFormed(section);
      expect(section.checks.find((c) => c.key === 'chat_no_invented_figures')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'chat_basis')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'chat_store_conclusions')?.status).toBe('PASS');

      const table = section.tables?.[0];
      expect(table?.rows).toHaveLength(10);
    }, 180_000);

    it('flags a store conclusion drawn for a company with no store data', async () => {
      const { validateChat } = await import('@/lib/validation/chat');
      // The demo company does have store data, so claiming it does not is the
      // condition that must be caught.
      const section = await validateChat({ companyId, period, hasStoreData: false });
      const check = section.checks.find((c) => c.key === 'chat_store_conclusions');

      expect(check?.status).toBe('FAIL');
      expect(check?.remedy).toMatch(/fabricated store ranking/i);
    }, 180_000);
  });

  describe('report validation', () => {
    it('checks the report agrees with itself', async () => {
      const { validateReport } = await import('@/lib/validation/report');
      const section = await validateReport({ companyId, reportId, period });

      assertWellFormed(section);
      const failures = section.checks.filter((c) => c.status === 'FAIL');
      expect(failures.map((f) => `${f.key}: ${f.detail}`)).toEqual([]);

      expect(section.checks.find((c) => c.key === 'report_cover_month')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'report_single_basis')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'report_pdf')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'report_xlsx')?.status).toBe('PASS');
    }, 180_000);

    it('catches a report validated against the wrong month', async () => {
      const { validateReport } = await import('@/lib/validation/report');
      const { priorMonth } = await import('@/lib/util/dates');
      const section = await validateReport({ companyId, reportId, period: priorMonth(period) });

      const cover = section.checks.find((c) => c.key === 'report_cover_month');
      expect(cover?.status).toBe('FAIL');
      expect(cover?.remedy).toMatch(/must not be distributed/);
    }, 120_000);
  });

  describe('snapshot immutability', () => {
    it('confirms the issued report is unchanged and its version retained', async () => {
      const { validateImmutability } = await import('@/lib/validation/report');
      const { getReport } = await import('@/lib/db/repositories/reports');

      const stored = await getReport(reportId);
      const section = await validateImmutability({
        companyId,
        reportId,
        period,
        originalPayloadJson: JSON.stringify(stored?.payload ?? null),
        originalVersion: 1,
      });

      assertWellFormed(section);
      expect(section.checks.find((c) => c.key === 'immutable_payload')?.status).toBe('PASS');
      expect(section.checks.find((c) => c.key === 'immutable_version')?.status).toBe('PASS');
    }, 60_000);

    it('fails when the stored payload moved after generation', async () => {
      const { validateImmutability } = await import('@/lib/validation/report');
      const section = await validateImmutability({
        companyId,
        reportId,
        period,
        originalPayloadJson: JSON.stringify({ different: 'payload' }),
        originalVersion: 1,
      });

      const check = section.checks.find((c) => c.key === 'immutable_payload');
      expect(check?.status).toBe('FAIL');
      expect(check?.remedy).toMatch(/unverifiable/);
    }, 60_000);
  });
});
