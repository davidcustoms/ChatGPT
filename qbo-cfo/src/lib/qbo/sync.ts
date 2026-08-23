import { AppError } from '../errors';
import { logger } from '../logger';
import { recordAudit } from '../db/repositories/audit';
import { getCompany } from '../db/repositories/companies';
import { markSynced } from '../db/repositories/connections';
import {
  accountIndex,
  listDimensions,
  upsertAccounts,
  upsertCustomers,
  upsertDimensions,
  upsertItems,
  upsertVendors,
} from '../db/repositories/masterdata';
import { effectiveMappingIndex, insertSuggestionsIfMissing } from '../db/repositories/mappings';
import {
  saveAccountMetrics,
  saveAging,
  saveLocationMetrics,
  saveMonthlyMetrics,
  saveVendorSpend,
} from '../db/repositories/metrics';
import { saveSnapshot } from '../db/repositories/snapshots';
import { upsertTransactions, vendorSpendFromTransactions } from '../db/repositories/transactions';
import { createJob, finishJob, updateJobProgress } from '../db/repositories/jobs';
import { suggestAll } from '../finance/mapping';
import { computeMonthlyMetrics } from '../finance/metrics';
import { buildLocationMetrics } from '../finance/locations';
import { flattenReport, isEmptyReport } from './parse';
import { parseAgingSummary, parseBalanceSheet, parseProfitAndLoss } from './statements';
import type { QboReport } from './report-types';
import { clientForCompany } from './token-manager';
import {
  TRANSACTION_ENTITIES,
  fetchAccounts,
  fetchClasses,
  fetchCompanyInfo,
  fetchCustomers,
  fetchItems,
  fetchLocations,
  fetchTransactions,
  fetchVendors,
} from './entities';
import { addMonths, monthPeriodOf, toIsoDate, type Period } from '../util/dates';
import type { QuickBooksClient } from './client';

/**
 * Sync orchestration.
 *
 * Every step is recorded on a `sync_jobs` row so the UI can show progress and
 * offer a retry. A failure in one month does not abandon the others: the job
 * finishes as `partial` and names what failed.
 */

export interface SyncOptions {
  companyId: string;
  requestedBy?: string | null;
  triggeredBy?: 'manual' | 'scheduled' | 'onboarding';
}

/** Pulls chart of accounts, vendors, customers, items, classes and locations. */
export async function syncMasterData(
  client: QuickBooksClient,
  companyId: string,
  realmId: string,
): Promise<{ accounts: number; vendors: number; customers: number; locations: number; classes: number; items: number }> {
  const info = await fetchCompanyInfo(client, realmId);
  logger.info('company info fetched', { companyId, companyName: info.companyName });

  const accounts = await fetchAccounts(client);
  await upsertAccounts(companyId, accounts);

  // Seed mapping suggestions for any account the owner has not classified yet.
  const suggestions = suggestAll(accounts);
  await insertSuggestionsIfMissing(
    companyId,
    suggestions.map((s) => ({
      accountQboId: s.accountQboId,
      categoryKey: s.categoryKey,
      confidence: s.confidence,
      reason: s.reason,
    })),
  );

  const [vendors, customers, classes, locations, items] = await Promise.all([
    fetchVendors(client),
    fetchCustomers(client),
    fetchClasses(client).catch(() => []),
    fetchLocations(client).catch(() => []),
    fetchItems(client).catch(() => []),
  ]);

  await upsertVendors(companyId, vendors);
  await upsertCustomers(companyId, customers);
  await upsertDimensions('classes', companyId, classes);
  await upsertDimensions('locations', companyId, locations);
  await upsertItems(companyId, items);

  return {
    accounts: accounts.length,
    vendors: vendors.length,
    customers: customers.length,
    locations: locations.length,
    classes: classes.length,
    items: items.length,
  };
}

/** Which tracking dimension should be used for store analysis. */
export async function resolveTrackingDimension(
  companyId: string,
  configured: 'auto' | 'location' | 'class' | 'none',
): Promise<'location' | 'class' | 'none'> {
  if (configured !== 'auto') return configured;
  const locations = await listDimensions('locations', companyId);
  if (locations.filter((l) => l.isActive).length > 1) return 'location';
  const classes = await listDimensions('classes', companyId);
  if (classes.filter((c) => c.isActive).length > 1) return 'class';
  return 'none';
}

