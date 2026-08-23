/**
 * Live QuickBooks Online validation harness.
 *
 * Exercises every read path against a real, connected QuickBooks company and
 * reports what worked, what differed from the sandbox, and what is missing.
 * Strictly read-only: it issues no mutating call, and the client refuses to
 * build one.
 *
 * Prerequisites:
 *   1. INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET / INTUIT_REDIRECT_URI set to the
 *      values of your *production* Intuit app.
 *   2. INTUIT_ENVIRONMENT=production
 *   3. The company connected once through the UI (Settings -> QuickBooks), so a
 *      refresh token exists.
 *
 * Usage:
 *   npm run validate:qbo                     # first connected production company
 *   npm run validate:qbo -- --company <uuid>
 *   npm run validate:qbo -- --months 3       # how many months to spot-check
 *   npm run validate:qbo -- --json report.json
 */
import { writeFileSync } from 'node:fs';
import { getPool, queryOne } from '../src/lib/db/pool';
import { getConnectionForCompany, getTokens } from '../src/lib/db/repositories/connections';
import { getCompany } from '../src/lib/db/repositories/companies';
import { clientForCompany, getValidAccessToken } from '../src/lib/qbo/token-manager';
import {
  fetchAccounts,
  fetchClasses,
  fetchCompanyInfo,
  fetchCustomers,
  fetchItems,
  fetchLocations,
  fetchTransactions,
  fetchVendors,
  TRANSACTION_ENTITIES,
} from '../src/lib/qbo/entities';
import { flattenReport, isEmptyReport } from '../src/lib/qbo/parse';
import { parseAgingSummary, parseBalanceSheet, parseProfitAndLoss } from '../src/lib/qbo/statements';
import type { QboReport } from '../src/lib/qbo/report-types';
import { addMonths, lastClosedMonth, type Period } from '../src/lib/util/dates';
import { env } from '../src/lib/env';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface Check {
  area: string;
  name: string;
  status: Status;
  detail: string;
  durationMs?: number;
  /** Anything that behaved differently from the sandbox. */
  sandboxDifference?: string;
}

const checks: Check[] = [];

