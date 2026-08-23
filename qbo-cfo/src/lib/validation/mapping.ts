import { listMappings, effectiveMappingIndex } from '../db/repositories/mappings';
import { accountIndex } from '../db/repositories/masterdata';
import { getAccountMetrics } from '../db/repositories/metrics';
import { suggestCategory } from '../finance/mapping';
import { categoryLabel } from '../finance/categories';
import { computeMappingCoverage } from '../finance/coverage';
import { round2 } from '../finance/math';
import { formatCurrency, formatPercent } from '../util/format';
import type { Period } from '../util/dates';
import {
  fail,
  needsReview,
  notAvailable,
  pass,
  type ValidationSection,
  type ValidationCheck,
  type ValidationTable,
} from './types';

/**
 * Item 8: account mapping review against the live chart of accounts.
 *
 * Suggestions are never silently approved. Anything below the confidence bar
 * stays pending and is listed for a human, because a mis-mapped account moves
 * real money between categories and nothing downstream would notice.
 */

/** Below this, a suggestion is a suggestion and not a decision. */
const AUTO_APPROVE_CONFIDENCE = 0.9;

/** Coverage below this, by dollars, is not good enough to report on. */
const REQUIRED_COVERAGE = 0.95;

const INCOME_TYPES = new Set(['Income', 'Other Income']);
const COGS_TYPES = new Set(['Cost of Goods Sold']);
const EXPENSE_TYPES = new Set(['Expense', 'Other Expense']);

