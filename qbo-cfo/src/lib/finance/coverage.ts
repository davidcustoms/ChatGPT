import { categoryLabel } from './categories';
import { suggestCategory } from './mapping';
import { round2, safeDivide } from './math';
import type { AccountAmount, AccountRecord } from './types';

/**
 * Mapping coverage.
 *
 * Coverage is the share of money that reached a management category. It is the
 * single most important honesty signal in the product: an "Advertising"
 * analysis is only as trustworthy as the proportion of advertising-like
 * spending that is actually mapped to Advertising.
 *
 * Coverage is measured in dollars, not in account counts, because ten unmapped
 * dormant accounts matter far less than one unmapped account carrying 30% of
 * operating expense.
 */

export type CoverageSection = 'revenue' | 'cogs' | 'expense';

export interface SectionCoverage {
  section: CoverageSection;
  label: string;
  mappedAmount: number;
  unmappedAmount: number;
  totalAmount: number;
  /** null when there was no activity at all -- coverage of nothing is not 100%. */
  coverage: number | null;
  unmappedAccountCount: number;
  mappedAccountCount: number;
  unmappedAccounts: Array<{ qboId: string; name: string; amount: number }>;
}

export interface CategoryCoverage {
  categoryKey: string;
  label: string;
  mappedAmount: number;
  /** Money in unmapped accounts that this category would plausibly claim. */
  candidateUnmappedAmount: number;
  coverage: number | null;
  unmappedAccountCount: number;
  confidence: 'high' | 'medium' | 'low';
  caveat: string | null;
}

export interface MappingCoverageReport {
  sections: SectionCoverage[];
  byCategory: CategoryCoverage[];
  totalUnmappedAmount: number;
  totalUnmappedAccounts: number;
  /** Dollar-weighted coverage across revenue, COGS and expenses. */
  overallCoverage: number | null;
  worstSection: SectionCoverage | null;
}

const SECTION_LABELS: Record<CoverageSection, string> = {
  revenue: 'Revenue',
  cogs: 'COGS',
  expense: 'Operating & other expenses',
};

function sectionOf(classification: string | null, accountType: string | null): CoverageSection | null {
  if (accountType === 'Cost of Goods Sold') return 'cogs';
  if (accountType === 'Income' || accountType === 'Other Income') return 'revenue';
  if (accountType === 'Expense' || accountType === 'Other Expense') return 'expense';
  if (classification === 'Revenue') return 'revenue';
  if (classification === 'Expense') return 'expense';
  return null;
}

/**
 * Confidence thresholds. Deliberately strict: at 85% coverage, one seventh of
 * the money in a category is unaccounted for, which is enough to reverse the
 * direction of a month-over-month comparison.
 */
export const COVERAGE_HIGH = 0.95;
export const COVERAGE_MEDIUM = 0.85;

export function coverageConfidence(coverage: number | null): 'high' | 'medium' | 'low' {
  if (coverage === null) return 'low';
  if (coverage >= COVERAGE_HIGH) return 'high';
  if (coverage >= COVERAGE_MEDIUM) return 'medium';
  return 'low';
}

