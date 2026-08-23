import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { listThresholds } from '@/lib/db/repositories/anomalies';
import { RULE_DEFINITIONS, resolveThresholds } from '@/lib/finance/anomaly-rules';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { ThresholdEditor } from './threshold-editor';

export const dynamic = 'force-dynamic';

export default async function AlertSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  const company = ctx.company;
  if (!company) {
    return (
      <>
        <PageHeader title="Anomaly thresholds" />
        <EmptyState title="No company yet" description="Connect QuickBooks or load the demo company first." />
      </>
    );
  }

  const overrides = await listThresholds(company.id);
  const resolved = resolveThresholds(overrides);

  const rules = RULE_DEFINITIONS.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    category: r.category,
    paramLabels: r.paramLabels,
    defaults: r.params,
    enabled: resolved.get(r.key)?.enabled ?? true,
    params: resolved.get(r.key)?.params ?? r.params,
  }));

  const grouped = rules.reduce<Record<string, typeof rules>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Anomaly thresholds"
        description="Every alert is a deterministic rule evaluated against your stored figures — not a model's opinion. Tune the thresholds to match how your business actually moves."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">All settings</Link>
          </Button>
        }
      />

      <InfoNotice className="mb-4">
        Thresholds take effect the next time a report is generated for a period. Percentage values are ratios:
        0.10 means 10%; 0.02 in a percentage-point field means 2 points.
      </InfoNotice>

      <div className="space-y-4">
        {Object.entries(grouped).map(([category, items]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{category}</CardTitle>
              <CardDescription>{items.length} rule(s)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((rule) => (
                <ThresholdEditor key={rule.key} companyId={company.id} rule={rule} />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
