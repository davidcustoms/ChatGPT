import { monthName } from '../util/dates';

/**
 * Rule-based intent classification.
 *
 * Deliberately deterministic and dependency-free: the natural-language query
 * pipeline must work (and be testable) without an AI key. The model is only
 * used afterwards to word the answer.
 */

export type QueryIntent =
  | 'month_summary'
  | 'compare_periods'
  | 'expense_drivers'
  | 'category_detail'
  | 'vendor_spend'
  | 'vendor_lookup'
  | 'store_performance'
  | 'margin_trend'
  | 'cash'
  | 'receivables'
  | 'payables'
  | 'attention'
  | 'worst_months'
  | 'best_months'
  | 'year_comparison'
  | 'unknown';

export interface ClassifiedQuery {
  intent: QueryIntent;
  /** YYYY-MM strings mentioned in the question, in the order found. */
  periodHints: string[];
  categoryHint: string | null;
  vendorHint: string | null;
  storeHint: string | null;
  limit: number;
}

const MONTH_PATTERN = new RegExp(
  `\\b(${Array.from({ length: 12 }, (_, i) => monthName(i + 1)).join('|')})\\b(?:\\s+(\\d{4}))?`,
  'gi',
);

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['advertising', /advertis|marketing|meta|facebook|google ads|tiktok/i],
  ['payroll', /payroll|wages|salar|labor|labour|commission/i],
  ['rent', /\brent\b|lease|occupancy/i],
  ['delivery', /delivery|last mile|white glove/i],
  ['freight', /freight|inbound shipping/i],
  ['warehouse', /warehouse|storage/i],
  ['merchant_processing', /merchant|processing fee|credit card fee/i],
  ['financing_fees', /financing fee|consumer financing/i],
  ['utilities', /utilit|electric|water bill/i],
  ['insurance', /insurance/i],
  ['repairs', /repair|maintenance/i],
  ['vehicles', /vehicle|fuel|truck/i],
  ['professional_fees', /legal|attorney|cpa|accounting fee|professional fee/i],
  ['software', /software|saas|subscription/i],
  ['bank_fees', /bank fee|bank charge/i],
  ['interest', /interest expense|interest paid/i],
  ['cogs', /cogs|cost of goods|cost of sales/i],
];

/**
 * Named financial metrics this application deliberately does not compute.
 *
 * Without this list a question like "what was our EBITDA-adjusted customer
 * lifetime value in April?" would fall through to the month summary — the
 * owner would get a confident wall of correct figures that answers a question
 * they did not ask. Saying "I do not track that" is the safe answer.
 */
const UNSUPPORTED_METRICS =
  /\bebitda?\b|lifetime value|\bltv\b|\bcac\b|customer acquisition cost|\bchurn\b|\bmrr\b|\barr\b|\bburn rate\b|\brunway\b|earnings per share|\beps\b|net promoter|\bnps\b|conversion rate|\bheadcount\b|\bebit\b|free cash flow|\bwacc\b|\birr\b|\bnpv\b/i;

/**
 * Subjects the resolver can actually report on. A question that names a period
 * but none of these is not a month summary — it is a question about something
 * else that happens to mention a date.
 */
const SUPPORTED_SUBJECT =
  /revenue|sales|profit|income|margin|expense|cost|spend|spent|cash|payroll|advertis|rent\b|vendor|supplier|store|location|inventor|receivab|payab|balance|assets|liabilit|equity|cogs|fees|financ|bill|invoice|discount|refund|return/i;

/** Phrasings that ask for the month as a whole. */
const SUMMARY_PHRASE =
  /how did we do|how did .* (look|go)|how was|summar(y|ise|ize)|overview|recap|performance|results|how are we doing|walk me through|tell me about/i;

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

/** Reads "top 5", "worst three", "best ten" and similar. */
function parseLimit(question: string): number {
  const digits = /\b(?:top|worst|best|first|last)\s+(\d{1,2})\b/i.exec(question);
  if (digits) return Math.min(25, Math.max(1, Number(digits[1])));
  const words = new RegExp(
    `\\b(?:top|worst|best|first|last)\\s+(${Object.keys(WORD_NUMBERS).join('|')})\\b`,
    'i',
  ).exec(question);
  if (words) return WORD_NUMBERS[(words[1] ?? '').toLowerCase()] ?? 10;
  return 10;
}