const SUMMARIZE_BY: Record<'location' | 'class', string> = {
  location: 'Departments',
  class: 'Classes',
};

/**
 * Syncs one month: P&L, Balance Sheet, aging, dimension P&L and transactions;
 * then recomputes the derived metrics for that month.
 */
export async function syncMonth(input: {
  client: QuickBooksClient;
  companyId: string;
  realmId: string;
  period: Period;
  dimension: 'location' | 'class' | 'none';
  jobId?: string | null;
  includeTransactions?: boolean;
}): Promise<{ warnings: string[] }> {
  const { client, companyId, realmId, period, dimension } = input;
  const warnings: string[] = [];
  const snapshotIds: string[] = [];

  // --- Profit & Loss (required) -------------------------------------------
  const pnlRaw = await client.report<QboReport>('ProfitAndLoss', {
    start_date: period.start,
    end_date: period.end,
    accounting_method: 'Accrual',
  });
  snapshotIds.push(
    await saveSnapshot({
      companyId,
      reportType: 'ProfitAndLoss',
      period,
      payload: pnlRaw,
      sourceRealmId: realmId,
      syncJobId: input.jobId ?? null,
    }),
  );
  const pnlFlat = flattenReport(pnlRaw);
  if (isEmptyReport(pnlFlat)) {
    warnings.push(`QuickBooks returned no Profit & Loss activity for ${period.start.slice(0, 7)}.`);
  }

  // --- Balance Sheet (optional but expected) -------------------------------
  let bsFlat = null;
  try {
    const bsRaw = await client.report<QboReport>('BalanceSheet', {
      start_date: period.start,
      end_date: period.end,
      accounting_method: 'Accrual',
    });
    snapshotIds.push(
      await saveSnapshot({
        companyId,
        reportType: 'BalanceSheet',
        period,
        payload: bsRaw,
        sourceRealmId: realmId,
        syncJobId: input.jobId ?? null,
      }),
    );
    bsFlat = flattenReport(bsRaw);
  } catch (err) {
    warnings.push(
      `Balance Sheet unavailable for ${period.start.slice(0, 7)}: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  // --- Statement of cash flows (not supported by every company) ------------
  try {
    const cfRaw = await client.report<QboReport>('CashFlow', {
      start_date: period.start,
      end_date: period.end,
    });
    await saveSnapshot({
      companyId,
      reportType: 'CashFlow',
      period,
      payload: cfRaw,
      sourceRealmId: realmId,
      syncJobId: input.jobId ?? null,
    });
  } catch {
    warnings.push(
      `QuickBooks did not return a Statement of Cash Flows for ${period.start.slice(0, 7)}; cash flow detail will be omitted rather than estimated.`,
    );
  }

  // --- Aging summaries (point-in-time, as of the period end) ---------------
  for (const [reportName, kind] of [
    ['AgedReceivables', 'receivable'],
    ['AgedPayables', 'payable'],
  ] as const) {
    try {
      const raw = await client.report<QboReport>(reportName, { report_date: period.end });
      await saveSnapshot({
        companyId,
        reportType: reportName,
        period,
        payload: raw,
        sourceRealmId: realmId,
        syncJobId: input.jobId ?? null,
      });
      const parsed = parseAgingSummary(flattenReport(raw));
      await saveAging(companyId, {
        asOf: period.end,
        kind,
        total: { entityName: '__TOTAL__', entityQboId: null, ...parsed.total },
        entities: parsed.buckets,
      });
    } catch (err) {
      warnings.push(
        `${reportName} unavailable for ${period.end}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  // --- Dimension (location/class) P&L --------------------------------------
  let dimensionFlat = null;
  if (dimension !== 'none') {
    try {
      const raw = await client.report<QboReport>('ProfitAndLoss', {
        start_date: period.start,
        end_date: period.end,
        accounting_method: 'Accrual',
        summarize_column_by: SUMMARIZE_BY[dimension],
      });
      await saveSnapshot({
        companyId,
        reportType: 'ProfitAndLoss',
        period,
        dimension,
        payload: raw,
        sourceRealmId: realmId,
        syncJobId: input.jobId ?? null,
      });
      dimensionFlat = flattenReport(raw);
    } catch (err) {
      warnings.push(
        `${dimension === 'location' ? 'Location' : 'Class'} breakdown unavailable for ${period.start.slice(0, 7)}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  // --- Transactions --------------------------------------------------------
  if (input.includeTransactions !== false) {
    for (const entity of TRANSACTION_ENTITIES) {
      try {
        const txns = await fetchTransactions(client, entity, period.start, period.end);
        await upsertTransactions(companyId, txns);
      } catch (err) {
        warnings.push(
          `Could not read ${entity} transactions for ${period.start.slice(0, 7)}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
  }

  await recomputeMonth({ companyId, period, snapshotIds, pnlFlatOverride: pnlFlat, bsFlatOverride: bsFlat, dimensionFlatOverride: dimensionFlat, dimension });

  return { warnings };
}

/**
 * Recomputes derived metrics for a month from already-stored raw data.
 * Called after a sync and whenever account mappings change.
 */
export async function recomputeMonth(input: {
  companyId: string;
  period: Period;
  snapshotIds?: string[];
  pnlFlatOverride?: ReturnType<typeof flattenReport> | null;
  bsFlatOverride?: ReturnType<typeof flattenReport> | null;
  dimensionFlatOverride?: ReturnType<typeof flattenReport> | null;
  dimension?: 'location' | 'class' | 'none';
}): Promise<void> {
  const { companyId, period } = input;
  const accounts = await accountIndex(companyId);
  const mapping = await effectiveMappingIndex(companyId);

  let pnlFlat = input.pnlFlatOverride ?? null;
  let bsFlat = input.bsFlatOverride ?? null;
  if (!pnlFlat) {
    const { getSnapshot } = await import('../db/repositories/snapshots');
    const snap = await getSnapshot<QboReport>(companyId, 'ProfitAndLoss', period);
    if (!snap) {
      throw new AppError('QBO_EMPTY_PERIOD', `No Profit & Loss snapshot stored for ${period.start.slice(0, 7)}.`);
    }
    pnlFlat = flattenReport(snap.payload);
  }
  if (!bsFlat) {
    const { getSnapshot } = await import('../db/repositories/snapshots');
    const snap = await getSnapshot<QboReport>(companyId, 'BalanceSheet', period);
    bsFlat = snap ? flattenReport(snap.payload) : null;
  }

  const pnl = parseProfitAndLoss(pnlFlat, accounts);
  const balanceSheet = bsFlat ? parseBalanceSheet(bsFlat, accounts) : null;

  const { metrics, accountAmounts } = computeMonthlyMetrics({
    companyId,
    period,
    pnl,
    balanceSheet,
    mapping,
    sourceSnapshotIds: input.snapshotIds ?? [],
  });

  await saveMonthlyMetrics(metrics);
  await saveAccountMetrics(companyId, period, accountAmounts);

  // Vendor spend from stored transactions.
  const vendorSpend = await vendorSpendFromTransactions(companyId, period);
  await saveVendorSpend(companyId, period, vendorSpend);

  // Location / class metrics.
  const dimension = input.dimension ?? 'none';
  if (dimension !== 'none') {
    let flat = input.dimensionFlatOverride ?? null;
    if (!flat) {
      const { getSnapshot } = await import('../db/repositories/snapshots');
      const snap = await getSnapshot<QboReport>(companyId, 'ProfitAndLoss', period, dimension);
      flat = snap ? flattenReport(snap.payload) : null;
    }
    if (flat) {
      const dims = await listDimensions(dimension === 'location' ? 'locations' : 'classes', companyId);
      const displayNames = new Map(dims.map((d) => [d.qboId, d.displayName ?? d.name]));
      const rows = buildLocationMetrics({
        flat,
        accounts,
        mapping,
        dimension,
        period,
        displayNames,
      });
      await saveLocationMetrics(companyId, period, rows);
    }
  }
}

/** Full historical import over N months, ending with the last closed month. */
export async function importHistory(
  options: SyncOptions & { months: number; endPeriod?: Period },
): Promise<{ jobId: string; warnings: string[] }> {
  const company = await getCompany(options.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');
  if (company.isDemo) {
    throw new AppError('VALIDATION', 'The demo company uses synthetic data and cannot sync QuickBooks.');
  }

  const months = Math.max(1, Math.min(36, options.months));
  const end = options.endPeriod ?? monthPeriodOf(toIsoDate(new Date()));
  const lastClosed = addMonths(end, -1);

  const jobId = await createJob({
    companyId: options.companyId,
    jobType: 'historical_import',
    progressTotal: months + 1,
    monthsRequested: months,
    triggeredBy: options.triggeredBy ?? 'manual',
    requestedBy: options.requestedBy ?? null,
  });

  const warnings: string[] = [];
  try {
    const { client, connection } = await clientForCompany(options.companyId);

    await updateJobProgress(jobId, { current: 0, step: 'Master data' });
    const counts = await syncMasterData(client, options.companyId, connection.realmId);
    await updateJobProgress(jobId, {
      current: 1,
      appendStep: { label: 'Master data', status: 'completed', message: `${counts.accounts} accounts, ${counts.vendors} vendors` },
    });

    const dimension = await resolveTrackingDimension(options.companyId, company.trackingDimension);

    for (let i = 0; i < months; i += 1) {
      const period = addMonths(lastClosed, -(months - 1 - i));
      const label = period.start.slice(0, 7);
      await updateJobProgress(jobId, { current: i + 1, step: `Syncing ${label}` });
      try {
        const result = await syncMonth({
          client,
          companyId: options.companyId,
          realmId: connection.realmId,
          period,
          dimension,
          jobId,
        });
        warnings.push(...result.warnings);
        await updateJobProgress(jobId, {
          current: i + 2,
          appendStep: { label, status: 'completed' },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        warnings.push(`${label}: ${message}`);
        await updateJobProgress(jobId, {
          current: i + 2,
          appendStep: { label, status: 'failed', message },
        });
      }
    }

    await markSynced(connection.id);
    const status = warnings.length > 0 ? 'partial' : 'completed';
    await finishJob(jobId, status, warnings.length ? warnings.slice(0, 20).join('\n') : null);
    await recordAudit({
      companyId: options.companyId,
      userId: options.requestedBy ?? null,
      action: 'quickbooks.historical_import',
      entityType: 'sync_job',
      entityId: jobId,
      outcome: status === 'completed' ? 'success' : 'failure',
      metadata: { months, warnings: warnings.length },
    });
    return { jobId, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Historical import failed';
    await finishJob(jobId, 'failed', message);
    await recordAudit({
      companyId: options.companyId,
      userId: options.requestedBy ?? null,
      action: 'quickbooks.historical_import',
      entityType: 'sync_job',
      entityId: jobId,
      outcome: 'failure',
      metadata: { message },
    });
    throw err;
  }
}

/** Syncs a single month (used by the monthly scheduler and manual refresh). */
export async function syncSingleMonth(
  options: SyncOptions & { period: Period },
): Promise<{ jobId: string; warnings: string[] }> {
  const company = await getCompany(options.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');
  if (company.isDemo) {
    throw new AppError('VALIDATION', 'The demo company uses synthetic data and cannot sync QuickBooks.');
  }

  const jobId = await createJob({
    companyId: options.companyId,
    jobType: 'monthly_sync',
    progressTotal: 2,
    triggeredBy: options.triggeredBy ?? 'manual',
    requestedBy: options.requestedBy ?? null,
  });

  try {
    const { client, connection } = await clientForCompany(options.companyId);
    await updateJobProgress(jobId, { current: 0, step: 'Master data' });
    await syncMasterData(client, options.companyId, connection.realmId);
    await updateJobProgress(jobId, { current: 1, step: `Syncing ${options.period.start.slice(0, 7)}` });
    const dimension = await resolveTrackingDimension(options.companyId, company.trackingDimension);
    const { warnings } = await syncMonth({
      client,
      companyId: options.companyId,
      realmId: connection.realmId,
      period: options.period,
      dimension,
      jobId,
    });
    await markSynced(connection.id);
    await finishJob(jobId, warnings.length ? 'partial' : 'completed', warnings.join('\n') || null);
    await recordAudit({
      companyId: options.companyId,
      userId: options.requestedBy ?? null,
      action: 'quickbooks.month_sync',
      entityType: 'sync_job',
      entityId: jobId,
      metadata: { period: options.period.start, warnings: warnings.length },
    });
    return { jobId, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    await finishJob(jobId, 'failed', message);
    throw err;
  }
}
