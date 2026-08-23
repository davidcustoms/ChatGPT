import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ActionButton } from '@/components/ui/action-button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * First-run empty state. Offers the two ways to get data into the product:
 * connect a real QuickBooks company, or load the synthetic demo company.
 */
export function NoDataState({
  demoEnabled,
  hasCompany,
}: {
  demoEnabled: boolean;
  hasCompany: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10">
        <div className="mx-auto max-w-lg text-center">
          <h2 className="text-base font-semibold text-navy-800">No financial data yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {hasCompany
              ? 'This company has no imported months. Connect QuickBooks and run a historical import, or explore the product with synthetic demo data.'
              : 'Get started by connecting a QuickBooks Online company, or explore the product with synthetic demo data.'}
          </p>
          <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
            <Button asChild>
              <Link href="/onboarding">Start onboarding</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/quickbooks/connect">Connect QuickBooks</a>
            </Button>
            {demoEnabled ? (
              <ActionButton
                endpoint="/api/demo/seed"
                body={{ months: 24, generateReport: true }}
                variant="secondary"
                pendingLabel="Building demo company…"
              >
                Load demo company
              </ActionButton>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-ink-subtle">
            Demo data is synthetic and clearly labelled. It never touches a real QuickBooks company.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