export function classifyQuestion(question: string): ClassifiedQuery {
  const q = question.trim();
  const lower = q.toLowerCase();

  const periodHints: string[] = [];
  const explicit = q.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g);
  if (explicit) periodHints.push(...explicit);

  MONTH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = MONTH_PATTERN.exec(q);
  while (match !== null) {
    const monthIndex =
      Array.from({ length: 12 }, (_, i) => monthName(i + 1).toLowerCase()).indexOf(
        (match[1] ?? '').toLowerCase(),
      ) + 1;
    if (monthIndex > 0) {
      const year = match[2];
      periodHints.push(year ? `${year}-${String(monthIndex).padStart(2, '0')}` : `????-${String(monthIndex).padStart(2, '0')}`);
    }
    match = MONTH_PATTERN.exec(q);
  }

  let categoryHint: string | null = null;
  for (const [key, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(lower)) {
      categoryHint = key;
      break;
    }
  }

  // "how much did we pay Vendor X" / "spend with X"
  const vendorMatch =
    /(?:pay|paid|spend(?:ing)? (?:with|at|on)|owe|vendor)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/.exec(q);
  const vendorHint = vendorMatch?.[1]?.trim() ?? null;

  const storeMatch = /(?:store|location|showroom|branch)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/.exec(q);
  const storeHint = storeMatch?.[1]?.trim() ?? null;

  const limit = parseLimit(q);

  const intent = pickIntent(lower, periodHints.length, Boolean(vendorHint), Boolean(categoryHint));

  return { intent, periodHints, categoryHint, vendorHint, storeHint, limit };
}

function pickIntent(
  lower: string,
  periodCount: number,
  hasVendor: boolean,
  hasCategory: boolean,
): QueryIntent {
  // Checked first: a metric we do not compute is unanswerable no matter what
  // else the sentence contains.
  if (UNSUPPORTED_METRICS.test(lower)) return 'unknown';
  if (/what should i (pay attention|focus)|needs? my attention|what.*watch/.test(lower)) return 'attention';
  if (/worst (three|3|\d+)? ?months?|worst months/.test(lower)) return 'worst_months';
  if (/best (three|3|\d+)? ?months?|best months/.test(lower)) return 'best_months';
  if (/this year (to|vs|versus|compared)|last year|year over year|yoy|ytd/.test(lower) && !/month/.test(lower)) {
    return 'year_comparison';
  }
  if (/compare/.test(lower) && periodCount >= 2) return 'compare_periods';
  if (/which store|store perform|best store|worst store|by store|by location|highest payroll percentage/.test(lower)) {
    return 'store_performance';
  }
  if (/largest vendors?|biggest vendors?|top vendors?|who are our.*vendors?/.test(lower)) return 'vendor_spend';
  if (hasVendor && /how much|spend|paid|pay/.test(lower)) return 'vendor_lookup';
  if (/overdue|receivable|a\/r|collect/.test(lower)) return 'receivables';
  if (/payable|a\/p|owe .*vendor|bills? due/.test(lower)) return 'payables';
  if (/cash/.test(lower)) return 'cash';
  if (/margin/.test(lower)) return 'margin_trend';
  if (/which expense|expense.*increase|expenses growing|why did profit|profit go down|what drove/.test(lower)) {
    return 'expense_drivers';
  }
  if (hasCategory && /how much|spend|spent|total/.test(lower)) return 'category_detail';
  if (SUMMARY_PHRASE.test(lower) || /last month/.test(lower)) return 'month_summary';
  // A bare period mention only means "summarise that month" when the question
  // is about something the resolver reports on. Otherwise we do not know what
  // was asked, and say so.
  return periodCount > 0 && SUPPORTED_SUBJECT.test(lower) ? 'month_summary' : 'unknown';
}

/** Resolves "????-08"-style hints against the periods actually available. */
export function resolvePeriodHint(hint: string, availablePeriods: string[]): string | null {
  if (!hint.startsWith('????')) {
    return availablePeriods.includes(hint) ? hint : null;
  }
  const month = hint.slice(5);
  const candidates = availablePeriods.filter((p) => p.endsWith(`-${month}`));
  return candidates[candidates.length - 1] ?? null;
}
