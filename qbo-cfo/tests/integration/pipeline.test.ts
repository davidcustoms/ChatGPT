import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Database-backed integration test.
 *
 * Runs the whole pipeline against a real PostgreSQL instance: schema ->
 * synthetic company -> snapshots -> metrics -> anomalies -> report -> PDF and
 * Excel -> natural-language query. Skipped automatically when DATABASE_URL is
 * not configured, so `npm test` stays green on a machine without a database.
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

// A key is required to encrypt tokens; tests never touch real Intuit tokens.
process.env['TOKEN_ENCRYPTION_KEY'] ||= Buffer.from('integration-test-key-32-bytes!!!').toString('base64');

suite('end-to-end pipeline', () => {
  let pool: typeof import('@/lib/db/pool');
  let companyId: string;
  let userId: string;
  let period: { start: string; end: string };

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { seedDemoCompany } = await import('@/lib/demo/seed');
    const { latestMetricsPeriod } = await import('@/lib/db/repositories/metrics');

    await runMigrations();
    const email = 'integration-test@example.invalid';
    const existing = await findUserByEmail(email);
    userId = existing?.id ?? (await createUser({ email, password: 'integration-test-password' })).id;

    const seeded = await seedDemoCompany({ userId, months: 14 });
    companyId = seeded.companyId;
    period = (await latestMetricsPeriod(companyId))!;
  }, 180_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.getPool().end();
  });

  it('stores a monthly snapshot for every imported month', async () => {
    const { listSnapshotPeriods } = await import('@/lib/db/repositories/snapshots');
    const periods = await listSnapshotPeriods(companyId, 'ProfitAndLoss');
    expect(periods.length).toBe(14);
  });

  it('does not create a duplicate snapshot when the same month is re-imported', async () => {
    const { saveSnapshot, getSnapshot, listSnapshotPeriods } = await import('@/lib/db/repositories/snapshots');
    // A report type the pipeline does not read, so the assertion cannot
    // disturb the P&L this suite's later tests depend on.
    const reportType = 'TrialBalance';
    const first = await saveSnapshot({ companyId, reportType, period, payload: { marker: 'first' } });
    const second = await saveSnapshot({ companyId, reportType, period, payload: { marker: 'second' } });

    // Same row, updated in place -- the unique constraint prevents a duplicate.
    expect(second).toBe(first);
    expect((await listSnapshotPeriods(companyId, reportType)).length).toBe(1);
    const stored = await getSnapshot<{ marker: string }>(companyId, reportType, period);
    expect(stored?.payload.marker).toBe('second');
  });

  it('does not create a duplicate monthly metric row when a month is recomputed', async () => {
    const { recomputeMonth } = await import('@/lib/qbo/sync');
    await recomputeMonth({ companyId, period, dimension: 'location' });
    await recomputeMonth({ companyId, period, dimension: 'location' });
    const rows = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM monthly_metrics WHERE company_id = $1 AND period_start = $2',
      [companyId, period.start],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('produces a balanced, internally consistent report payload', async () => {
    const { buildReportPayload } = await import('@/lib/reports/builder');
    const { payload, source } = await buildReportPayload({ companyId, period });
    expect(source.fingerprint).toHaveLength(64);
    expect(source.snapshotIds.length).toBeGreaterThan(0);

    expect(payload.metrics.balanceSheetBalanced).toBe(true);
    // Net sales must reconcile with gross sales less contra revenue.
    expect(payload.metrics.netSales).toBeCloseTo(
      payload.metrics.grossSales - payload.metrics.discounts - payload.metrics.refunds,
      2,
    );
    // Gross profit must reconcile with net sales less COGS.
    expect(payload.metrics.grossProfit).toBeCloseTo(payload.metrics.netSales - payload.metrics.cogs, 2);
    expect(payload.trends.length).toBeGreaterThan(1);
    expect(payload.stores.length).toBeGreaterThan(1);
    expect(payload.arAging?.total.total).toBeGreaterThan(0);
    expect(payload.dataQuality.checks.length).toBeGreaterThan(5);
  }, 60_000);

  it('generates a completed report with deterministic commentary', async () => {
    const { generateMonthlyReport } = await import('@/lib/reports/generate');
    const { getReport } = await import('@/lib/db/repositories/reports');
    const { reportId } = await generateMonthlyReport({
      companyId,
      period,
      requestedBy: userId,
      skipAi: true,
    });
    const report = await getReport(reportId);
    expect(report?.status).toBe('completed');
    expect(report?.executiveSummary).toBeTruthy();
    expect(report?.confidence).toBeTruthy();
  }, 60_000);

  it('reuses the same report row when a period is regenerated', async () => {
    const { generateMonthlyReport } = await import('@/lib/reports/generate');
    const a = await generateMonthlyReport({ companyId, period, requestedBy: userId, skipAi: true });
    const b = await generateMonthlyReport({ companyId, period, requestedBy: userId, skipAi: true });
    expect(b.reportId).toBe(a.reportId);
    const rows = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM generated_reports WHERE company_id = $1 AND period_start = $2',
      [companyId, period.start],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  }, 60_000);

  it('renders a multi-page PDF and a multi-sheet workbook', async () => {
    const { getReport } = await import('@/lib/db/repositories/reports');
    const { getBranding } = await import('@/lib/db/repositories/companies');
    const { renderReportPdf } = await import('@/lib/reports/pdf');
    const { renderReportWorkbook } = await import('@/lib/reports/excel');
    const { getReportForPeriod } = await import('@/lib/db/repositories/reports');

    const stored = await getReportForPeriod(companyId, period);
    const report = await getReport(stored!.id);
    const payload = report!.payload as Parameters<typeof renderReportPdf>[0];

    const pdf = await renderReportPdf(payload, await getBranding(companyId));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(10_000);

    const xlsx = await renderReportWorkbook(payload);
    // XLSX files are ZIP archives.
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.length).toBeGreaterThan(5_000);
  }, 120_000);

  it('answers natural-language questions from stored data only', async () => {
    const { answerQuestion } = await import('@/lib/ai/nlq');

    const summary = await answerQuestion({ companyId, question: 'How did we do last month?' });
    expect(summary.intent).toBe('month_summary');
    expect(summary.dataThrough).toBe(period.end);
    expect(summary.data['revenue']).toBeGreaterThan(0);
    // Without an OpenAI key the deterministic answer is returned verbatim.
    expect(summary.answer).toBe(summary.deterministicAnswer);

    const stores = await answerQuestion({ companyId, question: 'Which store performed best?' });
    expect(stores.intent).toBe('store_performance');
    expect(stores.answer).toMatch(/before corporate overhead/i);

    const unknown = await answerQuestion({ companyId, question: 'Tell me a joke' });
    expect(unknown.answer).toMatch(/could not match that question/i);
  }, 60_000);

  it('recomputes every stored month when a mapping changes', async () => {
    const { effectiveMappingIndex, upsertMappings } = await import('@/lib/db/repositories/mappings');
    const { getMonthlyMetrics } = await import('@/lib/db/repositories/metrics');
    const { recomputeMonth } = await import('@/lib/qbo/sync');

    const before = await getMonthlyMetrics(companyId, period);
    // Account 6100 is "Meta Ads", mapped to advertising in the demo seed.
    await upsertMappings(companyId, [
      { accountQboId: '6100', categoryKey: 'payroll', confidence: 1, source: 'manual', approved: true },
    ]);
    const mapping = await effectiveMappingIndex(companyId);
    expect(mapping.get('6100')).toBe('payroll');

    await recomputeMonth({ companyId, period, dimension: 'location' });
    const after = await getMonthlyMetrics(companyId, period);
    expect(after!.advertisingExpense).toBeLessThan(before!.advertisingExpense);
    expect(after!.payrollExpense).toBeGreaterThan(before!.payrollExpense);
    // Total operating expenses are unchanged: only the attribution moved.
    expect(after!.operatingExpenses).toBeCloseTo(before!.operatingExpenses, 2);

    // Restore the original mapping for any later test in the file.
    await upsertMappings(companyId, [
      { accountQboId: '6100', categoryKey: 'advertising', confidence: 1, source: 'manual', approved: true },
    ]);
    await recomputeMonth({ companyId, period, dimension: 'location' });
  }, 120_000);

  it('writes an audit trail for syncs and report generation', async () => {
    const { listAudit } = await import('@/lib/db/repositories/audit');
    const entries = await listAudit(companyId, 50);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('demo.seeded');
    expect(actions).toContain('report.generated');
  });
});
