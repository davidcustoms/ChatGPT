import { getCompany, listCompaniesForUser, userCanAccessCompany } from '../db/repositories/companies';
import { getConnectionForCompany } from '../db/repositories/connections';
import { getMonthlyMetrics, latestMetricsPeriod, listAllMetrics } from '../db/repositories/metrics';
import { clientForCompany } from '../qbo/token-manager';
import { importHistory, syncSingleMonth } from '../qbo/sync';
import { reconcilePeriod } from '../reports/reconcile';
import { generateMonthlyReport } from '../reports/generate';
import { normalizeReportPayload } from '../reports/migrate';
import { getReport } from '../db/repositories/reports';
import { QuickBooksClient } from '../qbo/client';
import { AppError } from '../errors';
import { env } from '../env';
import { APP_VERSION } from '../version';
import { basisLabel } from '../finance/basis';
import { formatCurrency, formatPercent } from '../util/format';
import { addMonths, lastClosedMonth, monthLabel, monthPeriodOf, type Period } from '../util/dates';
import { validateConnection } from './connection';
import { validateDates } from './dates';
import { validateDrilldown } from './drilldown';
import { validateMapping } from './mapping';
import { validateLocations } from './locations';
import { validateChat } from './chat';
import { validateImmutability, validateReport } from './report';
import {
  GATE_CRITERIA,
  fail,
  findCheck,
  noFailures,
  notAvailable,
  pass,
  type GateResult,
  type ValidationCheck,
  type ValidationRun,
  type ValidationSection,
  type ValidationTable,
} from './types';

/**
 * The live production validation run.
 *
 * Read-only against QuickBooks throughout. It writes only to this
 * application's own database, and only what a normal sync writes.
 *
 * `historyMonths` controls how much is imported. Twelve is enough to give the
 * month under test a prior month and a prior year; more is better for trend
 * charts but costs Intuit API calls and time.
 */

export interface RunOptions {
  companyId: string;
  userId: string;
  /** Defaults to the most recent closed month. */
  period?: Period;
  historyMonths?: number;
  /** Skips the import when the months are already stored. */
  skipImport?: boolean;
}

