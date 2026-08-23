import { handler } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { getAccountMetrics } from '@/lib/db/repositories/metrics';
import { effectiveMappingIndex } from '@/lib/db/repositories/mappings';
import { accountIndex, listDimensions } from '@/lib/db/repositories/masterdata';
import { transactionsForAccount } from '@/lib/db/repositories/transactions';
import { AppError } from '@/lib/errors';
import { categoryLabel } from '@/lib/finance/categories';
import { monthPeriodOf } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';

/**
 * Source traceability.
 *
 * Given a management category and a month, returns the contributing accounts
 * and the underlying transactions with their QuickBooks ids, so an owner or
 * their accountant can verify any figure in the report.
 */
export async function GET(request: Request) {
  return handler(async () => {
    const url = new URL(request.url);
    const { company } = await requireCompany(url.searchParams.get('company'));
    const categoryKey = url.searchParams.get('category');
    const periodParam = url.searchParams.get('period');
    if (!categoryKey || !periodParam || !/^\d{4}-\d{2}$/.test(periodParam)) {
      throw new AppError('VALIDATION', 'category and period (YYYY-MM) are required.');
    }
    const period = monthPeriodOf(`${periodParam}-01`);

    const [accountRows, mapping, accounts, locations] = await Promise.all([
      getAccountMetrics(company.id, period),
      effectiveMappingIndex(company.id),
      accountIndex(company.id),
      listDimensions('locations', company.id),
    ]);

    const contributing = accountRows.filter(
      (r) => (r.categoryKey ?? mapping.get(r.accountQboId) ?? null) === categoryKey,
    );
    const accountIds = contributing.map((r) => r.accountQboId).filter((id) => !id.startsWith('__'));
    const transactions = await transactionsForAccount(company.id, accountIds, period, 300);
    const locationByQboId = new Map(locations.map((l) => [l.qboId, l.displayName ?? l.name]));

    return {
      category: { key: categoryKey, label: categoryLabel(categoryKey) },
      period: { start: period.start, end: period.end },
      total: contributing.reduce((a, r) => a + r.amount, 0),
      accounts: contributing.map((r) => ({
        qboId: r.accountQboId,
        name: r.accountName,
        accountType: accounts.get(r.accountQboId)?.accountType ?? null,
        accountNumber: accounts.get(r.accountQboId)?.accountNumber ?? null,
        amount: r.amount,
      })),
      transactions: transactions.map((t) => ({
        qboId: t.qboId,
        type: t.txnType,
        date: t.txnDate,
        docNumber: t.docNumber,
        vendor: t.entityName,
        memo: t.memo,
        account: t.accountName,
        location: t.locationQboId ? (locationByQboId.get(t.locationQboId) ?? null) : null,
        amount: t.lineAmount,
      })),
      source: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
    };
  });
}
