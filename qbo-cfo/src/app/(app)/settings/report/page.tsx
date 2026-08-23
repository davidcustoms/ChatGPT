import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { getBranding, getSchedule } from '@/lib/db/repositories/companies';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { BrandingForm } from './branding-form';
import { ScheduleForm } from './schedule-form';

export const dynamic = 'force-dynamic';

export default async function ReportSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  const company = ctx.company;
  if (!company) {
    return (
      <>
        <PageHeader title="Report settings" />
        <EmptyState title="No company yet" description="Connect QuickBooks or load the demo company first." />
      </>
    );
  }

  const [branding, schedule] = await Promise.all([getBranding(company.id), getSchedule(company.id)]);
  const cronConfigured = Boolean(env().CRON_SECRET);

  return (
    <>
      <PageHeader
        title="Report branding and schedule"
        description="Controls how the monthly report looks and when it is generated."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">All settings</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>Applied to the on-screen report, the PDF and the Excel workbook.</CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingForm companyId={company.id} initial={branding} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduled reports</CardTitle>
            <CardDescription>
              Runs the full monthly close: refresh the token, pull the closed month, recompute metrics, run the
              anomaly rules, produce the CFO analysis, then save the report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!cronConfigured ? (
              <InfoNotice>
                CRON_SECRET is not set, so the scheduler endpoint is disabled. Set it and point your scheduler at{' '}
                <code>POST /api/cron/monthly</code> with an <code>Authorization: Bearer</code> header.
              </InfoNotice>
            ) : null}
            <ScheduleForm companyId={company.id} initial={schedule} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