function record(check: Check): void {
  checks.push(check);
  const icon = { PASS: '  ok  ', WARN: ' warn ', FAIL: ' FAIL ', SKIP: ' skip ' }[check.status];
  const timing = check.durationMs !== undefined ? ` (${check.durationMs}ms)` : '';
  console.log(`[${icon}] ${check.area} / ${check.name}${timing}`);
  console.log(`         ${check.detail}`);
  if (check.sandboxDifference) console.log(`         DIFFERENCE: ${check.sandboxDifference}`);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - startedAt };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const monthsToCheck = Number(arg('months') ?? 3);
  const jsonOut = arg('json');

  console.log('QuickBooks Online live validation');
  console.log('='.repeat(70));

  // --- environment ---------------------------------------------------------
  const e = env();
  if (e.INTUIT_ENVIRONMENT !== 'production') {
    record({
      area: 'Environment',
      name: 'Intuit environment',
      status: 'WARN',
      detail: `INTUIT_ENVIRONMENT is "${e.INTUIT_ENVIRONMENT}". This harness is intended to run against production. Sandbox results do not validate production behaviour.`,
    });
  } else {
    record({
      area: 'Environment',
      name: 'Intuit environment',
      status: 'PASS',
      detail: 'Running against the Intuit production API.',
    });
  }

  // --- connection ----------------------------------------------------------
  let companyId = arg('company');
  if (!companyId) {
    const row = await queryOne<{ company_id: string }>(
      `SELECT company_id FROM quickbooks_connections
        WHERE status = 'connected' AND environment = $1
        ORDER BY connected_at DESC LIMIT 1`,
      [e.INTUIT_ENVIRONMENT],
    );
    companyId = row?.company_id;
  }
  if (!companyId) {
    record({
      area: 'OAuth',
      name: 'Connected company',
      status: 'FAIL',
      detail:
        'No connected QuickBooks company was found. Complete the OAuth flow in the UI (Settings -> QuickBooks) before running this harness.',
    });
    finish(jsonOut);
    return;
  }

  const company = await getCompany(companyId);
  const connection = await getConnectionForCompany(companyId);
  if (!company || !connection) {
    record({
      area: 'OAuth',
      name: 'Connected company',
      status: 'FAIL',
      detail: `Company ${companyId} has no active connection.`,
    });
    finish(jsonOut);
    return;
  }

  record({
    area: 'OAuth',
    name: 'Connect + realm persistence',
    status: 'PASS',
    detail: `Realm ${connection.realmId} (${connection.environment}) is stored against company "${company.name}", connected ${connection.connectedAt}.`,
  });

  // --- token refresh -------------------------------------------------------
  const tokens = await getTokens(connection.id);
  if (!tokens) {
    record({
      area: 'OAuth',
      name: 'Token storage',
      status: 'FAIL',
      detail: 'No tokens are stored for this connection.',
    });
    finish(jsonOut);
    return;
  }
  record({
    area: 'OAuth',
    name: 'Token storage',
    status: 'PASS',
    detail: `Access token expires ${tokens.accessTokenExpiresAt.toISOString()}, refresh token expires ${tokens.refreshTokenExpiresAt?.toISOString() ?? 'unknown'}, ${tokens.refreshFailureCount} refresh failure(s). Token values are encrypted at rest and never printed.`,
  });

  try {
    const { ms } = await timed(() => getValidAccessToken(connection.id));
    record({
      area: 'OAuth',
      name: 'Token refresh',
      status: 'PASS',
      detail: 'A valid access token was obtained (refreshed automatically if it was near expiry).',
      durationMs: ms,
    });
  } catch (err) {
    record({
      area: 'OAuth',
      name: 'Token refresh',
      status: 'FAIL',
      detail: `Could not obtain a valid access token: ${message(err)}`,
    });
    finish(jsonOut);
    return;
  }

  const { client } = await clientForCompany(companyId);

  // --- company information -------------------------------------------------
  try {
    const { value: info, ms } = await timed(() => fetchCompanyInfo(client, connection.realmId));
    record({
      area: 'Master data',
      name: 'Company information',
      status: info.companyName ? 'PASS' : 'WARN',
      detail: `Name "${info.companyName ?? 'missing'}", legal name "${info.legalName ?? 'missing'}", country ${info.country ?? 'unknown'}, fiscal year starts month ${info.fiscalYearStartMonth ?? 'unknown'}.`,
      durationMs: ms,
      sandboxDifference:
        info.fiscalYearStartMonth === null
          ? 'FiscalYearStartMonth was absent. Sandbox companies always return it; a production company may not, in which case the configured fiscal year is used.'
          : undefined,
    });
  } catch (err) {
    record({ area: 'Master data', name: 'Company information', status: 'FAIL', detail: message(err) });
  }

  // --- master data ---------------------------------------------------------
  const accounts = await checkEntity('Chart of accounts', () => fetchAccounts(client), (rows) => {
    const missingType = rows.filter((a) => !a.accountType).length;
    const missingSubType = rows.filter((a) => !a.accountSubType).length;
    return {
      detail: `${rows.length} accounts. ${missingType} without an AccountType, ${missingSubType} without an AccountSubType.`,
      status: missingType > 0 ? 'WARN' : 'PASS',
      sandboxDifference:
        missingType > 0
          ? `${missingType} account(s) have no AccountType. Classification falls back to the report section, which is less reliable. Sandbox companies always populate AccountType.`
          : missingSubType > rows.length * 0.5
            ? `${missingSubType} of ${rows.length} accounts have no AccountSubType, so mapping suggestions rely on name keywords rather than sub-type. Sandbox companies populate sub-types more consistently.`
            : undefined,
    };
  });

  await checkEntity('Vendors', () => fetchVendors(client), (rows) => ({
    detail: `${rows.length} vendors.`,
    status: rows.length > 0 ? 'PASS' : 'WARN',
  }));
  await checkEntity('Customers', () => fetchCustomers(client), (rows) => ({
    detail: `${rows.length} customers.`,
    status: rows.length > 0 ? 'PASS' : 'WARN',
  }));
  const locations = await checkEntity('Locations (Departments)', () => fetchLocations(client), (rows) => ({
    detail: `${rows.length} locations.`,
    status: rows.length > 0 ? 'PASS' : 'WARN',
    sandboxDifference:
      rows.length === 0
        ? 'No Locations. Store-level reporting will be unavailable unless Classes are used. Enable "Track locations" in QuickBooks Advanced settings.'
        : undefined,
  }));
  const classes = await checkEntity('Classes', () => fetchClasses(client), (rows) => ({
    detail: `${rows.length} classes.`,
    status: rows.length > 0 ? 'PASS' : 'WARN',
  }));
  await checkEntity('Items', () => fetchItems(client), (rows) => ({
    detail: `${rows.length} items, ${rows.filter((i) => i.itemType === 'Inventory').length} inventory-tracked.`,
    status: 'PASS',
  }));

  if ((locations?.length ?? 0) === 0 && (classes?.length ?? 0) === 0) {
    record({
      area: 'Master data',
      name: 'Tracking dimension',
      status: 'WARN',
      detail:
        'Neither Locations nor Classes are in use, so store-level reporting cannot be produced. The application reports this rather than inventing a breakdown.',
    });
  }

  // --- reports across several months --------------------------------------
  const accountMap = new Map((accounts ?? []).map((a) => [a.qboId, a]));
  const basis = company.accountingMethod;
  const latestClosed = lastClosedMonth();

  for (let i = 0; i < monthsToCheck; i += 1) {
    const period = addMonths(latestClosed, -i);
    await checkMonth(period);
  }

  async function checkMonth(period: Period): Promise<void> {
    const label = period.start.slice(0, 7);

    // Profit & Loss
    try {
      const { value: raw, ms } = await timed(() =>
        client.report<QboReport>('ProfitAndLoss', {
          start_date: period.start,
          end_date: period.end,
          accounting_method: basis,
        }),
      );
      const flat = flattenReport(raw);
      const pnl = parseProfitAndLoss(flat, accountMap);
      const empty = isEmptyReport(flat);
      const grossProfitTies = Math.abs(pnl.grossProfit - (pnl.totalIncome - pnl.totalCogs)) < 0.01;
      const unmatchedRows = flat.rows.filter((r) => r.id && !accountMap.has(r.id)).length;

      record({
        area: `Reports ${label}`,
        name: `Profit & Loss (${basis})`,
        status: empty ? 'WARN' : grossProfitTies ? 'PASS' : 'FAIL',
        detail: empty
          ? 'QuickBooks returned no activity for this period.'
          : `Income ${pnl.totalIncome}, COGS ${pnl.totalCogs}, gross profit ${pnl.grossProfit}, expenses ${pnl.totalExpenses}, net income ${pnl.netIncome}. ${flat.rows.length} rows parsed.`,
        durationMs: ms,
        sandboxDifference:
          unmatchedRows > 0
            ? `${unmatchedRows} report row(s) reference an account id not present in the chart of accounts. This happens in production when an account was deleted or is not returned by the Account query; those rows fall back to report-section classification.`
            : !grossProfitTies
              ? 'Gross profit does not equal income minus COGS as reported. Investigate before trusting the month.'
              : undefined,
      });
    } catch (err) {
      record({ area: `Reports ${label}`, name: 'Profit & Loss', status: 'FAIL', detail: message(err) });
    }

    // Balance Sheet
    try {
      const { value: raw, ms } = await timed(() =>
        client.report<QboReport>('BalanceSheet', {
          start_date: period.start,
          end_date: period.end,
          accounting_method: basis,
        }),
      );
      const bs = parseBalanceSheet(flattenReport(raw), accountMap);
      record({
        area: `Reports ${label}`,
        name: `Balance Sheet (${basis})`,
        status: bs.balanced === true ? 'PASS' : bs.balanced === null ? 'WARN' : 'FAIL',
        detail:
          bs.balanced === null
            ? 'No classifiable rows were returned.'
            : `Assets ${bs.totalAssets}, liabilities ${bs.totalLiabilities}, equity ${bs.equity}. Balanced: ${bs.balanced}. ${bs.unclassified.length} unclassified row(s).`,
        durationMs: ms,
        sandboxDifference:
          bs.unclassified.length > 0
            ? `${bs.unclassified.length} balance sheet row(s) could not be classified by account type: ${bs.unclassified.slice(0, 3).map((u) => u.label).join(', ')}. Those amounts are excluded from the totals, which is why the sheet may not balance.`
            : undefined,
      });
    } catch (err) {
      record({ area: `Reports ${label}`, name: 'Balance Sheet', status: 'FAIL', detail: message(err) });
    }

    // Cash flow (frequently unavailable)
    try {
      const { value: raw, ms } = await timed(() =>
        client.report<QboReport>('CashFlow', { start_date: period.start, end_date: period.end }),
      );
      const flat = flattenReport(raw);
      record({
        area: `Reports ${label}`,
        name: 'Statement of Cash Flows',
        status: isEmptyReport(flat) ? 'WARN' : 'PASS',
        detail: isEmptyReport(flat)
          ? 'Returned an empty report; the operating/investing/financing split will be omitted rather than estimated.'
          : `${flat.rows.length} rows, ${flat.summaries.length} subtotals.`,
        durationMs: ms,
      });
    } catch (err) {
      record({
        area: `Reports ${label}`,
        name: 'Statement of Cash Flows',
        status: 'WARN',
        detail: `Unavailable: ${message(err)}`,
        sandboxDifference:
          'The Statement of Cash Flows is not produced for every production company or period. The application omits the split and says so.',
      });
    }

    // Aging
    for (const [reportName, kind] of [
      ['AgedReceivables', 'A/R aging'],
      ['AgedPayables', 'A/P aging'],
    ] as const) {
      try {
        const { value: raw, ms } = await timed(() =>
          client.report<QboReport>(reportName, { report_date: period.end }),
        );
        const flat = flattenReport(raw);
        const aging = parseAgingSummary(flat);
        const bucketsSum =
          aging.total.current +
          aging.total.days1to30 +
          aging.total.days31to60 +
          aging.total.days61to90 +
          aging.total.days90Plus;
        const ties = Math.abs(bucketsSum - aging.total.total) < 0.01;
        record({
          area: `Reports ${label}`,
          name: kind,
          status: ties ? 'PASS' : 'WARN',
          detail: `Total ${aging.total.total}, over 90 days ${aging.total.days90Plus}, ${aging.buckets.length} entities. Column titles: ${flat.columns.map((c) => c.title).join(' | ')}`,
          durationMs: ms,
          sandboxDifference: ties
            ? undefined
            : `Aging buckets sum to ${bucketsSum} but the reported total is ${aging.total.total}. Production companies sometimes label bucket columns differently; check the column titles above against the positional fallback.`,
        });
      } catch (err) {
        record({ area: `Reports ${label}`, name: kind, status: 'WARN', detail: `Unavailable: ${message(err)}` });
      }
    }

    // Dimension P&L
    const dimension = (locations?.length ?? 0) > 0 ? 'Departments' : (classes?.length ?? 0) > 0 ? 'Classes' : null;
    if (dimension) {
      try {
        const { value: raw, ms } = await timed(() =>
          client.report<QboReport>('ProfitAndLoss', {
            start_date: period.start,
            end_date: period.end,
            accounting_method: basis,
            summarize_column_by: dimension,
          }),
        );
        const flat = flattenReport(raw);
        const named = flat.columns.filter((c) => c.title && c.title.toLowerCase() !== 'total');
        const withIds = named.filter((c) => c.metaId).length;
        record({
          area: `Reports ${label}`,
          name: `P&L by ${dimension}`,
          status: named.length > 0 ? 'PASS' : 'WARN',
          detail: `${named.length} dimension column(s): ${named.map((c) => c.title).join(', ')}.`,
          durationMs: ms,
          sandboxDifference:
            withIds < named.length
              ? `${named.length - withIds} column(s) carry no MetaData id, so stores are matched by name rather than id. Renaming a location in QuickBooks will then appear as a new store.`
              : undefined,
        });
      } catch (err) {
        record({
          area: `Reports ${label}`,
          name: `P&L by ${dimension}`,
          status: 'WARN',
          detail: `Unavailable: ${message(err)}`,
        });
      }
    } else {
      record({
        area: `Reports ${label}`,
        name: 'P&L by dimension',
        status: 'SKIP',
        detail: 'No Locations or Classes are in use.',
      });
    }

    // Transactions
    let transactionTotal = 0;
    const failedEntities: string[] = [];
    const startedAt = Date.now();
    for (const entity of TRANSACTION_ENTITIES) {
      try {
        const rows = await fetchTransactions(client, entity, period.start, period.end);
        transactionTotal += rows.length;
      } catch (err) {
        failedEntities.push(`${entity} (${message(err)})`);
      }
    }
    record({
      area: `Reports ${label}`,
      name: 'Transactions',
      status: failedEntities.length === 0 ? 'PASS' : 'WARN',
      detail: `${transactionTotal} transactions across ${TRANSACTION_ENTITIES.length} entity types.`,
      durationMs: Date.now() - startedAt,
      sandboxDifference:
        failedEntities.length > 0
          ? `Could not read: ${failedEntities.join('; ')}. Vendor spend and the review queue will be incomplete for this month.`
          : undefined,
    });
  }

  // --- read-only guarantee -------------------------------------------------
  let blockedMutations = 0;
  for (const path of ['purchase?operation=create', 'batch', 'bill?operation=delete']) {
    try {
      await client.request(path);
    } catch (err) {
      if (err instanceof Error && err.message.includes('read-only')) blockedMutations += 1;
    }
  }
  try {
    await client.query("UPDATE Account SET Name = 'x'");
  } catch (err) {
    if (err instanceof Error && err.message.includes('SELECT')) blockedMutations += 1;
  }
  record({
    area: 'Safety',
    name: 'Read-only guarantee',
    status: blockedMutations === 4 ? 'PASS' : 'FAIL',
    detail: `${blockedMutations}/4 mutating call shapes were refused before a request was built.`,
  });

  finish(jsonOut);
}

