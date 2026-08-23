import { createCompany, listCompaniesForUser, saveBranding } from '../db/repositories/companies';
import {
  upsertAccounts,
  upsertCustomers,
  upsertDimensions,
  upsertItems,
  upsertVendors,
} from '../db/repositories/masterdata';
import { insertSuggestionsIfMissing, upsertMappings } from '../db/repositories/mappings';
import { saveAging, saveVendorSpend } from '../db/repositories/metrics';
import { saveSnapshot } from '../db/repositories/snapshots';
import { upsertTransactions, vendorSpendFromTransactions } from '../db/repositories/transactions';
import { createJob, finishJob, updateJobProgress } from '../db/repositories/jobs';
import { recordAudit } from '../db/repositories/audit';
import { suggestAll } from '../finance/mapping';
import { parseAgingSummary } from '../qbo/statements';
import { flattenReport } from '../qbo/parse';
import { recomputeMonth } from '../qbo/sync';
import { lastClosedMonth } from '../util/dates';
import { DEMO_ACCOUNTS, DEMO_CUSTOMERS, DEMO_STORES, DEMO_VENDORS } from './chart-of-accounts';
import { generateDemoData } from './generator';
import { logger } from '../logger';

export const DEMO_COMPANY_NAME = 'Harborline Furniture Co. (Demo)';

/**
 * Creates (or refreshes) the demo company.
 *
 * Demo data is synthetic and clearly labelled. It flows through the same
 * snapshot -> parse -> metric pipeline as real QuickBooks data so the demo is
 * a genuine exercise of the product, not a set of hard-coded screens.
 */
