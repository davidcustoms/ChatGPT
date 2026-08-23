import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env, isQuickBooksConfigured } from '@/lib/env';
import { getConnectionForCompany } from '@/lib/db/repositories/connections';
import { listAccounts, listDimensions } from '@/lib/db/repositories/masterdata';
import { listMappings } from '@/lib/db/repositories/mappings';
import { listSnapshotPeriods } from '@/lib/db/repositories/snapshots';
import { listReports } from '@/lib/db/repositories/reports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionButton } from '@/components/ui/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { ImportHistoryPanel } from '../settings/quickbooks/import-panel';
import { GenerateReportPanel } from '../reports/generate-panel';

export const dynamic = 'force-dynamic';

interface Step {
  id: number;
  title: string;
  description: string;
  done: boolean;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * First-run onboarding.
 *
 * Step completion is derived from real state — a connected realm, an imported
 * chart of accounts, approved mappings, stored months, a generated report —
 * rather than from a stored wizard position, so the wizard is always accurate.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  const company = ctx.company;

  const connection = company ? await getConnectionForCompany(company.id) : null;
  const [accounts, mappings, locations, classes, periods, reports] = company
    ? await Promise.all([
        listAccounts(company.id),
        listMappings(company.id),
        listDimensions('locations', company.id),
        listDimensions('classes', company.id),
        listSnapshotPeriods(company.id, 'ProfitAndLoss'),
        listReports(company.id, 1),
      ])
    : [[], [], [], [], [], []];

  const pendingMappings = mappings.filter((m) => !m.approved).length;
  const isDemo = company?.isDemo ?? false;