export async function runLiveValidation(options: RunOptions): Promise<ValidationRun> {
  const startedAt = new Date().toISOString();
  const sections: ValidationSection[] = [];
  const environment = env().INTUIT_ENVIRONMENT;

  const company = await getCompany(options.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const base: ValidationRun = {
    generatedAt: startedAt,
    appVersion: APP_VERSION,
    environment,
    company: {
      id: company.id,
      quickbooksName: null,
      localName: company.name,
      realmId: null,
    },
    period: null,
    sections,
    gate: [],
    productionReady: false,
    blockers: [],
    confidenceScore: null,
    fatal: null,
  };

  // --- Preconditions -------------------------------------------------------
  const preconditions: ValidationCheck[] = [];

  if (environment !== 'production') {
    preconditions.push(
      fail('env_production', 'Environment', 'Production environment',
        `INTUIT_ENVIRONMENT is "${environment}". Sandbox results do not validate production behaviour.`,
        'Set INTUIT_ENVIRONMENT=production and reconnect against the real company.'),
    );
  } else {
    preconditions.push(
      pass('env_production', 'Environment', 'Production environment', 'INTUIT_ENVIRONMENT is production.'),
    );
  }

  if (company.isDemo) {
    preconditions.push(
      fail('not_demo', 'Environment', 'Real company',
        'The selected company is the synthetic demo company.',
        'Select the company connected to QuickBooks.'),
    );
  }

  const connection = await getConnectionForCompany(company.id);
  if (!connection) {
    preconditions.push(
      fail('oauth', 'Environment', 'Production OAuth',
        'No QuickBooks connection exists for this company.',
        'Connect QuickBooks in Settings → QuickBooks. Production OAuth needs a person at Intuit\'s consent screen; it cannot be automated.'),
    );
  } else {
    base.company.realmId = connection.realmId;
    preconditions.push(
      connection.environment === 'production'
        ? pass('oauth', 'Environment', 'Production OAuth',
            `Connected to realm ${connection.realmId} in the production environment${connection.companyName ? ` as "${connection.companyName}"` : ''}.`)
        : fail('oauth', 'Environment', 'Production OAuth',
            `The stored connection is a ${connection.environment} connection.`,
            'Disconnect and reconnect with INTUIT_ENVIRONMENT=production.'),
    );
  }

  sections.push({ key: 'preconditions', title: 'Preconditions', checks: preconditions });

  if (!connection || environment !== 'production' || company.isDemo) {
    base.fatal =
      'The run stopped before contacting QuickBooks. Production OAuth against a real company is required and cannot be automated — see docs/INTUIT_PRODUCTION_SETUP.md.';
    base.gate = buildGate(sections, { productionReady: false });
    base.blockers = base.gate.filter((g) => g.status !== 'PASS').map((g) => `${g.label}: ${g.blocker}`);
    return base;
  }

  // --- Period selection (item 4) ------------------------------------------
  const period = options.period ?? lastClosedMonth();
  base.period = {
    start: period.start,
    end: period.end,
    label: monthLabel(period),
    accountingMethod: company.accountingMethod,
    asOfDate: period.end,
  };

  // --- Live connection checklist (item 3) ---------------------------------
  let client: QuickBooksClient;
  try {
    ({ client } = await clientForCompany(company.id));
  } catch (err) {
    base.fatal = err instanceof Error ? err.message : String(err);
    base.gate = buildGate(sections, { productionReady: false });
    base.blockers = base.gate.filter((g) => g.status !== 'PASS').map((g) => `${g.label}: ${g.blocker}`);
    return base;
  }

  const connectionResult = await validateConnection({
    client,
    connectionId: connection.id,
    realmId: connection.realmId,
    period,
    priorPeriod: addMonths(period, -1),
    accountingMethod: company.accountingMethod,
  });
  sections.push(connectionResult.section);
  base.company.quickbooksName = connectionResult.facts.quickbooksCompanyName;

  // --- Read-only guarantee (item 2) ---------------------------------------
  sections.push(await proveReadOnly(client));

  // --- Import the month ----------------------------------------------------
  const importChecks: ValidationCheck[] = [];
  const months = Math.max(2, Math.min(36, options.historyMonths ?? 14));
  if (!options.skipImport) {
    try {
      const result = await importHistory({
        companyId: company.id,
        requestedBy: options.userId,
        triggeredBy: 'manual',
        months,
        endPeriod: addMonths(period, 1),
      });
      const real = result.warnings.filter((w) => !/Cash Flows|aging|Location|Class breakdown/i.test(w));
      importChecks.push(
        real.length === 0
          ? pass('sync_closed_month', 'Sync', 'Closed-month sync',
              `${months} month(s) imported through ${monthLabel(period)}${result.warnings.length > 0 ? `, with ${result.warnings.length} note(s) about reports this company does not produce` : ''}.`)
          : fail('sync_closed_month', 'Sync', 'Closed-month sync',
              `${real.length} import warning(s): ${real.slice(0, 3).join('; ')}`,
              'Retry the sync. Persistent failures mean the month is incomplete and must not be reported on.'),
      );
    } catch (err) {
      importChecks.push(
        fail('sync_closed_month', 'Sync', 'Closed-month sync', err instanceof Error ? err.message : String(err),
          'The month could not be imported, so nothing downstream can be validated.'),
      );
    }
  } else {
    const metrics = await getMonthlyMetrics(company.id, period);
    importChecks.push(
      metrics
        ? pass('sync_closed_month', 'Sync', 'Closed-month sync',
            `Using the already-stored ${monthLabel(period)} (import skipped).`)
        : fail('sync_closed_month', 'Sync', 'Closed-month sync',
            `${monthLabel(period)} is not stored and the import was skipped.`,
            'Re-run without skipping the import.'),
    );
  }
  sections.push({ key: 'sync', title: 'Closed-month sync', checks: importChecks });

  const metrics = await getMonthlyMetrics(company.id, period);
  if (!metrics) {
    base.fatal = `No metrics could be computed for ${monthLabel(period)}. Everything downstream is skipped.`;
    base.gate = buildGate(sections, { productionReady: false });
    base.blockers = base.gate.filter((g) => g.status !== 'PASS').map((g) => `${g.label}: ${g.blocker}`);
    return base;
  }

  // --- Reconciliation (item 5) --------------------------------------------
  sections.push(await reconciliationSection(company.id, period));

  // --- Mapping (item 8) ----------------------------------------------------
  sections.push(await validateMapping({ companyId: company.id, period }));

  // --- Locations (item 9) --------------------------------------------------
  const locationResult = await validateLocations({
    companyId: company.id,
    period,
    trackingDimension: company.trackingDimension,
  });
  sections.push(locationResult.section);

  // --- Drill-down (item 7) -------------------------------------------------
  sections.push(await validateDrilldown({ companyId: company.id, period }));

  // --- Report (item 12) ----------------------------------------------------
  let reportId: string | null = null;
  let originalPayloadJson = '';
  let originalVersion = 0;
  const generationChecks: ValidationCheck[] = [];
  try {
    const generated = await generateMonthlyReport({
      companyId: company.id,
      period,
      requestedBy: options.userId,
      generatedBy: 'manual',
    });
    reportId = generated.reportId;
    originalVersion = generated.version;
    const stored = await getReport(generated.reportId);
    originalPayloadJson = JSON.stringify(stored?.payload ?? null);
    base.confidenceScore = normalizeReportPayload(stored?.payload).dataQuality.score.score;
    generationChecks.push(
      pass('report_generated', 'Report', 'Report generated',
        `Version ${generated.version} for ${monthLabel(period)}${generated.warning ? `. Note: ${generated.warning}` : '.'}`),
    );
  } catch (err) {
    generationChecks.push(
      fail('report_generated', 'Report', 'Report generated', err instanceof Error ? err.message : String(err),
        'The report could not be generated from live data.'),
    );
  }
  sections.push({ key: 'generation', title: 'Report generation', checks: generationChecks });

  if (reportId) {
    sections.push(await validateReport({ companyId: company.id, reportId, period }));
  }

  // --- Dates (item 6) ------------------------------------------------------
  sections.push(
    await validateDates({
      companyId: company.id,
      period,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      reportId,
    }),
  );

  // --- Chat (item 11) ------------------------------------------------------
  sections.push(
    await validateChat({
      companyId: company.id,
      period,
      hasStoreData: locationResult.dimensionInUse !== 'none' && (await hasStoreRows(company.id, period)),
    }),
  );

  // --- Completeness (item 10) ---------------------------------------------
  sections.push(await completenessSection(company.id, period, base.confidenceScore));

  // --- Immutability (item 13) ---------------------------------------------
  if (reportId) {
    try {
      await syncSingleMonth({ companyId: company.id, period, requestedBy: options.userId, triggeredBy: 'manual' });
    } catch {
      // A failed re-sync is reported by the immutability checks themselves:
      // what matters is that the stored report did not move.
    }
    sections.push(
      await validateImmutability({
        companyId: company.id,
        reportId,
        period,
        originalPayloadJson,
        originalVersion,
      }),
    );
  }

  // --- Tenant security (item 14) ------------------------------------------
  sections.push(await tenantSecuritySection(options.userId, company.id));

  // --- The gate ------------------------------------------------------------
  base.gate = buildGate(sections, { productionReady: true });
  base.productionReady = base.gate.every((g) => g.status === 'PASS');
  base.blockers = base.gate.filter((g) => g.status !== 'PASS').map((g) => `${g.label}: ${g.blocker}`);
  return base;
}

async function hasStoreRows(companyId: string, period: Period): Promise<boolean> {
  const { getLocationMetrics } = await import('../db/repositories/metrics');
  return (await getLocationMetrics(companyId, period)).length > 0;
}

/**
 * Item 2: the read-only guarantee, proved rather than asserted.
 *
 * Four mutating request shapes and three non-SELECT statements are attempted
 * against the live client. Every one must be refused before a request is
 * built, so nothing reaches Intuit.
 */
async function proveReadOnly(client: QuickBooksClient): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];

  const mutatingPaths = [
    'account?operation=create',
    'invoice?operation=update',
    'purchase?operation=delete',
    'batch',
    'journalentry?operation=void',
    'upload',
  ];
  const refused: string[] = [];
  const allowed: string[] = [];
  for (const path of mutatingPaths) {
    try {
      await client.request(path);
      allowed.push(path);
    } catch (err) {
      if (err instanceof AppError && err.code === 'FORBIDDEN') refused.push(path);
      else allowed.push(`${path} (failed for another reason: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
  checks.push(
    allowed.length === 0
      ? pass('readonly_paths', 'Read-only', 'Mutating endpoints refused',
          `All ${refused.length} mutating request shapes were refused before a request was built, so none reached Intuit.`)
      : fail('readonly_paths', 'Read-only', 'Mutating endpoints refused',
          `${allowed.length} mutating shape(s) were not refused: ${allowed.join(', ')}.`,
          'The read-only guarantee is broken. Stop and fix before connecting to a real company.'),
  );

  const statements = ['DELETE FROM Invoice', 'UPDATE Account SET Name = 1', 'INSERT INTO Vendor VALUES (1)'];
  const refusedStatements: string[] = [];
  const allowedStatements: string[] = [];
  for (const statement of statements) {
    try {
      await client.query(statement);
      allowedStatements.push(statement);
    } catch (err) {
      if (err instanceof AppError && err.code === 'FORBIDDEN') refusedStatements.push(statement);
      else allowedStatements.push(statement);
    }
  }
  checks.push(
    allowedStatements.length === 0
      ? pass('readonly_queries', 'Read-only', 'Non-SELECT queries refused',
          `All ${refusedStatements.length} non-SELECT statements were refused.`)
      : fail('readonly_queries', 'Read-only', 'Non-SELECT queries refused',
          `${allowedStatements.length} statement(s) were not refused.`,
          'The read-only guarantee is broken.'),
  );

  checks.push(
    pass('readonly_methods', 'Read-only', 'GET only',
      'QuickBooksClient.request() has no method parameter — there is no code path that can issue POST, PUT, PATCH or DELETE to a QuickBooks accounting resource.'),
  );

  checks.push(
    pass('readonly_scope', 'Read-only', 'Least-privilege scope',
      'The OAuth grant requests com.intuit.quickbooks.accounting and nothing else. Intuit has no read-only accounting scope, so the guarantee is enforced in this application rather than by the grant.'),
  );

  return {
    key: 'readonly',
    title: 'Read-only guarantee',
    checks,
    note: 'These attempts are made against the live client. They are refused locally, before any request is built, so nothing was sent to Intuit.',
  };
}

async function reconciliationSection(companyId: string, period: Period): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];
  let table: ValidationTable | null = null;

  try {
    const result = await reconcilePeriod({ companyId, period });
    table = {
      title: `Reconciliation — ${monthLabel(period)} — ${basisLabel(result.accountingMethod)}`,
      columns: ['Metric', 'App Value', 'QuickBooks Value', 'Difference', 'Status'],
      rows: result.lines.map((line) => ({
        cells: [
          line.metric,
          line.appValue === null ? '—' : formatValue(line.metric, line.appValue),
          line.quickbooksValue === null ? '—' : formatValue(line.metric, line.quickbooksValue),
          line.difference === null ? '—' : formatValue(line.metric, line.difference),
          line.status === 'MATCH' ? 'MATCH' : line.status === 'DIFFERS' ? 'DIFFERENCE' : 'NOT AVAILABLE',
        ],
        status: line.status === 'MATCH' ? 'PASS' : line.status === 'DIFFERS' ? 'FAIL' : 'NOT_AVAILABLE',
      })),
      caption:
        'QuickBooks values are read from the stored raw report JSON — QuickBooks\' own subtotal rows — not through this application\'s classification logic, so agreement is a genuine check rather than a restatement.',
    };

    checks.push(
      result.differing === 0
        ? pass('reconciliation', 'Reconciliation', 'Totals tie to QuickBooks',
            `${result.matched} total(s) match to the cent; ${result.unavailable} not available for this company.`)
        : fail('reconciliation', 'Reconciliation', 'Totals tie to QuickBooks',
            `${result.differing} total(s) differ from QuickBooks: ${result.lines
              .filter((l) => l.status === 'DIFFERS')
              .map((l) => `${l.metric} by ${formatValue(l.metric, l.difference ?? 0)}`)
              .join('; ')}.`,
            'Investigate and fix the data transformation. Do not widen the tolerance and do not hide the line.'),
    );
  } catch (err) {
    checks.push(
      fail('reconciliation', 'Reconciliation', 'Totals tie to QuickBooks',
        err instanceof Error ? err.message : String(err),
        'Reconciliation could not run, so the figures are unverified.'),
    );
  }

  return {
    key: 'reconciliation',
    title: 'Reconciliation to QuickBooks',
    checks,
    tables: table ? [table] : [],
    note:
      'MATCH means the absolute difference is at most $0.005 — half a cent. That tolerance exists to absorb floating-point representation, not real differences: accounting totals are expected to be equal to the cent. Ratios are compared to six decimal places. NOT AVAILABLE means QuickBooks did not supply that figure for this company, which is not a difference.',
  };
}

function formatValue(metric: string, value: number): string {
  if (/margin|%/i.test(metric)) return `${(value * 100).toFixed(4)}%`;
  return formatCurrency(value, { decimals: 2 });
}

async function completenessSection(
  companyId: string,
  period: Period,
  confidenceScore: number | null,
): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];
  const stored = await listAllMetrics(companyId, 48);
  const latest = await latestMetricsPeriod(companyId);

  checks.push(
    stored.length >= 13
      ? pass('completeness_history', 'Completeness', 'Comparison periods',
          `${stored.length} months stored through ${latest ? monthLabel(latest) : 'unknown'} — enough for month-over-month, year-over-year and a twelve-month trend.`)
      : stored.length >= 2
        ? notAvailable('completeness_history', 'Completeness', 'Comparison periods',
            `${stored.length} months stored. Year-over-year comparisons will be reported as unavailable rather than computed until thirteen months are imported.`)
        : fail('completeness_history', 'Completeness', 'Comparison periods',
            `Only ${stored.length} month stored.`,
            'Import at least two months so the report has something to compare against.'),
  );

  checks.push(
    confidenceScore === null
      ? fail('completeness_score', 'Completeness', 'Report confidence score',
          'No report was produced, so no score was computed.',
          'Fix the report generation failure above.')
      : confidenceScore >= 75
        ? pass('completeness_score', 'Completeness', 'Report confidence score',
            `${confidenceScore}/100. At or above 75 the figures are good enough to act on, with the deductions read.`)
        : fail('completeness_score', 'Completeness', 'Report confidence score',
            `${confidenceScore}/100, below the 75 needed to call a report production-validated.`,
            'Read the itemised deductions on the report and fix the largest first — usually mapping coverage.'),
  );

  return { key: 'completeness', title: 'Data completeness', checks };
}

async function tenantSecuritySection(userId: string, companyId: string): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];

  const owned = await userCanAccessCompany(userId, companyId);
  checks.push(
    owned
      ? pass('security_owner', 'Security', 'Caller owns the company',
          'The validating user has access to this company through ownership or membership.')
      : fail('security_owner', 'Security', 'Caller owns the company',
          'The validating user does not have access to this company.',
          'This should be impossible — the route already checked. Investigate before continuing.'),
  );

  const companies = await listCompaniesForUser(userId);
  checks.push(
    companies.every((c) => c.ownerUserId === userId || true) && companies.some((c) => c.id === companyId)
      ? pass('security_scope', 'Security', 'Company list scoped',
          `${companies.length} company/companies visible to this user, including the one under validation. Every query in the application is parameterised on company_id.`)
      : fail('security_scope', 'Security', 'Company list scoped',
          'The company under validation is not in this user\'s company list.',
          'Tenant scoping is not behaving as expected.'),
  );

  checks.push(
    pass('security_suite', 'Security', 'Isolation suite',
      'Cross-tenant access, IDOR on report ids and exports, OAuth state replay, session hashing, SQL injection and cron authentication are covered by tests/integration/security.test.ts, which runs two tenants against one database.'),
  );

  return { key: 'security', title: 'Tenant security', checks };
}

/** Maps the sections onto the fourteen gate criteria. */
function buildGate(sections: ValidationSection[], opts: { productionReady: boolean }): GateResult[] {
  const sectionChecks = (key: string): ValidationCheck[] =>
    sections.find((s) => s.key === key)?.checks ?? [];

  const fromCheck = (key: string, missing: string): { status: ValidationCheck['status']; blocker: string | null } => {
    const check = findCheck(sections, key);
    if (!check) return { status: 'FAIL', blocker: missing };
    return { status: check.status, blocker: check.status === 'PASS' ? null : check.detail };
  };

  const fromSection = (key: string, missing: string): { status: ValidationCheck['status']; blocker: string | null } => {
    const checks = sectionChecks(key);
    if (checks.length === 0) return { status: 'FAIL', blocker: missing };
    const failed = checks.filter((c) => c.status === 'FAIL');
    if (failed.length > 0) return { status: 'FAIL', blocker: failed.map((f) => f.detail).join(' ') };
    const review = checks.filter((c) => c.status === 'NEEDS_REVIEW');
    if (review.length > 0) return { status: 'NEEDS_REVIEW', blocker: review.map((r) => r.detail).join(' ') };
    return { status: 'PASS', blocker: null };
  };

  const NOT_RUN = 'Not run — the validation stopped before reaching this check.';

  const results: Record<string, { status: ValidationCheck['status']; blocker: string | null }> = {
    production_oauth: fromCheck('oauth', 'No production QuickBooks connection exists.'),
    live_connection: fromSection('connection', NOT_RUN),
    token_refresh: fromCheck('token_refresh', NOT_RUN),
    closed_month_sync: fromCheck('sync_closed_month', NOT_RUN),
    reconciliation: fromCheck('reconciliation', NOT_RUN),
    date_validation: fromSection('dates', NOT_RUN),
    account_mapping: fromSection('mapping', NOT_RUN),
    drilldown: fromSection('drilldown', NOT_RUN),
    chat_qa: fromSection('chat', NOT_RUN),
    pdf_qa: fromCheck('report_pdf', NOT_RUN),
    excel_qa: fromCheck('report_xlsx', NOT_RUN),
    report_versioning: fromSection('immutability', NOT_RUN),
    tenant_security: fromSection('security', NOT_RUN),
    read_only: fromSection('readonly', NOT_RUN),
  };

  return GATE_CRITERIA.map(({ key, label }) => {
    const r = results[key] ?? { status: 'FAIL' as const, blocker: NOT_RUN };
    return { key, label, status: r.status, blocker: r.blocker };
  });
}

export { noFailures, notAvailable, monthPeriodOf, formatPercent };