export async function seedDemoCompany(input: {
  userId: string;
  months?: number;
}): Promise<{ companyId: string; months: number }> {
  const months = Math.max(6, Math.min(36, input.months ?? 24));

  const existing = (await listCompaniesForUser(input.userId)).find((c) => c.isDemo);
  const company =
    existing ??
    (await createCompany({
      ownerUserId: input.userId,
      name: DEMO_COMPANY_NAME,
      legalName: 'Harborline Furniture Company, LLC',
      country: 'US',
      currencyCode: 'USD',
      isDemo: true,
    }));

  const jobId = await createJob({
    companyId: company.id,
    jobType: 'demo_seed',
    progressTotal: months + 1,
    monthsRequested: months,
    triggeredBy: 'manual',
    requestedBy: input.userId,
  });

  try {
    await upsertAccounts(company.id, DEMO_ACCOUNTS);
    await upsertVendors(
      company.id,
      DEMO_VENDORS.map((name, i) => ({ qboId: String(i + 1), name })),
    );
    await upsertCustomers(
      company.id,
      DEMO_CUSTOMERS.map((name, i) => ({ qboId: String(100 + i), name })),
    );
    await upsertDimensions(
      'locations',
      company.id,
      DEMO_STORES.map((s) => ({ qboId: s.qboId, name: s.name, fullyQualifiedName: s.name })),
    );
    await upsertItems(company.id, [
      { qboId: 'i1', name: 'Sectional Sofa - Linen', itemType: 'Inventory', qtyOnHand: 42, unitPrice: 1899 },
      { qboId: 'i2', name: 'Queen Mattress - Hybrid', itemType: 'Inventory', qtyOnHand: 118, unitPrice: 1199 },
      { qboId: 'i3', name: 'Dining Set - Oak 7pc', itemType: 'Inventory', qtyOnHand: 24, unitPrice: 2499 },
      { qboId: 'i4', name: 'Recliner - Leather', itemType: 'Inventory', qtyOnHand: -3, unitPrice: 1099 },
      { qboId: 'i5', name: 'Area Rug 8x10', itemType: 'Inventory', qtyOnHand: 76, unitPrice: 349 },
    ]);

    // Auto-map high-confidence accounts; leave the rest for owner approval.
    const suggestions = suggestAll(DEMO_ACCOUNTS);
    await insertSuggestionsIfMissing(
      company.id,
      suggestions.map((s) => ({
        accountQboId: s.accountQboId,
        categoryKey: s.categoryKey,
        confidence: s.confidence,
        reason: s.reason,
      })),
    );
    // The demo pre-approves the mappings a new owner would confirm in onboarding,
    // except the deliberately ambiguous "Uncategorized Expense" account.
    await upsertMappings(
      company.id,
      suggestions
        .filter((s) => s.accountQboId !== '7900')
        .map((s) => ({
          accountQboId: s.accountQboId,
          categoryKey: s.categoryKey,
          confidence: s.confidence,
          source: 'suggested' as const,
          approved: true,
          suggestedReason: s.reason,
        })),
    );

    await saveBranding(company.id, {
      businessName: 'Harborline Furniture Co.',
      reportTitleTemplate: '{month} {year} Executive Financial Report',
      primaryColor: '#1e3a5f',
      footerText: 'Demonstration data — not an actual business.',
      confidential: true,
    });

    await updateJobProgress(jobId, { current: 1, step: 'Master data' });

    const data = generateDemoData({ months, endPeriod: lastClosedMonth() });

    for (let i = 0; i < data.length; i += 1) {
      const month = data[i];
      if (!month) continue;
      const { period } = month;

      await saveSnapshot({ companyId: company.id, reportType: 'ProfitAndLoss', period, payload: month.pnl });
      await saveSnapshot({
        companyId: company.id,
        reportType: 'ProfitAndLoss',
        period,
        dimension: 'location',
        payload: month.pnlByLocation,
      });
      await saveSnapshot({ companyId: company.id, reportType: 'BalanceSheet', period, payload: month.balanceSheet });
      await saveSnapshot({ companyId: company.id, reportType: 'AgedReceivables', period, payload: month.arAging });
      await saveSnapshot({ companyId: company.id, reportType: 'AgedPayables', period, payload: month.apAging });

      for (const [report, kind] of [
        [month.arAging, 'receivable'],
        [month.apAging, 'payable'],
      ] as const) {
        const parsed = parseAgingSummary(flattenReport(report));
        await saveAging(company.id, {
          asOf: period.end,
          kind,
          total: { entityName: '__TOTAL__', entityQboId: null, ...parsed.total },
          entities: parsed.buckets,
        });
      }

      await upsertTransactions(
        company.id,
        month.transactions.map((t) => ({
          qboId: t.qboId,
          txnType: t.txnType,
          txnDate: t.txnDate,
          docNumber: t.docNumber,
          entityType: t.entityType,
          entityQboId: t.entityQboId,
          entityName: t.entityName,
          memo: t.memo,
          totalAmount: t.totalAmount,
          locationQboId: t.locationQboId,
          lines: [
            {
              lineNum: 1,
              amount: t.totalAmount,
              accountQboId: t.accountQboId,
              accountName: t.accountName,
              locationQboId: t.locationQboId,
            },
          ],
        })),
      );

      await recomputeMonth({ companyId: company.id, period, dimension: 'location' });
      await saveVendorSpend(company.id, period, await vendorSpendFromTransactions(company.id, period));

      await updateJobProgress(jobId, {
        current: i + 2,
        step: `Generating ${period.start.slice(0, 7)}`,
        appendStep: { label: period.start.slice(0, 7), status: 'completed' },
      });
    }

    await finishJob(jobId, 'completed');
    await recordAudit({
      companyId: company.id,
      userId: input.userId,
      action: 'demo.seeded',
      entityType: 'company',
      entityId: company.id,
      metadata: { months },
    });
    logger.info('demo company seeded', { companyId: company.id, months });
    return { companyId: company.id, months };
  } catch (err) {
    await finishJob(jobId, 'failed', err instanceof Error ? err.message : 'Demo seed failed');
    throw err;
  }
}