  const steps: Step[] = [
    {
      id: 1,
      title: 'Connect QuickBooks',
      description: 'Authorise read-only access to your QuickBooks Online company.',
      done: Boolean(connection) || isDemo,
      detail: connection ? (
        <p className="text-xs text-ink-muted">
          Connected to realm {connection.realmId} ({connection.environment}).
        </p>
      ) : isDemo ? (
        <p className="text-xs text-ink-muted">Using the synthetic demo company — no QuickBooks needed.</p>
      ) : !isQuickBooksConfigured() ? (
        <p className="text-xs text-warning">
          Intuit credentials are not configured. See docs/QUICKBOOKS_SETUP.md.
        </p>
      ) : null,
      action:
        connection || isDemo ? null : (
          <div className="flex flex-wrap gap-2">
            <Button asChild disabled={!isQuickBooksConfigured()}>
              <a href={company ? `/api/quickbooks/connect?company=${company.id}&redirect=/onboarding` : '/api/quickbooks/connect?redirect=/onboarding'}>
                Connect QuickBooks
              </a>
            </Button>
            {env().DEMO_MODE ? (
              <ActionButton
                endpoint="/api/demo/seed"
                body={{ months: 24, generateReport: true }}
                variant="secondary"
                pendingLabel="Building demo company…"
              >
                Use demo data instead
              </ActionButton>
            ) : null}
          </div>
        ),
    },
    {
      id: 2,
      title: 'Confirm the company',
      description: 'Check that the connected company is the one you expect.',
      done: Boolean(company),
      detail: company ? (
        <p className="text-xs text-ink-muted">
          {company.name}
          {connection?.companyName && connection.companyName !== company.name
            ? ` (QuickBooks reports "${connection.companyName}")`
            : ''}
          {isDemo ? ' — demo company' : ''}
        </p>
      ) : null,
      action: company ? (
        <Button variant="outline" asChild>
          <Link href="/settings">Company settings</Link>
        </Button>
      ) : null,
    },
    {
      id: 3,
      title: 'Choose the history to import',
      description: 'Twenty-four months is the default; comparisons need at least thirteen.',
      done: periods.length > 0,
      detail:
        periods.length > 0 ? (
          <p className="text-xs text-ink-muted">
            {periods.length} month(s) stored, {periods[0]?.start.slice(0, 7)} to{' '}
            {periods[periods.length - 1]?.start.slice(0, 7)}.
          </p>
        ) : null,
      action:
        company && !isDemo ? (
          <div className="max-w-sm">
            <ImportHistoryPanel companyId={company.id} connected={Boolean(connection)} />
          </div>
        ) : null,
    },
    {
      id: 4,
      title: 'Review account mappings',
      description: 'Confirm how QuickBooks accounts roll into management categories.',
      done: accounts.length > 0 && pendingMappings === 0,
      detail:
        accounts.length === 0 ? (
          <p className="text-xs text-ink-muted">Waiting on the chart of accounts.</p>
        ) : (
          <p className="text-xs text-ink-muted">
            {accounts.length} accounts imported · {pendingMappings} suggestion(s) awaiting approval.
          </p>
        ),
      action:
        accounts.length > 0 ? (
          <Button variant="outline" asChild>
            <Link href="/settings/account-mapping">Review mappings</Link>
          </Button>
        ) : null,
    },
    {
      id: 5,
      title: 'Review locations and classes',
      description: 'Name your stores so store-level reporting reads the way you talk about them.',
      done: locations.length > 0 || classes.length > 0 || (company?.trackingDimension === 'none'),
      detail: (
        <p className="text-xs text-ink-muted">
          {locations.length} location(s) and {classes.length} class(es) found.
          {locations.length === 0 && classes.length === 0
            ? ' Store-level reporting will be unavailable until one is enabled in QuickBooks.'
            : ''}
        </p>
      ),
      action: (
        <Button variant="outline" asChild>
          <Link href="/settings/locations">Review locations</Link>
        </Button>
      ),
    },
    {
      id: 6,
      title: 'Import historical data',
      description: 'Builds the monthly snapshots every comparison and trend depends on.',
      done: periods.length >= 3,
      detail:
        periods.length > 0 ? (
          <p className="text-xs text-ink-muted">{periods.length} month(s) of snapshots stored.</p>
        ) : (
          <p className="text-xs text-ink-muted">No months imported yet.</p>
        ),
    },
    {
      id: 7,
      title: 'Generate your first CFO report',
      description: 'Runs the metric engine, the anomaly rules and the CFO analysis.',
      done: reports.some((r) => r.status === 'completed'),
      detail: reports[0] ? (
        <p className="text-xs text-ink-muted">
          Latest: {reports[0].title} ({reports[0].status}).
        </p>
      ) : null,
      action:
        company && ctx.availablePeriods.length > 0 ? (
          <div className="max-w-sm">
            {reports[0]?.status === 'completed' ? (
              <Button asChild>
                <Link href={`/reports/${reports[0].id}`}>Open the report</Link>
              </Button>
            ) : (
              <GenerateReportPanel
                companyId={company.id}
                periods={ctx.availablePeriods}
                defaultPeriod={ctx.period.start.slice(0, 7)}
                canSync={!isDemo}
              />
            )}
          </div>
        ) : null,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const progress = Math.round((completed / steps.length) * 100);

  return (
    <>
      <PageHeader
        title="Get set up"
        description="Seven steps from an empty workspace to your first monthly CFO report."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/dashboard">Skip to dashboard</Link>
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="py-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {completed} of {steps.length} steps complete
            </span>
            <span className="tnum text-ink-muted">{progress}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding progress"
          >
            <div className="h-full rounded-full bg-navy-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.id}>
            <Card className={step.done ? 'border-positive/30' : ''}>
              <CardContent className="flex flex-wrap items-start gap-4 py-4">
                <div
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    step.done ? 'bg-positive-soft text-positive' : 'bg-surface-muted text-ink-muted'
                  }`}
                >
                  {step.done ? '✓' : step.id}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-navy-800">{step.title}</h2>
                    {step.done ? <Badge variant="positive">Done</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{step.description}</p>
                  {step.detail ? <div className="mt-1.5">{step.detail}</div> : null}
                  {step.action ? <div className="mt-3">{step.action}</div> : null}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
