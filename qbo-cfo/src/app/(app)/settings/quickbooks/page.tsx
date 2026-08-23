import Link from 'next/link';
import { getPageContext, param, type SearchParams } from '@/lib/page-context';
import { env, isQuickBooksConfigured } from '@/lib/env';
import { getConnectionForCompany, getTokens } from '@/lib/db/repositories/connections';
import { listJobs } from '@/lib/db/repositories/jobs';
import { listReports } from '@/lib/db/repositories/reports';
import { listSnapshotPeriods } from '@/lib/db/repositories/snapshots';
import { formatDateTime, relativeTime } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ActionButton } from '@/components/ui/action-button';
import { ErrorNotice, InfoNotice, WarningNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { ImportHistoryPanel } from './import-panel';

export const dynamic = 'force-dynamic';

export default async function QuickBooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  const errorParam = param(sp, 'error');
  const connectedParam = param(sp, 'connected');
  const company = ctx.company;

  const configured = isQuickBooksConfigured();

  if (!company) {
    return (
      <>
        <PageHeader title="QuickBooks connection" />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="mb-4 text-sm text-ink-muted">No company exists yet.</p>
            <Button asChild>
              <a href="/api/quickbooks/connect">Connect QuickBooks</a>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const [connection, jobs, reports, snapshotPeriods] = await Promise.all([
    getConnectionForCompany(company.id),
    listJobs(company.id, 10),
    listReports(company.id, 1),
    listSnapshotPeriods(company.id, 'ProfitAndLoss'),
  ]);
  const tokens = connection ? await getTokens(connection.id) : null;

  const tokenHealthy =
    tokens !== null &&
    (tokens.accessTokenExpiresAt.getTime() > Date.now() ||
      (tokens.refreshTokenExpiresAt === null || tokens.refreshTokenExpiresAt.getTime() > Date.now()));

  return (
    <>
      <PageHeader
        title="QuickBooks connection"
        description="Connect a QuickBooks Online company and import historical financial data. This application only ever reads."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">All settings</Link>
          </Button>
        }
      />

      {errorParam ? <ErrorNotice title="Connection problem" message={errorParam} /> : null}
      {connectedParam ? (
        <InfoNotice className="mb-4">
          QuickBooks connected. Import history below to start producing reports.
        </InfoNotice>
      ) : null}
      {!configured ? (
        <WarningNotice className="mb-4">
          Intuit credentials are not configured. Set INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET and
          INTUIT_REDIRECT_URI, then restart the application. See docs/QUICKBOOKS_SETUP.md.
        </WarningNotice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Connection status</CardTitle>
            <CardDescription>
              {company.isDemo
                ? 'This is the synthetic demo company. It has no QuickBooks connection by design.'
                : 'Details of the linked QuickBooks Online company.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!connection ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">No QuickBooks company is connected.</p>
                <Button asChild disabled={!configured}>
                  <a href={`/api/quickbooks/connect?company=${company.id}`}>Connect QuickBooks</a>
                </Button>
              </div>
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Company name', connection.companyName ?? '—'],
                    ['Legal name', connection.legalName ?? '—'],
                    ['Realm ID', connection.realmId],
                    ['Environment', connection.environment],
                    ['Country', connection.country ?? '—'],
                    ['Connected', formatDateTime(connection.connectedAt)],
                    ['Last successful sync', connection.lastSyncAt ? `${formatDateTime(connection.lastSyncAt)} (${relativeTime(connection.lastSyncAt)})` : 'Never'],
                    ['Last report generated', connection.lastReportAt ? formatDateTime(connection.lastReportAt) : 'Never'],
                    ['Months of stored history', String(snapshotPeriods.length)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</dt>
                      <dd className="text-sm font-medium text-ink">{value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">Connection status</dt>
                    <dd className="mt-0.5">
                      <Badge variant={connection.status === 'connected' ? 'positive' : 'negative'}>
                        {connection.status}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">Token status</dt>
                    <dd className="mt-0.5 space-y-1">
                      <Badge variant={tokenHealthy ? 'positive' : 'negative'}>
                        {tokenHealthy ? 'healthy' : 'needs reconnect'}
                      </Badge>
                      {tokens ? (
                        <p className="text-[11px] text-ink-subtle">
                          Access token expires {formatDateTime(tokens.accessTokenExpiresAt.toISOString())}
                          {tokens.refreshTokenExpiresAt
                            ? ` · refresh token expires ${formatDateTime(tokens.refreshTokenExpiresAt.toISOString())}`
                            : ''}
                          {tokens.refreshFailureCount > 0
                            ? ` · ${tokens.refreshFailureCount} refresh failure(s)`
                            : ''}
                        </p>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                {connection.lastError ? (
                  <div className="mt-4">
                    <ErrorNotice title="Last connection error" message={connection.lastError} />
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-start gap-3 border-t border-border pt-4">
                  <Button variant="outline" asChild>
                    <a href={`/api/quickbooks/connect?company=${company.id}`}>Reconnect</a>
                  </Button>
                  <ActionButton
                    endpoint="/api/sync/month"
                    body={{ companyId: company.id }}
                    variant="secondary"
                    pendingLabel="Syncing…"
                  >
                    Sync last closed month
                  </ActionButton>
                  <ActionButton
                    endpoint="/api/quickbooks/disconnect"
                    body={{ companyId: company.id }}
                    variant="danger"
                    pendingLabel="Disconnecting…"
                    confirm="Disconnect QuickBooks? Stored history is kept, but no further syncs will run until you reconnect."
                  >
                    Disconnect
                  </ActionButton>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import historical data</CardTitle>
            <CardDescription>Builds the monthly snapshots that every comparison depends on.</CardDescription>
          </CardHeader>
          <CardContent>
            {company.isDemo ? (
              <p className="text-sm text-ink-muted">
                The demo company generates its own synthetic history and does not import from QuickBooks.
              </p>
            ) : (
              <ImportHistoryPanel companyId={company.id} connected={Boolean(connection)} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Sync history</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-ink-muted">No sync jobs have run yet.</p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Job</TH>
                      <TH>Status</TH>
                      <TH>Progress</TH>
                      <TH>Started</TH>
                      <TH>Finished</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {jobs.map((j) => (
                      <TR key={j.id}>
                        <TD className="text-xs">{j.jobType}</TD>
                        <TD>
                          <Badge
                            variant={
                              j.status === 'completed'
                                ? 'positive'
                                : j.status === 'failed'
                                  ? 'negative'
                                  : j.status === 'partial'
                                    ? 'warning'
                                    : 'info'
                            }
                          >
                            {j.status}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-xs tnum">
                          {j.progressCurrent}/{j.progressTotal || '—'}
                          {j.currentStep ? ` · ${j.currentStep}` : ''}
                        </TD>
                        <TD className="whitespace-nowrap text-xs text-ink-muted">
                          {j.startedAt ? formatDateTime(j.startedAt) : '—'}
                        </TD>
                        <TD className="whitespace-nowrap text-xs text-ink-muted">
                          {j.finishedAt ? formatDateTime(j.finishedAt) : 'running'}
                        </TD>
                        <TD className="max-w-[24rem] text-xs text-ink-muted">
                          {j.errorMessage ? (
                            <details>
                              <summary className="cursor-pointer text-warning">
                                {j.status === 'failed' ? 'Error' : `${j.errorMessage.split('\n').length} warning(s)`}
                              </summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] scrollbar-thin">
                                {j.errorMessage}
                              </pre>
                            </details>
                          ) : (
                            '—'
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
            {reports[0] ? (
              <p className="mt-3 text-xs text-ink-subtle">
                Last report: {reports[0].title} ({reports[0].status}
                {reports[0].completedAt ? `, ${formatDateTime(reports[0].completedAt)}` : ''}).
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {env().DEMO_MODE && !company.isDemo ? (
        <div className="mt-4">
          <ActionButton
            endpoint="/api/demo/seed"
            body={{ months: 24, generateReport: true }}
            variant="secondary"
            pendingLabel="Building demo company…"
          >
            Also create a synthetic demo company
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}