async function checkEntity<T>(
  name: string,
  fetcher: () => Promise<T[]>,
  summarise: (rows: T[]) => { detail: string; status: Status; sandboxDifference?: string },
): Promise<T[] | null> {
  try {
    const { value, ms } = await timed(fetcher);
    const s = summarise(value);
    record({
      area: 'Master data',
      name,
      status: s.status,
      detail: s.detail,
      durationMs: ms,
      sandboxDifference: s.sandboxDifference,
    });
    return value;
  } catch (err) {
    record({ area: 'Master data', name, status: 'FAIL', detail: message(err) });
    return null;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function finish(jsonOut: string | undefined): void {
  const counts = {
    PASS: checks.filter((c) => c.status === 'PASS').length,
    WARN: checks.filter((c) => c.status === 'WARN').length,
    FAIL: checks.filter((c) => c.status === 'FAIL').length,
    SKIP: checks.filter((c) => c.status === 'SKIP').length,
  };
  const differences = checks.filter((c) => c.sandboxDifference);

  console.log('');
  console.log('='.repeat(70));
  console.log(`PASS ${counts.PASS}   WARN ${counts.WARN}   FAIL ${counts.FAIL}   SKIP ${counts.SKIP}`);
  console.log('');

  if (differences.length > 0) {
    console.log('Differences from sandbox behaviour:');
    for (const d of differences) {
      console.log(`  - ${d.area} / ${d.name}: ${d.sandboxDifference}`);
    }
    console.log('');
  }

  console.log(
    counts.FAIL === 0
      ? 'RESULT: live validation passed. Record the differences above in docs/SANDBOX_VS_PRODUCTION.md.'
      : 'RESULT: live validation FAILED. Do not treat the deployment as production-ready.',
  );

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ counts, checks, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`Wrote ${jsonOut}`);
  }

  void getPool().end();
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
