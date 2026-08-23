import Link from 'next/link';
import { getPageContext, type SearchParams } from '@/lib/page-context';
import { listAccounts } from '@/lib/db/repositories/masterdata';
import { listCategories, listMappings } from '@/lib/db/repositories/mappings';
import { getAccountMetrics } from '@/lib/db/repositories/metrics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState, InfoNotice } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { MappingTable } from './mapping-table';

export const dynamic = 'force-dynamic';

const MAPPABLE_TYPES = new Set(['Income', 'Other Income', 'Expense', 'Other Expense', 'Cost of Goods Sold']);

export default async function AccountMappingPage({
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
        <PageHeader title="Account mappings" />
        <EmptyState title="No company yet" description="Connect QuickBooks or load the demo company first." />
      </>
    );
  }

  const [accounts, mappings, categories, monthAmounts] = await Promise.all([
    listAccounts(company.id),
    listMappings(company.id),
    listCategories(company.id),
    getAccountMetrics(company.id, ctx.period),
  ]);

  const mappingByAccount = new Map(mappings.map((m) => [m.accountQboId, m]));
  const amountByAccount = new Map(monthAmounts.map((a) => [a.accountQboId, a.amount]));

  const rows = accounts
    .filter((a) => a.accountType && MAPPABLE_TYPES.has(a.accountType))
    .map((a) => {
      const mapping = mappingByAccount.get(a.qboId);
      return {
        accountQboId: a.qboId,
        accountName: a.fullyQualifiedName ?? a.name,
        accountNumber: a.accountNumber,
        accountType: a.accountType ?? '',
        accountSubType: a.accountSubType,
        isActive: a.isActive,
        categoryKey: mapping?.categoryKey ?? null,
        confidence: mapping?.confidence ?? null,
        approved: mapping?.approved ?? false,
        source: mapping?.source ?? null,
        suggestedReason: mapping?.suggestedReason ?? null,
        currentMonthAmount: amountByAccount.get(a.qboId) ?? 0,
      };
    })
    .sort((a, b) => Math.abs(b.currentMonthAmount) - Math.abs(a.currentMonthAmount));

  const pending = rows.filter((r) => r.categoryKey && !r.approved).length;
  const unmapped = rows.filter((r) => !r.categoryKey).length;

  return (
    <>
      <PageHeader
        title="Account mappings"
        description="Map QuickBooks accounts to management categories. Reports read categories, never account names, so renaming an account in QuickBooks never breaks a report."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/settings">All settings</Link>
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No chart of accounts imported"
          description="Connect QuickBooks and run a sync to import the chart of accounts."
          action={
            <Button asChild>
              <Link href="/settings/quickbooks">Open QuickBooks settings</Link>
            </Button>
          }
        />
      ) : (
        <>
          <InfoNotice className="mb-4">
            {pending} suggested mapping(s) await your approval and {unmapped} account(s) are unmapped. Suggestions
            below 90% confidence are <strong>not</strong> applied to any report until you approve them, so an
            uncertain guess never moves money between categories. Amounts shown are for{' '}
            {ctx.period.start.slice(0, 7)}.
          </InfoNotice>

          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>
                {rows.length} income, COGS and expense accounts. Changing a mapping recomputes every stored month
                from existing snapshots — no QuickBooks call is required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MappingTable
                companyId={company.id}
                rows={rows}
                categories={categories}
                currency={company.currencyCode}
              />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
