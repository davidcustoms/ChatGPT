import { DEFAULT_CATEGORIES, type CategoryDefinition } from './categories';
import type { AccountRecord } from './types';

/**
 * Automatic account -> management category suggestion.
 *
 * Two signals, in priority order:
 *  1. QuickBooks AccountSubType (a stable enumeration) -- high confidence.
 *  2. Account-name keywords -- medium confidence, requires owner approval.
 *
 * Anything below `AUTO_APPLY_CONFIDENCE` is stored as a *pending* suggestion.
 * The metric engine ignores pending suggestions, so an uncertain guess never
 * silently reclassifies an owner's money.
 */

export const AUTO_APPLY_CONFIDENCE = 0.9;

export interface MappingSuggestion {
  accountQboId: string;
  accountName: string;
  categoryKey: string;
  confidence: number;
  reason: string;
}

/** Fallback category when nothing matches, based on the account's type. */
function fallbackCategory(account: AccountRecord): { key: string; confidence: number; reason: string } | null {
  switch (account.accountType) {
    case 'Cost of Goods Sold':
      return { key: 'cogs', confidence: 0.9, reason: 'QuickBooks account type is Cost of Goods Sold' };
    case 'Income':
      return { key: 'revenue', confidence: 0.9, reason: 'QuickBooks account type is Income' };
    case 'Other Income':
      return { key: 'other_income', confidence: 0.9, reason: 'QuickBooks account type is Other Income' };
    case 'Other Expense':
      return { key: 'other_expense', confidence: 0.85, reason: 'QuickBooks account type is Other Expense' };
    case 'Expense':
      return { key: 'other_opex', confidence: 0.5, reason: 'Operating expense with no recognisable category' };
    default:
      return null;
  }
}

function keywordScore(haystack: string, category: CategoryDefinition): { score: number; hit: string } | null {
  let best: { score: number; hit: string } | null = null;
  for (const keyword of category.keywords) {
    if (!haystack.includes(keyword)) continue;
    // Longer keyword matches are more specific and therefore more trustworthy.
    const score = Math.min(0.88, 0.6 + keyword.length * 0.02);
    if (!best || score > best.score) best = { score, hit: keyword };
  }
  return best;
}

export function suggestCategory(account: AccountRecord): MappingSuggestion | null {
  if (!account.accountType) return null;
  const relevant = ['Income', 'Other Income', 'Expense', 'Other Expense', 'Cost of Goods Sold'];
  if (!relevant.includes(account.accountType)) return null;

  const haystack = `${account.fullyQualifiedName ?? ''} ${account.name}`.toLowerCase();

  // 1. AccountSubType match -- highest confidence.
  if (account.accountSubType) {
    const bySubType = DEFAULT_CATEGORIES.find((c) => c.subTypes?.includes(account.accountSubType as string));
    if (bySubType) {
      return {
        accountQboId: account.qboId,
        accountName: account.name,
        categoryKey: bySubType.key,
        confidence: 0.95,
        reason: `QuickBooks sub-type "${account.accountSubType}" maps to ${bySubType.label}`,
      };
    }
  }

  // 2. Keyword match, restricted to categories valid for this account type.
  const isRevenue = account.accountType === 'Income' || account.accountType === 'Other Income';
  const candidates = DEFAULT_CATEGORIES.filter((c) => {
    if (isRevenue) return c.section === 'revenue' || c.section === 'contra_revenue' || c.section === 'other_income';
    if (account.accountType === 'Cost of Goods Sold') return c.section === 'cogs';
    return c.section === 'opex' || c.section === 'other_expense';
  });

  let winner: { category: CategoryDefinition; score: number; hit: string } | null = null;
  for (const category of candidates) {
    const match = keywordScore(haystack, category);
    if (match && (!winner || match.score > winner.score)) {
      winner = { category, score: match.score, hit: match.hit };
    }
  }
  if (winner) {
    return {
      accountQboId: account.qboId,
      accountName: account.name,
      categoryKey: winner.category.key,
      confidence: Number(winner.score.toFixed(2)),
      reason: `Account name contains "${winner.hit}"`,
    };
  }

  const fallback = fallbackCategory(account);
  if (!fallback) return null;
  return {
    accountQboId: account.qboId,
    accountName: account.name,
    categoryKey: fallback.key,
    confidence: fallback.confidence,
    reason: fallback.reason,
  };
}

export function suggestAll(accounts: AccountRecord[]): MappingSuggestion[] {
  return accounts
    .filter((a) => a.isActive)
    .map(suggestCategory)
    .filter((s): s is MappingSuggestion => s !== null);
}

/** Split suggestions into "safe to apply" and "needs owner approval". */
export function partitionSuggestions(suggestions: MappingSuggestion[]): {
  autoApply: MappingSuggestion[];
  needsReview: MappingSuggestion[];
} {
  return {
    autoApply: suggestions.filter((s) => s.confidence >= AUTO_APPLY_CONFIDENCE),
    needsReview: suggestions.filter((s) => s.confidence < AUTO_APPLY_CONFIDENCE),
  };
}