export async function validateMapping(input: {
  companyId: string;
  period: Period;
}): Promise<ValidationSection> {
  const { companyId, period } = input;
  const checks: ValidationCheck[] = [];

  const [accounts, mappings, mappingIndex, accountRows] = await Promise.all([
    accountIndex(companyId),
    listMappings(companyId),
    effectiveMappingIndex(companyId),
    getAccountMetrics(companyId, period),
  ]);

  if (accounts.size === 0) {
    return {
      key: 'mapping',
      title: 'Account mapping review',
      checks: [
        fail('mapping_accounts', 'Mapping', 'Chart of accounts', 'No accounts are stored for this company.',
          'Sync master data before reviewing the mapping.'),
      ],
    };
  }

  const approvedByAccount = new Map(mappings.map((m) => [m.accountQboId, m]));
  const amountByAccount = new Map(accountRows.map((r) => [r.accountQboId, Math.abs(r.amount)]));

  // --- The review table ----------------------------------------------------
  const reviewable = Array.from(accounts.values()).filter(
    (a) => a.accountType && (INCOME_TYPES.has(a.accountType) || COGS_TYPES.has(a.accountType) || EXPENSE_TYPES.has(a.accountType)),
  );

  const rows: ValidationTable['rows'] = [];
  const pending: string[] = [];
  const suspicious: string[] = [];

  for (const account of reviewable.sort(
    (a, b) => (amountByAccount.get(b.qboId) ?? 0) - (amountByAccount.get(a.qboId) ?? 0),
  )) {
    const stored = approvedByAccount.get(account.qboId);
    const suggestion = suggestCategory(account);
    const effective = mappingIndex.get(account.qboId) ?? null;
    const confidence = stored?.approved ? 1 : (suggestion?.confidence ?? 0);
    const amount = amountByAccount.get(account.qboId) ?? 0;

    const needsHuman = !stored?.approved && confidence < AUTO_APPROVE_CONFIDENCE;
    if (needsHuman && amount > 0) pending.push(`${account.name} (${formatCurrency(amount, { decimals: 2 })})`);

    // A revenue account mapped to an expense category, or the reverse, is the
    // kind of thing that silently inverts a margin.
    const isIncome = INCOME_TYPES.has(account.accountType ?? '');
    const mappedToRevenue = effective === 'revenue' || effective === 'discounts' || effective === 'returns' || effective === 'other_income';
    if (effective && isIncome !== mappedToRevenue) {
      suspicious.push(`${account.name} is a ${account.accountType} account mapped to ${categoryLabel(effective)}`);
    }

    rows.push({
      cells: [
        account.fullyQualifiedName ?? account.name,
        account.accountType ?? '—',
        account.accountSubType ?? '—',
        effective ? categoryLabel(effective) : 'unmapped',
        stored?.approved ? 'approved' : confidence > 0 ? formatPercent(confidence, 0) : '—',
        amount > 0 ? formatCurrency(amount, { decimals: 2 }) : '—',
        needsHuman ? 'YES' : 'no',
      ],
      status: needsHuman ? 'NEEDS_REVIEW' : effective ? 'PASS' : 'NOT_AVAILABLE',
    });
  }

  // --- Coverage by section -------------------------------------------------
  const coverage = computeMappingCoverage({
    accountAmounts: accountRows.map((r) => ({
      accountQboId: r.accountQboId,
      accountName: r.accountName,
      classification: r.classification,
      categoryKey: r.categoryKey,
      amount: r.amount,
    })),
    accounts,
    mapping: mappingIndex,
  });

  const sectionCheck = (key: string, label: string, types: Set<string>): void => {
    const relevant = accountRows.filter((r) => {
      const type = accounts.get(r.accountQboId)?.accountType ?? '';
      return types.has(type);
    });
    const total = round2(relevant.reduce((a, r) => a + Math.abs(r.amount), 0));
    if (total === 0) {
      checks.push(
        notAvailable(`mapping_${key}`, 'Mapping', `${label} coverage`,
          `No ${label.toLowerCase()} activity in this period, so there is nothing to map.`),
      );
      return;
    }
    const mapped = round2(
      relevant
        .filter((r) => (r.categoryKey ?? mappingIndex.get(r.accountQboId) ?? null) !== null)
        .reduce((a, r) => a + Math.abs(r.amount), 0),
    );
    const share = mapped / total;
    const unmappedAmount = round2(total - mapped);
    checks.push(
      share >= REQUIRED_COVERAGE
        ? pass(`mapping_${key}`, 'Mapping', `${label} coverage`,
            `${formatPercent(share)} of ${label.toLowerCase()} dollars are mapped (${formatCurrency(unmappedAmount, { decimals: 2 })} unmapped).`)
        : fail(`mapping_${key}`, 'Mapping', `${label} coverage`,
            `Only ${formatPercent(share)} of ${label.toLowerCase()} dollars are mapped — ${formatCurrency(unmappedAmount, { decimals: 2 })} is not attributed to any management category.`,
            `Map the remaining ${label.toLowerCase()} accounts in Settings → Account Mapping. Below ${formatPercent(REQUIRED_COVERAGE)} the category analysis is not reliable.`),
    );
  };

  sectionCheck('revenue', 'Revenue', INCOME_TYPES);
  sectionCheck('cogs', 'COGS', COGS_TYPES);
  sectionCheck('expenses', 'Operating expense', EXPENSE_TYPES);

  // --- Pending decisions ---------------------------------------------------
  checks.push(
    pending.length === 0
      ? pass('mapping_pending', 'Mapping', 'Uncertain mappings',
          'Every account carrying money in this period is either approved or mapped with high confidence.')
      : needsReview('mapping_pending', 'Mapping', 'Uncertain mappings',
          `${pending.length} account(s) with activity are mapped below ${formatPercent(AUTO_APPROVE_CONFIDENCE, 0)} confidence and have not been approved: ${pending.slice(0, 6).join('; ')}${pending.length > 6 ? '; …' : ''}.`,
          'Open Settings → Account Mapping and approve or correct each. Nothing here has been auto-approved.'),
  );

  checks.push(
    suspicious.length === 0
      ? pass('mapping_suspicious', 'Mapping', 'Suspicious classifications',
          'No account is mapped across the revenue/expense boundary.')
      : fail('mapping_suspicious', 'Mapping', 'Suspicious classifications',
          `${suspicious.length} account(s) are mapped across the revenue/expense boundary: ${suspicious.slice(0, 4).join('; ')}.`,
          'A revenue account in an expense category inverts the margin. Correct these before reporting.'),
  );

  checks.push(
    coverage.overallCoverage === null
      ? notAvailable('mapping_overall', 'Mapping', 'Overall coverage', 'No income or expense activity to measure.')
      : coverage.overallCoverage >= REQUIRED_COVERAGE
        ? pass('mapping_overall', 'Mapping', 'Overall coverage',
            `${formatPercent(coverage.overallCoverage)} of income and expense dollars reach a management category.`)
        : fail('mapping_overall', 'Mapping', 'Overall coverage',
            `${formatPercent(coverage.overallCoverage)} dollar coverage, below the ${formatPercent(REQUIRED_COVERAGE)} needed to report confidently. ${formatCurrency(coverage.totalUnmappedAmount, { decimals: 2 })} across ${coverage.totalUnmappedAccounts} account(s) is unmapped.`,
            'Map the largest unmapped accounts first — coverage is weighted by dollars, not by account count.'),
  );

  return {
    key: 'mapping',
    title: 'Account mapping review',
    checks,
    tables: [
      {
        title: 'Chart of accounts, by activity in this period',
        columns: ['QuickBooks Account', 'Account Type', 'Account Subtype', 'Management Category', 'Confidence', 'Period activity', 'Needs Review'],
        rows: rows.slice(0, 200),
        caption:
          rows.length > 200
            ? `Showing the 200 accounts with the most activity, of ${rows.length}. Ordered by dollars, because coverage is what matters, not account count.`
            : `All ${rows.length} income, COGS and expense accounts, ordered by activity in this period.`,
      },
    ],
    note: `Nothing is auto-approved below ${formatPercent(AUTO_APPROVE_CONFIDENCE, 0)} confidence. A suggestion is a suggestion until a human approves it.`,
  };
}
