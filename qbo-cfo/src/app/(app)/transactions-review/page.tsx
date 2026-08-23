import { getPageContext, param, type SearchParams } from '@/lib/page-context';
import { env } from '@/lib/env';
import { buildReviewQueue } from '@/lib/finance/review-service';
import { monthLabel } from '@/lib/util/dates';
import { formatCurrency, formatDate } from '@/lib/util/format';
import { Badge, severityVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader, DataProvenance } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/layout/period-picker';
import { NoDataState } from '@/components/layout/no-data';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['CRITICAL', 'IMPORTANT', 'WATCH', 'INFO'] as const;

export default async function TransactionsReviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getPageContext(sp);
  if (!ctx.company || !ctx.hasData) {
    return (
      <>
        <PageHeader title="Transactions needing attention" />
        <NoDataState demoEnabled={env().DEMO_MODE} hasCompany={Boolean(ctx.company)} />
      </>
    );
  }

  const company = ctx.company;
  const severityFilter = param(sp, 'severity');
  const largeThreshold = Math.max(company.materialityAmount * 10, 5000);
  const { flagged, scanned, uncategorizedAccounts } = await buildReviewQueue({
    companyId: company.id,
    period: ctx.period,
    largeThreshold,
  });

  const rows = severityFilter ? flagged.filter((f) => f.severity === severityFilter) : flagged;
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, flagged.filter((f) => f.severity === s).length]),
  ) as Record<(typeof SEVERITIES)[number], number>;

  return (
    <>
      <PageHeader
        title="Transactions needing attention"
        description={<DataProvenance dataThrough={ctx.dataThrough} source={ctx.sourceLabel} />}
        actions={<PeriodPicker periods={ctx.availablePeriods} active={ctx.period.start.slice(0, 7)} />}
      />

      <InfoNotice className="mb-4">
        This page is for review only. Nothing here changes, categorises or posts anything in QuickBooks — fixes
        are made in QuickBooks by you or your bookkeeper. {scanned} transactions in {monthLabel(ctx.period)} were
        scanned against a {formatCurrency(largeThreshold)} large-transaction threshold.
      </InfoNotice>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {SEVERITIES.map((s) => (
          <Card key={s}>
            <CardContent className="py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{s}</p>
              <p className="mt-1 text-2xl font-semibold tnum text-navy-800">{counts[s]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {uncategorizedAccounts.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Uncategorised accounts with activity this month</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {Array.from(new Set(uncategorizedAccounts)).map((name) => (
                <li key={name}>
                  <Badge variant="warning">{name}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Flagged transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing flagged"
              description={`No transactions in ${monthLabel(ctx.period)} matched the review rules.`}
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Severity</TH>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Payee</TH>
                    <TH>Account</TH>
                    <TH>Location</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Why it is flagged</TH>
                    <TH>QuickBooks ID</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.slice(0, 200).map((t) => (
                    <TR key={t.id}>
                      <TD>
                        <Badge variant={severityVariant(t.severity)}>{t.severity}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{formatDate(t.txnDate)}</TD>
                      <TD className="text-xs">{t.txnType}</TD>
                      <TD className="max-w-[14rem] truncate">{t.entityName ?? '—'}</TD>
                      <TD className="max-w-[12rem] truncate text-xs text-ink-muted">{t.accountName ?? '—'}</TD>
                      <TD className="text-xs text-ink-muted">{t.locationName ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-right tnum font-medium">
                        {formatCurrency(t.amount, { currency: company.currencyCode })}
                      </TD>
                      <TD className="max-w-[22rem]">
                        <ul className="space-y-0.5 text-xs text-ink-muted">
                          {t.reasons.map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </TD>
                      <TD className="font-mono text-[11px] text-ink-subtle">{t.qboId}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </>
  );
}
