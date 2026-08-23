import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { lastClosedMonth, monthLabel } from '@/lib/util/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/states';
import { LiveValidationRunner } from './runner';

export const dynamic = 'force-dynamic';

/**
 * Live QuickBooks validation.
 *
 * Strictly read-only against QuickBooks: the page runs GET requests, and the
 * only writes are to this application's own database. The banner says so on
 * every render, because someone looking at this screen is looking at real
 * company data and should never have to wonder.
 */
export default async function LiveQboValidationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getPageContext(await searchParams);
  const environment = env().INTUIT_ENVIRONMENT;
  const closed = lastClosedMonth();

  const periods =
    ctx.availablePeriods.length > 0
      ? ctx.availablePeriods
      : [{ value: closed.start.slice(0, 7), label: monthLabel(closed) }];

  return (
    <>
      <ReadOnlyBanner environment={environment} />

      <PageHeader
        title="Live QuickBooks validation"
        description="Proves that this application, pointed at your real QuickBooks company, produces the figures the QuickBooks UI shows."
      />

      {!ctx.company ? (
        <EmptyState
          title="No company selected"
          description="Connect QuickBooks before running the live validation."
          action={
            <Button asChild>
              <Link href="/settings/quickbooks">Go to Settings → QuickBooks</Link>
            </Button>
          }
        />
      ) : !ctx.connection ? (
        <EmptyState
          title="QuickBooks is not connected"
          description="Production OAuth needs a person at Intuit's consent screen and cannot be automated. Follow docs/INTUIT_PRODUCTION_SETUP.md, then come back here."
          action={
            <Button asChild>
              <Link href="/settings/quickbooks">Connect QuickBooks</Link>
            </Button>
          }
        />
      ) : (
        <LiveValidationRunner
          companyId={ctx.company.id}
          periods={periods}
          defaultPeriod={periods[0]?.value ?? closed.start.slice(0, 7)}
          initialRun={null}
        />
      )}
    </>
  );
}

function ReadOnlyBanner({ environment }: { environment: 'sandbox' | 'production' }) {
  const live = environment === 'production';
  return (
    <div
      className={
        live
          ? 'mb-5 rounded-[var(--radius-card)] border border-warning bg-warning-soft px-4 py-3'
          : 'mb-5 rounded-[var(--radius-card)] border border-border bg-surface-muted px-4 py-3'
      }
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={live ? 'warning' : 'default'}>
          {live ? 'LIVE QUICKBOOKS — READ ONLY' : 'SANDBOX — READ ONLY'}
        </Badge>
        <span className="text-sm text-ink">
          {live
            ? 'Connected to a production QuickBooks company.'
            : 'Connected to the Intuit sandbox. Sandbox results do not validate production behaviour.'}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        This application issues <strong>GET</strong> requests only. Mutating endpoints and any statement that is not a{' '}
        <code>SELECT</code> are refused before a request is built, so nothing on this page can change your books. The
        only writes are to this application&rsquo;s own database.
      </p>
    </div>
  );
}