export function computeMappingCoverage(input: {
  accountAmounts: AccountAmount[];
  accounts: ReadonlyMap<string, AccountRecord>;
  mapping: ReadonlyMap<string, string>;
}): MappingCoverageReport {
  const sections = new Map<CoverageSection, SectionCoverage>();
  for (const section of ['revenue', 'cogs', 'expense'] as CoverageSection[]) {
    sections.set(section, {
      section,
      label: SECTION_LABELS[section],
      mappedAmount: 0,
      unmappedAmount: 0,
      totalAmount: 0,
      coverage: null,
      unmappedAccountCount: 0,
      mappedAccountCount: 0,
      unmappedAccounts: [],
    });
  }

  const mappedByCategory = new Map<string, { amount: number; accounts: number }>();
  const candidateByCategory = new Map<string, { amount: number; accounts: number }>();

  for (const row of input.accountAmounts) {
    const account = input.accounts.get(row.accountQboId);
    const section = sectionOf(row.classification, account?.accountType ?? null);
    if (!section) continue;

    // Coverage is about magnitude: a contra-revenue line of -20,000 represents
    // 20,000 of money whose classification matters.
    const magnitude = Math.abs(row.amount);
    if (magnitude === 0) continue;

    const bucket = sections.get(section) as SectionCoverage;
    bucket.totalAmount = round2(bucket.totalAmount + magnitude);

    const categoryKey = row.categoryKey ?? input.mapping.get(row.accountQboId) ?? null;
    if (categoryKey) {
      bucket.mappedAmount = round2(bucket.mappedAmount + magnitude);
      bucket.mappedAccountCount += 1;
      const entry = mappedByCategory.get(categoryKey) ?? { amount: 0, accounts: 0 };
      mappedByCategory.set(categoryKey, {
        amount: round2(entry.amount + magnitude),
        accounts: entry.accounts + 1,
      });
    } else {
      bucket.unmappedAmount = round2(bucket.unmappedAmount + magnitude);
      bucket.unmappedAccountCount += 1;
      bucket.unmappedAccounts.push({
        qboId: row.accountQboId,
        name: row.accountName,
        amount: row.amount,
      });

      // Where would this account most plausibly belong? That is what makes a
      // specific category's analysis untrustworthy rather than the whole report.
      if (account) {
        const suggestion = suggestCategory(account);
        if (suggestion) {
          const entry = candidateByCategory.get(suggestion.categoryKey) ?? { amount: 0, accounts: 0 };
          candidateByCategory.set(suggestion.categoryKey, {
            amount: round2(entry.amount + magnitude),
            accounts: entry.accounts + 1,
          });
        }
      }
    }
  }

  const sectionList = Array.from(sections.values()).map((s) => ({
    ...s,
    coverage: s.totalAmount > 0 ? safeDivide(s.mappedAmount, s.totalAmount) : null,
    unmappedAccounts: s.unmappedAccounts.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 25),
  }));

  const categoryKeys = new Set([...mappedByCategory.keys(), ...candidateByCategory.keys()]);
  const byCategory: CategoryCoverage[] = Array.from(categoryKeys)
    .map((key) => {
      const mapped = mappedByCategory.get(key) ?? { amount: 0, accounts: 0 };
      const candidate = candidateByCategory.get(key) ?? { amount: 0, accounts: 0 };
      const denominator = round2(mapped.amount + candidate.amount);
      const coverage = denominator > 0 ? safeDivide(mapped.amount, denominator) : null;
      const confidence = coverageConfidence(coverage);
      return {
        categoryKey: key,
        label: categoryLabel(key),
        mappedAmount: mapped.amount,
        candidateUnmappedAmount: candidate.amount,
        coverage,
        unmappedAccountCount: candidate.accounts,
        confidence,
        caveat:
          confidence === 'high' || coverage === null
            ? null
            : `${categoryLabel(key)} analysis confidence: ${confidence === 'low' ? 'Low' : 'Medium'} — ${formatShare(1 - (coverage ?? 0))} of relevant expense accounts are unmapped.`,
      };
    })
    .sort((a, b) => b.mappedAmount + b.candidateUnmappedAmount - (a.mappedAmount + a.candidateUnmappedAmount));

  const totalMapped = round2(sectionList.reduce((a, s) => a + s.mappedAmount, 0));
  const totalAll = round2(sectionList.reduce((a, s) => a + s.totalAmount, 0));
  const withActivity = sectionList.filter((s) => s.totalAmount > 0 && s.coverage !== null);

  return {
    sections: sectionList,
    byCategory,
    totalUnmappedAmount: round2(sectionList.reduce((a, s) => a + s.unmappedAmount, 0)),
    totalUnmappedAccounts: sectionList.reduce((a, s) => a + s.unmappedAccountCount, 0),
    overallCoverage: totalAll > 0 ? safeDivide(totalMapped, totalAll) : null,
    worstSection:
      withActivity.length > 0
        ? withActivity.reduce((worst, s) => ((s.coverage ?? 1) < (worst.coverage ?? 1) ? s : worst))
        : null,
  };
}

function formatShare(ratio: number): string {
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(0)}%`;
}

/** Lookup helper used by the AI layer to gate what it may discuss confidently. */
export function categoryConfidence(
  report: MappingCoverageReport,
  categoryKey: string,
): CategoryCoverage | null {
  return report.byCategory.find((c) => c.categoryKey === categoryKey) ?? null;
}
