import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { listDimensions } from '@/lib/db/repositories/masterdata';
import { getLocationMetrics } from '@/lib/db/repositories/metrics';
import { formatCurrency } from '@/lib/util/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { LocationEditor } from './location-editor';

export const dynamic = 'force-dynamic';

export default async function LocationSettingsPage({
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
        <PageHeader title="Stores and locations" />
        <EmptyState title="No company yet" description="Connect QuickBooks or load the demo company first." />
      </>
    );
  }

  const [locations, classes, metrics] = await Promise.all([
    listDimensions('locations', company.id),
    listDimensions('classes', company.id),
    getLocationMetrics(company.id, ctx.period),
  ]);

  const revenueByName = new Map(metrics.map((m) => [m.dimensionName, m.netSales]));

  return (
    <>
      <PageHeader
        title="Stores and locations"
        description="Name your stores for reporting and choose which QuickBooks dimension represents them."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">All settings</Link>
          </Button>
        }
      />

      <InfoNotice className="mb-4">
        Store-level results come from the QuickBooks Location (Department) or Class dimension. The active choice is{' '}
        <strong>{company.trackingDimension}</strong> — change it in{' '}
        <Link className="underline underline-offset-2" href="/settings">
          Company settings
        </Link>
        . Renaming a store here affects reports only; QuickBooks is never modified.
      </InfoNotice>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>QuickBooks Locations (Departments)</CardTitle>
            <CardDescription>{locations.length} location(s) imported.</CardDescription>
          </CardHeader>
          <CardContent>
            {locations.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No locations found. Enable Locations in QuickBooks (Account and Settings → Advanced → Categories)
                and re-sync, or use Classes instead.
              </p>
            ) : (
              <LocationEditor
                companyId={company.id}
                rows={locations.map((l) => ({
                  qboId: l.qboId,
                  name: l.name,
                  displayName: l.displayName ?? null,
                  isStore: l.isStore ?? true,
                  isActive: l.isActive,
                  revenue: revenueByName.get(l.displayName ?? l.name) ?? null,
                }))}
                currency={company.currencyCode}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QuickBooks Classes</CardTitle>
            <CardDescription>{classes.length} class(es) imported.</CardDescription>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <p className="text-sm text-ink-muted">No classes found in this QuickBooks company.</p>
            ) : (
              <ul className="space-y-2">
                {classes.map((c) => (
                  <li key={c.qboId} className="flex items-center justify-between gap-3 text-sm">
                    <span>{c.fullyQualifiedName ?? c.name}</span>
                    <Badge variant={c.isActive ? 'default' : 'outline'}>
                      {c.isActive ? 'active' : 'inactive'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {metrics.length > 0 ? (
        <p className="mt-4 text-xs text-ink-subtle">
          {metrics.length} segment(s) had activity in {ctx.period.start.slice(0, 7)}, totalling{' '}
          {formatCurrency(
            metrics.reduce((a, m) => a + m.netSales, 0),
            { currency: company.currencyCode },
          )}{' '}
          of revenue.
        </p>
      ) : null}
    </>
  );
}
