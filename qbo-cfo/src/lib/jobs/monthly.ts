import { getCompany, listSchedulableCompanies, markScheduleRun, getSchedule } from '../db/repositories/companies';
import { getConnectionForCompany } from '../db/repositories/connections';
import { createJob, finishJob, incrementRetry, updateJobProgress } from '../db/repositories/jobs';
import { pruneSnapshots } from '../db/repositories/snapshots';
import { recordAudit } from '../db/repositories/audit';
import { AppError } from '../errors';
import { logger } from '../logger';
import { event } from '../observability';
import { generateMonthlyReport } from '../reports/generate';
import { syncSingleMonth } from '../qbo/sync';
import { lastClosedMonth, monthLabel, type Period } from '../util/dates';

/**
 * Scheduled monthly close.
 *
 * Steps (each recorded on the sync job so the UI can show where it stopped):
 *   refresh token -> pull previous month -> validate -> metrics -> anomalies
 *   -> AI CFO analysis -> generate report -> save -> mark ready
 *
 * V1 does not email the report; delivery is left to the owner downloading it.
 */

export interface MonthlyRunResult {
  companyId: string;
  status: 'completed' | 'partial' | 'failed' | 'skipped';
  reportId?: string;
  period: string;
  message?: string;
  warnings: string[];
}

export async function runMonthlyForCompany(input: {
  companyId: string;
  period?: Period;
  requestedBy?: string | null;
  force?: boolean;
}): Promise<MonthlyRunResult> {
  const company = await getCompany(input.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const period = input.period ?? lastClosedMonth();
  const warnings: string[] = [];

  const jobId = await createJob({
    companyId: input.companyId,
    jobType: 'monthly_report',
    progressTotal: 5,
    triggeredBy: input.requestedBy ? 'manual' : 'scheduled',
    requestedBy: input.requestedBy ?? null,
  });

  try {
    // 1-3. Sync the closed month (skipped for the synthetic demo company).
    if (!company.isDemo) {
      const connection = await getConnectionForCompany(input.companyId);
      if (!connection) {
        throw new AppError('QBO_NOT_CONNECTED', 'QuickBooks is not connected for this company.');
      }
      await updateJobProgress(jobId, { current: 1, step: `Syncing ${monthLabel(period)}` });
      const sync = await syncSingleMonth({
        companyId: input.companyId,
        period,
        requestedBy: input.requestedBy ?? null,
        triggeredBy: 'scheduled',
      });
      warnings.push(...sync.warnings);
      await updateJobProgress(jobId, {
        current: 2,
        appendStep: { label: 'QuickBooks sync', status: sync.warnings.length ? 'partial' : 'completed' },
      });
    } else {
      await updateJobProgress(jobId, {
        current: 2,
        appendStep: { label: 'Demo company — synthetic data already present', status: 'completed' },
      });
    }

    // 4-7. Metrics, anomalies, AI analysis and report assembly.
    await updateJobProgress(jobId, { current: 3, step: 'Analysing and generating report' });
    const { reportId, warning } = await generateMonthlyReport({
      companyId: input.companyId,
      period,
      requestedBy: input.requestedBy ?? null,
      generatedBy: input.requestedBy ? 'manual' : 'scheduled',
    });
    if (warning) warnings.push(warning);

    await updateJobProgress(jobId, {
      current: 4,
      appendStep: { label: 'Report generated', status: 'completed' },
    });

    // 8-9. Retention housekeeping, then mark ready.
    const schedule = await getSchedule(input.companyId);
    const pruned = await pruneSnapshots(input.companyId, Math.max(12, schedule.retentionMonths));
    if (pruned > 0) warnings.push(`${pruned} snapshot(s) older than ${schedule.retentionMonths} months were pruned.`);

    const status = warnings.length > 0 ? 'partial' : 'completed';
    await updateJobProgress(jobId, { current: 5, step: 'Completed' });
    await finishJob(jobId, status, warnings.slice(0, 10).join('\n') || null);
    await markScheduleRun(input.companyId, status);
    await recordAudit({
      companyId: input.companyId,
      userId: input.requestedBy ?? null,
      action: 'report.monthly_run',
      entityType: 'report',
      entityId: reportId,
      metadata: { period: period.start, status, warnings: warnings.length },
    });

    return { companyId: input.companyId, status, reportId, period: period.start, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Monthly run failed';
    await incrementRetry(jobId);
    await finishJob(jobId, 'failed', message);
    await markScheduleRun(input.companyId, 'failed');
    await recordAudit({
      companyId: input.companyId,
      userId: input.requestedBy ?? null,
      action: 'report.monthly_run',
      outcome: 'failure',
      metadata: { period: period.start, message },
    });
    logger.error('monthly run failed', { companyId: input.companyId, message });
    return { companyId: input.companyId, status: 'failed', period: period.start, message, warnings };
  }
}

/**
 * Entry point for the cron endpoint. Runs every company whose configured day
 * of month matches today (or all of them when `force` is set).
 */
export async function runMonthlyForAllCompanies(options: {
  today?: Date;
  force?: boolean;
} = {}): Promise<MonthlyRunResult[]> {
  const today = options.today ?? new Date();
  const dayOfMonth = today.getUTCDate();
  const period = lastClosedMonth(today);
  const companies = await listSchedulableCompanies();
  const results: MonthlyRunResult[] = [];
  const startedAt = Date.now();
  event('scheduler.started', { count: companies.length, period: period.start });

  for (const entry of companies) {
    if (!options.force) {
      if (!entry.enabled) {
        results.push({ companyId: entry.companyId, status: 'skipped', period: period.start, message: 'Scheduling disabled', warnings: [] });
        continue;
      }
      if (entry.dayOfMonth !== dayOfMonth) continue;
      // Guard against a double-run if the cron fires more than once per day.
      if (entry.lastRunAt && entry.lastRunAt.slice(0, 10) === today.toISOString().slice(0, 10)) {
        results.push({ companyId: entry.companyId, status: 'skipped', period: period.start, message: 'Already run today', warnings: [] });
        continue;
      }
    }
    results.push(await runMonthlyForCompany({ companyId: entry.companyId, period }));
  }

  event('scheduler.finished', {
    count: results.length,
    period: period.start,
    durationMs: Date.now() - startedAt,
    status: results.some((r) => r.status === 'failed') ? 'partial' : 'ok',
  });
  return results;
}
