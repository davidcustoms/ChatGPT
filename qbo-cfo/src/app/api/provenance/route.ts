import { handler } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { accountIndex } from '@/lib/db/repositories/masterdata';
import { effectiveMappingIndex } from '@/lib/db/repositories/mappings';
import { getAccountMetrics, getMonthlyMetrics } from '@/lib/db/repositories/metrics';
import { getSnapshot } from '@/lib/db/repositories/snapshots';
import { transactionsForAccount } from '@/lib/db/repositories/transactions';
import { AppError } from '@/lib/errors';
import { basisLabel } from '@/lib/finance/basis';
import { buildProvenance, describeProvenance } from '@/lib/reports/provenance';
import { monthPeriodOf } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';

/**
 * "How was this calculated?"
 *
 * Returns the full derivation of one metric for one period: the formula, the
 * source QuickBooks report and the snapshot it came from, the contributing
 * accounts with their QuickBooks ids, and — where the figure decomposes to
 * postings — the underlying transactions.
 */
export async function GET(request: Request) {
  return handler(async () => {
    const url = new URL(request.url);
    const { company } = await requireCompany(url.searchParams.get('company'));
    const metricKey = url.searchParams.get('metric');
    const periodParam = url.searchParams.get('period');

    if (!metricKey || !periodParam || !/^\d{4}-\d{2}$/.test(periodParam)) {
      throw new AppError('VALIDATION', 'metric and period (YYYY-MM) are required.');
    }
    const period = monthPeriodOf(`${periodParam}-01`);

    const metrics = await getMonthlyMetrics(company.id, period);
    if (!metrics) {
      throw new AppError('QBO_EMPTY_PERIOD', `No stored metrics for ${periodParam}.`);
    }

    const provenance = buildProvenance(metricKey, metrics);
    if (!provenance) {
      throw new AppError('VALIDATION', `No provenance is defined for metric "${metricKey}".`);
    }

    const [accountRows, accounts, mapping] = await Promise.all([
      getAccountMetrics(company.id, period),
      accountIndex(company.id),
      effectiveMappingIndex(company.id),
    ]);

    // Which accounts contributed, by management category or by account type.
    const contributing = accountRows.filter((row) => {
      const category = row.categoryKey ?? mapping.get(row.accountQboId) ?? null;
      if (provenance.categoryKeys.length > 0 && category) {
        return provenance.categoryKeys.includes(category);
      }
      if (provenance.accountTypes.length > 0) {
        const type = accounts.get(row.accountQboId)?.accountType ?? null;
        return type !== null && provenance.accountTypes.includes(type);
      }
      return false;
    });

    // The exact snapshot the figure was read out of.
    const snapshotType = provenance.sourceReport?.includes('Balance') ? 'BalanceSheet' : 'ProfitAndLoss';
    const snapshot = await getSnapshot(
      company.id,
      snapshotType,
      period,
      'total',
      metrics.accountingMethod,
    );

    const accountIds = contributing
      .map((r) => r.accountQboId)
      .filter((id) => !id.startsWith('__'));
    const transactions =
      provenance.drilldownCategoryKey && accountIds.length > 0
        ? await transactionsForAccount(company.id, accountIds, period, 100)
        : [];

    return {
      metric: {
        key: provenance.metricKey,
        label: provenance.label,
        value: provenance.value,
        kind: provenance.kind,
        formula: provenance.formula,
        note: provenance.note,
      },
      summary: describeProvenance(provenance),
      period: { start: period.start, end: period.end, label: periodParam },
      basis: { method: metrics.accountingMethod, label: basisLabel(metrics.accountingMethod) },
      source: {
        report: provenance.sourceReport,
        system: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
        snapshotId: snapshot?.id ?? null,
        snapshotFetchedAt: snapshot?.fetchedAt ?? null,
        realmScoped: !company.isDemo,
      },
      derivedFrom: provenance.derivedFrom,
      categories: provenance.categoryKeys,
      accountTypes: provenance.accountTypes,
      dimensionFilter: provenance.dimensionFilter,
      accounts: contributing
        .map((r) => ({
          qboId: r.accountQboId,
          name: r.accountName,
          accountNumber: accounts.get(r.accountQboId)?.accountNumber ?? null,
          accountType: accounts.get(r.accountQboId)?.accountType ?? null,
          accountSubType: accounts.get(r.accountQboId)?.accountSubType ?? null,
          categoryKey: r.categoryKey ?? mapping.get(r.accountQboId) ?? null,
          amount: r.amount,
        }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      transactions: transactions.map((t) => ({
        qboId: t.qboId,
        type: t.txnType,
        date: t.txnDate,
        docNumber: t.docNumber,
        entity: t.entityName,
        account: t.accountName,
        amount: t.lineAmount,
      })),
      /** Present when the figure comes from a QuickBooks subtotal rather than our own sum. */
      reconciliationNote:
        provenance.kind === 'quickbooks_subtotal'
          ? "This figure is QuickBooks' own subtotal, taken as reported. It should tie exactly to the same line in QuickBooks."
          : provenance.kind === 'category_rollup'
            ? 'This figure is the sum of accounts mapped to the listed categories. It ties to QuickBooks only if mapping coverage for those categories is complete.'
            : null,
    };
  });
}
