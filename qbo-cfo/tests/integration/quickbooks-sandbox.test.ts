import { describe, expect, it } from 'vitest';
import type { QboReport } from '@/lib/qbo/report-types';

/**
 * Live Intuit sandbox integration test.
 *
 * Runs only when a sandbox connection already exists in the database, which
 * requires completing the OAuth flow once in the UI. Everything it does is a
 * read: the suite asserts the client's read-only guarantee holds against the
 * real API and that the reports parse into the shapes the engine expects.
 *
 * To run:
 *   1. Set INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET / INTUIT_REDIRECT_URI and
 *      INTUIT_ENVIRONMENT=sandbox.
 *   2. Start the app, connect the Intuit sandbox company.
 *   3. QBO_SANDBOX_TESTS=1 npm test
 */

const ENABLED =
  process.env['QBO_SANDBOX_TESTS'] === '1' &&
  Boolean(process.env['DATABASE_URL']) &&
  Boolean(process.env['INTUIT_CLIENT_ID']) &&
  Boolean(process.env['INTUIT_CLIENT_SECRET']);

const suite = ENABLED ? describe : describe.skip;

suite('Intuit sandbox', () => {
  it('reads company information for a connected sandbox realm', async () => {
    const { queryOne, getPool } = await import('@/lib/db/pool');
    const { clientForCompany } = await import('@/lib/qbo/token-manager');
    const { fetchCompanyInfo } = await import('@/lib/qbo/entities');

    const row = await queryOne<{ company_id: string }>(
      `SELECT company_id FROM quickbooks_connections
        WHERE environment = 'sandbox' AND status = 'connected' LIMIT 1`,
    );
    if (!row) {
      throw new Error('No connected sandbox company. Complete the OAuth flow before running this suite.');
    }

    const { client, connection } = await clientForCompany(row.company_id);
    const info = await fetchCompanyInfo(client, connection.realmId);
    expect(info.companyName).toBeTruthy();
    await getPool().end();
  }, 60_000);

  it('reads the chart of accounts and every account carries a QuickBooks type', async () => {
    const { queryOne, getPool } = await import('@/lib/db/pool');
    const { clientForCompany } = await import('@/lib/qbo/token-manager');
    const { fetchAccounts } = await import('@/lib/qbo/entities');

    const row = await queryOne<{ company_id: string }>(
      `SELECT company_id FROM quickbooks_connections WHERE environment = 'sandbox' AND status = 'connected' LIMIT 1`,
    );
    const { client } = await clientForCompany(row!.company_id);
    const accounts = await fetchAccounts(client);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.accountType)).toBe(true);
    await getPool().end();
  }, 120_000);

  it('parses a live Profit & Loss and Balance Sheet into the engine shapes', async () => {
    const { queryOne, getPool } = await import('@/lib/db/pool');
    const { clientForCompany } = await import('@/lib/qbo/token-manager');
    const { fetchAccounts } = await import('@/lib/qbo/entities');
    const { flattenReport } = await import('@/lib/qbo/parse');
    const { parseBalanceSheet, parseProfitAndLoss } = await import('@/lib/qbo/statements');
    const { lastClosedMonth } = await import('@/lib/util/dates');

    const row = await queryOne<{ company_id: string }>(
      `SELECT company_id FROM quickbooks_connections WHERE environment = 'sandbox' AND status = 'connected' LIMIT 1`,
    );
    const { client } = await clientForCompany(row!.company_id);
    const period = lastClosedMonth();
    const accounts = new Map((await fetchAccounts(client)).map((a) => [a.qboId, a]));

    const pnlRaw = await client.report<QboReport>('ProfitAndLoss', {
      start_date: period.start,
      end_date: period.end,
      accounting_method: 'Accrual',
    });
    const pnl = parseProfitAndLoss(flattenReport(pnlRaw), accounts);
    // Gross profit must reconcile against income less COGS.
    expect(pnl.grossProfit).toBeCloseTo(pnl.totalIncome - pnl.totalCogs, 2);

    const bsRaw = await client.report<QboReport>('BalanceSheet', {
      start_date: period.start,
      end_date: period.end,
    });
    const bs = parseBalanceSheet(flattenReport(bsRaw), accounts);
    if (bs.totalAssets !== null) {
      expect(bs.balanced).toBe(true);
    }
    await getPool().end();
  }, 180_000);

  it('refuses to call a mutating endpoint against the live API', async () => {
    const { queryOne, getPool } = await import('@/lib/db/pool');
    const { clientForCompany } = await import('@/lib/qbo/token-manager');

    const row = await queryOne<{ company_id: string }>(
      `SELECT company_id FROM quickbooks_connections WHERE environment = 'sandbox' AND status = 'connected' LIMIT 1`,
    );
    const { client } = await clientForCompany(row!.company_id);
    await expect(client.request('purchase?operation=create')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.query("UPDATE Account SET Name = 'x'")).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await getPool().end();
  }, 60_000);
});
