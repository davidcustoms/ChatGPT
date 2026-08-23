import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { getSchedule } from '@/lib/db/repositories/companies';
import { countUnmappedExpenseAccounts } from '@/lib/db/repositories/mappings';
import { listAudit } from '@/lib/db/repositories/audit';
import { formatCurrency, formatDateTime, formatPercent } from '@/lib/util/format';
import { monthName } from '@/lib/util/dates';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { CompanySettingsForm } from './company-form';

export const dynamic = 'force-dynamic';

const PAGES = [
  { href: '/settings/quickbooks', title: 'QuickBooks connection', description: 'Connect, reconnect, disconnect and import history.' },
  { href: '/settings/account-mapping', title: 'Account mappings', description: 'Map QuickBooks accounts to management categories.' },
  { href: '/settings/locations', title: 'Stores and locations', description: 'Name your stores and choose the tracking dimension.' },
  { href: '/settings/alerts', title: 'Anomaly thresholds', description: 'Tune what counts as unusual for your business.' },
  { href: '/settings/report', title: 'Report branding and schedule', description: 'Branding, scheduled reports and data retention.' },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  const company = ctx.company;

  if (!company) {
    return (
      <>
        <PageHeader title="Settings" />
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-muted">
            No company yet.{' '}
            <Link className="text-navy-700 underline-offset-2 hover:underline" href="/onboarding">
              Start onboarding
            </Link>{' '}
            to create one.
          </CardContent>
        </Card>
      </>
    );
  }

  const [schedule, unmapped, audit] = await Promise.all([
    getSchedule(company.id),
    countUnmappedExpenseAccounts(company.id),
    listAudit(company.id, 25),
  ]);

  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${company.name}.`} />

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-navy-200 hover:bg-navy-50/40"
          >
            <p className="text-sm font-semibold text-navy-800">{p.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{p.description}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company settings</CardTitle>
            <CardDescription>
              Fiscal year, currency, tracking dimension and the materiality thresholds used throughout the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompanySettingsForm
              companyId={company.id}
              initial={{
                name: company.name,
                fiscalYearStartMonth: company.fiscalYearStartMonth,
                currencyCode: company.currencyCode,
                trackingDimension: company.trackingDimension,
                materialityAmount: company.materialityAmount,
                materialityPct: company.materialityPct,
                accountingMethod: company.accountingMethod,
              }}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {[
                  ['Reporting basis', `${company.accountingMethod} basis`],
                  ['Fiscal year starts', monthName(company.fiscalYearStartMonth)],
                  ['Currency', company.currencyCode],
                  ['Tracking dimension', company.trackingDimension],
                  ['Materiality (dollar)', formatCurrency(company.materialityAmount, { currency: company.currencyCode })],
                  ['Materiality (percent)', formatPercent(company.materialityPct)],
                  ['Scheduled reports', schedule.enabled ? `Day ${schedule.dayOfMonth} of each month` : 'Disabled'],
                  ['Data retention', `${schedule.retentionMonths} months`],
                  ['Unmapped expense accounts', String(unmapped)],
                  ['Demo company', company.isDemo ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Data syncs, report generation, exports and connection changes.</CardDescription>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="text-sm text-ink-muted">No activity recorded yet.</p>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Action</TH>
                        <TH>Outcome</TH>
                        <TH>When</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {audit.map((a) => (
                        <TR key={a.id}>
                          <TD className="text-xs">{a.action}</TD>
                          <TD>
                            <Badge variant={a.outcome === 'success' ? 'positive' : 'negative'}>{a.outcome}</Badge>
                          </TD>
                          <TD className="whitespace-nowrap text-xs text-ink-muted">
                            {formatDateTime(a.created_at.toISOString())}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
