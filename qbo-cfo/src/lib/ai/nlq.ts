import { getCompany } from '../db/repositories/companies';
import {
  categoryTotalsByPeriod,
  getAging,
  getLocationMetrics,
  getMetricsRange,
  getMonthlyMetrics,
  getVendorSpend,
  getVendorSpendRange,
  latestMetricsPeriod,
  listAllMetrics,
} from '../db/repositories/metrics';
import { getAnomalies } from '../db/repositories/anomalies';
import { AppError } from '../errors';
import { categoryLabel } from '../finance/categories';
import { aggregateMetrics } from '../finance/comparisons';
import { pctChange, round2, safeDivide } from '../finance/math';
import { rankStores } from '../finance/locations';
import {
  monthLabel,
  monthName,
  monthPeriodOf,
  priorMonth,
  priorYearToDate,
  sameMonthLastYear,
  trailingMonths,
  yearToDate,
  type Period,
} from '../util/dates';
import { formatCurrency, formatPercent } from '../util/format';
import { classifyQuestion, resolvePeriodHint, type ClassifiedQuery } from './intent';
import { CHAT_SYSTEM_PROMPT } from './prompts';
import { openai } from './client';
import { isOpenAiConfigured } from '../env';
import { logger } from '../logger';
import { basisLabel } from '../finance/basis';
import type { AccountingMethod } from '../finance/basis';
import { computeMappingCoverage } from '../finance/coverage';
import { accountIndex } from '../db/repositories/masterdata';
import { effectiveMappingIndex } from '../db/repositories/mappings';
import { getAccountMetrics } from '../db/repositories/metrics';
import { buildProvenance, describeProvenance, type MetricProvenance } from '../reports/provenance';
import { CHAT_PROMPT_VERSION, DETERMINISTIC_PROMPT_VERSION } from '../version';
import { untrustedBlock } from './sanitize';

/**
 * Natural-language query pipeline.
 *
 *   question -> classify intent -> query the database -> deterministic answer
 *            -> pass the verified JSON to the model -> narrate
 *
 * The application does the maths. The model never sees raw ledgers and never
 * computes a figure: if the resolver cannot answer, the pipeline says so.
 */

export interface NlqResult {
  answer: string;
  intent: ClassifiedQuery['intent'];
  data: Record<string, unknown>;
  dataThrough: string | null;
  source: string;
  /** Reporting basis the answer was computed on. Shown with every answer. */
  accountingMethod: AccountingMethod;
  basisLabel: string;
  /** How the headline figures in this answer were produced. */
  provenance: MetricProvenance[];
  /** Uncertainty the owner must see: missing periods, poor coverage, N/M results. */
  caveats: string[];
  /** Deterministic answer used when the model is unavailable. */
  deterministicAnswer: string;
  aiUsed: boolean;
  promptVersion: string;
}

/** Renders a period hint back into the words the owner used. */
function describeHint(hint: string): string {
  if (!hint.startsWith('????')) return monthLabel(periodFromKey(hint));
  const month = Number(hint.slice(5));
  return monthName(month);
}

function periodFromKey(key: string): Period {
  return monthPeriodOf(`${key}-01`);
}

export async function answerQuestion(input: {
  companyId: string;
  question: string;
}): Promise<NlqResult> {
  const company = await getCompany(input.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const classified = classifyQuestion(input.question);
  const allMetrics = await listAllMetrics(input.companyId, 48);
  if (allMetrics.length === 0) {
    return {
      answer:
        'There is no financial data stored yet. Import history from QuickBooks (or enable demo mode) and I can answer questions about it.',
      intent: classified.intent,
      data: {},
      dataThrough: null,
      source: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
      accountingMethod: company.accountingMethod,
      basisLabel: basisLabel(company.accountingMethod),
      provenance: [],
      caveats: ['No financial data is stored for this company yet.'],
      deterministicAnswer: 'No financial data is stored for this company yet.',
      aiUsed: false,
      promptVersion: DETERMINISTIC_PROMPT_VERSION,
    };
  }

  const availableKeys = allMetrics.map((m) => m.period.start.slice(0, 7));
  const latest = (await latestMetricsPeriod(input.companyId)) as Period;

  // Newest first: "compare June and July" should read as July against June,
  // which is how an owner phrases the change they care about.
  const hintResolutions = classified.periodHints.map((hint) => ({
    hint,
    resolved: resolvePeriodHint(hint, availableKeys),
  }));
  const resolvedPeriods = Array.from(
    new Set(hintResolutions.map((r) => r.resolved).filter((p): p is string => p !== null)),
  )
    .sort((a, b) => b.localeCompare(a))
    .map(periodFromKey);

  // A named month that is not stored must never fall back to the latest month:
  // answering about June when the owner asked about February is the worst kind
  // of wrong answer, because it looks right.
  const unresolvedHints = hintResolutions.filter((r) => r.resolved === null).map((r) => r.hint);
  if (resolvedPeriods.length === 0 && unresolvedHints.length > 0) {
    const named = unresolvedHints.map(describeHint).join(' and ');
    const message = `I do not have stored financial data for ${named}, so I cannot report on ${unresolvedHints.length > 1 ? 'those periods' : 'that period'}. Stored history runs from ${monthLabel(periodFromKey(availableKeys[0] ?? latest.start.slice(0, 7)))} to ${monthLabel(latest)}.`;
    return {
      answer: message,
      intent: classified.intent,
      data: { requested: unresolvedHints, available: false, stored_through: latest.end },
      dataThrough: latest.end,
      source: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
      accountingMethod: company.accountingMethod,
      basisLabel: basisLabel(company.accountingMethod),
      provenance: [],
      caveats: [`${named} ${unresolvedHints.length > 1 ? 'are' : 'is'} not stored, so no figures were computed.`],
      deterministicAnswer: message,
      aiUsed: false,
      promptVersion: DETERMINISTIC_PROMPT_VERSION,
    };
  }

  const primary = resolvedPeriods[0] ?? latest;
  const secondary = resolvedPeriods[1] ?? null;

  const resolved = await resolveIntent({
    companyId: input.companyId,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    classified,
    primary,
    secondary,
    allMetrics,
  });

  const source = company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online';
  const dataThrough = latest.end;
  const method = company.accountingMethod;

  // Provenance for the figures this answer leans on.
  const primaryMetrics = await getMonthlyMetrics(input.companyId, primary);
  const provenance: MetricProvenance[] = [];
  if (primaryMetrics) {
    for (const key of resolved.provenanceKeys ?? []) {
      const p = buildProvenance(key, primaryMetrics);
      if (p) provenance.push(p);
    }
  }

  const caveats = [...(resolved.caveats ?? [])];

  // Mapping coverage caveat for any category the answer discusses.
  const categoryKey = classified.categoryHint;
  if (categoryKey && primaryMetrics) {
    const [rows, accounts, mapping] = await Promise.all([
      getAccountMetrics(input.companyId, primary),
      accountIndex(input.companyId),
      effectiveMappingIndex(input.companyId),
    ]);
    const coverage = computeMappingCoverage({
      accountAmounts: rows.map((r) => ({
        accountQboId: r.accountQboId,
        accountName: r.accountName,
        classification: r.classification,
        categoryKey: r.categoryKey,
        amount: r.amount,
      })),
      accounts,
      mapping,
    });
    const cat = coverage.byCategory.find((c) => c.categoryKey === categoryKey);
    if (cat?.caveat) caveats.push(cat.caveat);
  }

  const deterministicAnswer = resolved.summary;
  let answer = deterministicAnswer;
  let aiUsed = false;
  let promptVersion = DETERMINISTIC_PROMPT_VERSION;

  if (isOpenAiConfigured()) {
    try {
      const client = openai();
      const completion = await client.chat.completions.create({
        model: process.env['OPENAI_MODEL'] ?? 'gpt-4.1',
        temperature: 0.2,
        max_completion_tokens: 700,
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `QUESTION: ${input.question}`,
              `INTENT: ${classified.intent}`,
              `DATA THROUGH: ${dataThrough}`,
              `SOURCE: ${source}`,
              `ACCOUNTING BASIS: ${basisLabel(method)}`,
              caveats.length > 0
                ? `MANDATORY CAVEATS (state these; do not soften or omit them):\n${caveats.map((c) => `- ${c}`).join('\n')}`
                : 'MANDATORY CAVEATS: none',
              '',
              'VERIFIED RESULT (the only numbers you may use):',
              untrustedBlock('query result', resolved.data),
              '',
              'APPLICATION-COMPUTED ANSWER (already correct; reword it clearly, do not change any number):',
              deterministicAnswer,
            ].join('\n'),
          },
        ],
      });
      const content = completion.choices[0]?.message?.content?.trim();
      if (content) {
        answer = content;
        aiUsed = true;
        promptVersion = CHAT_PROMPT_VERSION;
      }
    } catch (err) {
      logger.warn('chat narration failed, using deterministic answer', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Caveats are appended by the application, not left to the model's wording,
  // so an uncertainty can never be dropped in narration.
  if (caveats.length > 0 && aiUsed) {
    const missing = caveats.filter((c) => !answer.includes(c));
    if (missing.length > 0) answer = `${answer}\n\n${missing.join(' ')}`;
  }

  return {
    answer,
    intent: classified.intent,
    data: { ...resolved.data, accounting_basis: method },
    dataThrough,
    source,
    accountingMethod: method,
    basisLabel: basisLabel(method),
    provenance,
    caveats,
    deterministicAnswer,
    aiUsed,
    promptVersion,
  };
}

interface ResolvedAnswer {
  summary: string;
  data: Record<string, unknown>;
  /** Metric keys whose provenance should accompany the answer. */
  provenanceKeys?: string[];
  /** Uncertainty that must reach the owner regardless of how the model words it. */
  caveats?: string[];
}

async function resolveIntent(ctx: {
  companyId: string;
  fiscalYearStartMonth: number;
  classified: ClassifiedQuery;
  primary: Period;
  secondary: Period | null;
  allMetrics: Awaited<ReturnType<typeof listAllMetrics>>;
}): Promise<ResolvedAnswer> {
  const { companyId, classified, primary } = ctx;

  switch (classified.intent) {
    case 'month_summary':
      return monthSummary(companyId, primary);
    case 'compare_periods':
      return comparePeriods(companyId, primary, ctx.secondary ?? priorMonth(primary));
    case 'expense_drivers':
      return expenseDrivers(companyId, primary);
    case 'category_detail':
      return categoryDetail(companyId, primary, classified.categoryHint, ctx.fiscalYearStartMonth);
    case 'vendor_spend':
      return vendorSpendAnswer(companyId, primary, classified.limit);
    case 'vendor_lookup':
      return vendorLookup(companyId, primary, classified.vendorHint, ctx.fiscalYearStartMonth);
    case 'store_performance':
      return storePerformance(companyId, primary, classified);
    case 'margin_trend':
      return marginTrend(ctx.allMetrics);
    case 'cash':
      return cashAnswer(companyId, primary);
    case 'receivables':
      return agingAnswer(companyId, primary, 'receivable');
    case 'payables':
      return agingAnswer(companyId, primary, 'payable');
    case 'attention':
      return attentionAnswer(companyId, primary);
    case 'worst_months':
      return extremeMonths(ctx.allMetrics, 'worst', classified.limit);
    case 'best_months':
      return extremeMonths(ctx.allMetrics, 'best', classified.limit);
    case 'year_comparison':
      return yearComparison(companyId, primary, ctx.fiscalYearStartMonth);
    default:
      return {
        summary:
          'I could not match that question to a supported report, so I have not answered it rather than guessing. Try asking about revenue, margin, a specific expense category, a vendor, a store, cash, receivables or payables for a given month.',
        data: { intent: 'unknown' },
        caveats: ['The question did not match a supported query, so no figures were computed.'],
      };
  }
}

async function monthSummary(companyId: string, period: Period): Promise<ResolvedAnswer> {
  const [current, prior, lastYear] = await Promise.all([
    getMonthlyMetrics(companyId, period),
    getMonthlyMetrics(companyId, priorMonth(period)),
    getMonthlyMetrics(companyId, sameMonthLastYear(period)),
  ]);
  if (!current) {
    return {
      summary: `I do not have stored financial data for ${monthLabel(period)}, so I cannot report on it. Import that month from QuickBooks and ask again.`,
      data: { period: period.start, available: false },
      caveats: [`No data is stored for ${monthLabel(period)}.`],
    };
  }
  const mom = prior ? pctChange(current.netSales, prior.netSales) : null;
  const yoy = lastYear ? pctChange(current.netSales, lastYear.netSales) : null;

  const caveats: string[] = [];
  if (!prior) caveats.push(`No prior month is stored, so the month-over-month change cannot be calculated.`);
  if (!lastYear) {
    caveats.push(`${monthLabel(sameMonthLastYear(period))} is not stored, so the year-over-year change cannot be calculated.`);
  }
  if (prior && mom === null) {
    caveats.push('Prior-month revenue was zero, so the percentage change is not meaningful (N/M).');
  }
  if (current.netSales === 0) {
    caveats.push('Revenue for this period is zero, so margins and ratios of revenue are not meaningful (N/M).');
  }

  return {
    summary: [
      `${monthLabel(period)}: revenue ${formatCurrency(current.netSales)}${mom !== null ? ` (${formatPercent(mom, 1, { signed: true })} vs prior month)` : ''}${yoy !== null ? `, ${formatPercent(yoy, 1, { signed: true })} year over year` : ''}.`,
      `Gross profit ${formatCurrency(current.grossProfit)} at a ${formatPercent(current.grossMargin)} margin.`,
      `Operating expenses ${formatCurrency(current.operatingExpenses)}; net income ${formatCurrency(current.netIncome)}${current.netMargin !== null ? ` (${formatPercent(current.netMargin)} net margin)` : ''}.`,
      `Cash ${formatCurrency(current.cash)}, A/R ${formatCurrency(current.accountsReceivable)}, A/P ${formatCurrency(current.accountsPayable)}.`,
    ].join(' '),
    provenanceKeys: ['net_sales', 'gross_profit', 'gross_margin', 'operating_expenses', 'net_income', 'cash'],
    caveats,
    data: {
      period: period.start,
      revenue: current.netSales,
      revenue_prior_month: prior?.netSales ?? null,
      revenue_same_month_last_year: lastYear?.netSales ?? null,
      revenue_change_mom: mom,
      revenue_change_yoy: yoy,
      gross_profit: current.grossProfit,
      gross_margin: current.grossMargin,
      operating_expenses: current.operatingExpenses,
      net_income: current.netIncome,
      net_margin: current.netMargin,
      cash: current.cash,
      accounts_receivable: current.accountsReceivable,
      accounts_payable: current.accountsPayable,
    },
  };
}

async function comparePeriods(companyId: string, a: Period, b: Period): Promise<ResolvedAnswer> {
  const [ma, mb] = await Promise.all([getMonthlyMetrics(companyId, a), getMonthlyMetrics(companyId, b)]);
  if (!ma || !mb) {
    const missing = [!ma ? monthLabel(a) : null, !mb ? monthLabel(b) : null].filter(Boolean);
    return {
      summary: `I cannot compare those periods: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not stored. Import the missing month(s) and ask again.`,
      data: { a: a.start, b: b.start, available: false, missing },
      caveats: [`${missing.join(' and ')} not stored.`],
    };
  }
  const rows = [
    ['Revenue', ma.netSales, mb.netSales],
    ['Gross profit', ma.grossProfit, mb.grossProfit],
    ['Operating expenses', ma.operatingExpenses, mb.operatingExpenses],
    ['Net income', ma.netIncome, mb.netIncome],
  ] as const;

  return {
    summary: [
      `${monthLabel(a)} vs ${monthLabel(b)}:`,
      ...rows.map(
        ([label, x, y]) =>
          `${label} ${formatCurrency(x)} vs ${formatCurrency(y)} (${formatPercent(pctChange(x, y), 1, { signed: true })}).`,
      ),
      `Gross margin ${formatPercent(ma.grossMargin)} vs ${formatPercent(mb.grossMargin)}.`,
    ].join(' '),
    provenanceKeys: ['net_sales', 'gross_profit', 'operating_expenses', 'net_income'],
    caveats: mb.netSales === 0 ? ['The comparison period had zero revenue, so percentage changes are not meaningful (N/M).'] : [],
    data: {
      period_a: a.start,
      period_b: b.start,
      comparison: rows.map(([label, x, y]) => ({
        metric: label,
        a: x,
        b: y,
        change_amount: round2(x - y),
        change_pct: pctChange(x, y),
      })),
      gross_margin_a: ma.grossMargin,
      gross_margin_b: mb.grossMargin,
    },
  };
}

/**
 * Profit bridge: why did the bottom line move?
 *
 * Answers "why did profit go down", "which expense increased the most" and
 * "are expenses growing faster than sales" from one deterministic walk:
 * revenue effect -> margin effect -> operating expense effect.
 */
async function expenseDrivers(companyId: string, period: Period): Promise<ResolvedAnswer> {
  const prior = priorMonth(period);
  const [current, previous] = await Promise.all([
    getMonthlyMetrics(companyId, period),
    getMonthlyMetrics(companyId, prior),
  ]);
  if (!current || !previous) {
    const missing = !current ? monthLabel(period) : monthLabel(prior);
    return {
      summary: `Explaining a change needs both ${monthLabel(period)} and ${monthLabel(prior)}, and ${missing} is not stored. Import it and ask again.`,
      data: { period: period.start, prior_period: prior.start, available: false, missing },
      caveats: [`${missing} is not stored, so the change cannot be decomposed.`],
    };
  }

  const rows = await categoryTotalsByPeriod(companyId, prior.start, period.start);
  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    if (!r.categoryKey) continue;
    if (r.periodStart === period.start) cur.set(r.categoryKey, r.amount);
    if (r.periodStart === prior.start) prev.set(r.categoryKey, r.amount);
  }

  const skip = new Set(['revenue', 'discounts', 'returns', 'other_income']);
  const movers = Array.from(new Set([...cur.keys(), ...prev.keys()]))
    .filter((key) => !skip.has(key))
    .map((key) => {
      const c = cur.get(key) ?? 0;
      const p = prev.get(key) ?? 0;
      return {
        category: categoryLabel(key),
        category_key: key,
        current: c,
        previous: p,
        change_amount: round2(c - p),
        change_pct: pctChange(c, p),
      };
    })
    .sort((a, b) => Math.abs(b.change_amount) - Math.abs(a.change_amount));

  // Decompose the profit change into the three effects a CFO would name.
  const revenueEffect = round2((current.netSales - previous.netSales) * (previous.grossMargin ?? 0));
  const marginEffect = round2(
    current.netSales * ((current.grossMargin ?? 0) - (previous.grossMargin ?? 0)),
  );
  const opexEffect = round2(-(current.operatingExpenses - previous.operatingExpenses));
  const otherEffect = round2(
    current.netIncome - previous.netIncome - revenueEffect - marginEffect - opexEffect,
  );

  const netChange = round2(current.netIncome - previous.netIncome);
  const direction = netChange >= 0 ? 'rose' : 'fell';
  const revChange = pctChange(current.netSales, previous.netSales);
  const opexChange = pctChange(current.operatingExpenses, previous.operatingExpenses);

  const increases = movers.filter((m) => m.change_amount > 0).slice(0, 4);
  const decreases = movers.filter((m) => m.change_amount < 0).slice(0, 3);

  return {
    summary: [
      `Net income ${direction} ${formatCurrency(Math.abs(netChange))} from ${formatCurrency(previous.netIncome)} in ${monthLabel(prior)} to ${formatCurrency(current.netIncome)} in ${monthLabel(period)}.`,
      `Breaking that down: the change in sales volume accounts for ${formatCurrency(revenueEffect)}, the gross margin change for ${formatCurrency(marginEffect)}, and the change in operating expenses for ${formatCurrency(opexEffect)}${Math.abs(otherEffect) >= 1 ? `, with ${formatCurrency(otherEffect)} from other income and expense` : ''}.`,
      revChange !== null && opexChange !== null
        ? `Revenue changed ${formatPercent(revChange, 1, { signed: true })} while operating expenses changed ${formatPercent(opexChange, 1, { signed: true })}, so ${describeCostLeverage(revChange, opexChange)}.`
        : '',
      increases.length
        ? `Largest expense increases: ${increases.map((m) => `${m.category} ${formatCurrency(m.change_amount)} to ${formatCurrency(m.current)}`).join('; ')}.`
        : 'No expense category increased.',
      decreases.length
        ? `Largest reductions: ${decreases.map((m) => `${m.category} ${formatCurrency(m.change_amount)}`).join('; ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    provenanceKeys: ['net_income', 'net_sales', 'gross_margin', 'operating_expenses'],
    caveats: [
      ...(previous.netSales === 0
        ? ['Prior-month revenue was zero, so percentage changes are not meaningful (N/M).']
        : []),
      ...(current.grossMargin === null || previous.grossMargin === null
        ? ['Gross margin could not be calculated for one of the periods, so the margin effect is excluded from the bridge.']
        : []),
    ],
    data: {
      period: period.start,
      prior_period: prior.start,
      net_income: current.netIncome,
      net_income_prior: previous.netIncome,
      net_income_change: netChange,
      revenue: current.netSales,
      revenue_prior: previous.netSales,
      revenue_change_pct: revChange,
      operating_expenses: current.operatingExpenses,
      operating_expenses_prior: previous.operatingExpenses,
      operating_expenses_change_pct: opexChange,
      gross_margin: current.grossMargin,
      gross_margin_prior: previous.grossMargin,
      bridge: {
        sales_volume_effect: revenueEffect,
        gross_margin_effect: marginEffect,
        operating_expense_effect: opexEffect,
        other_effect: otherEffect,
      },
      categories: movers.slice(0, 15),
      // The categories the summary actually names. Held separately from the
      // top-15 list so every figure stated in the answer is present in the
      // structured result the model is given -- a number in the prose that is
      // absent from the data would be unverifiable.
      largest_increases: increases,
      largest_reductions: decreases,
    },
  };
}

/**
 * Says what the relationship between revenue and cost growth means.
 *
 * "Expenses grew faster than sales" is wrong when both fell: costs did not
 * grow at all. An owner reading a cost line needs the direction stated
 * plainly, so each of the four cases gets its own sentence.
 */
function describeCostLeverage(revChange: number, opexChange: number): string {
  if (opexChange > revChange) {
    return revChange < 0 && opexChange < 0
      ? 'costs came down more slowly than revenue did'
      : 'costs grew faster than sales';
  }
  if (opexChange < revChange) {
    return revChange < 0 && opexChange < 0
      ? 'costs came down faster than revenue did'
      : 'costs grew more slowly than sales';
  }
  return 'costs moved in step with sales';
}

async function categoryDetail(
  companyId: string,
  period: Period,
  categoryKey: string | null,
  fiscalYearStartMonth: number,
): Promise<ResolvedAnswer> {
  if (!categoryKey) {
    return {
      summary: 'I could not tell which expense category you meant. Name it explicitly, for example "advertising" or "payroll".',
      data: { category: null },
      caveats: ['No category was identified in the question.'],
    };
  }
  const ytd = yearToDate(period, fiscalYearStartMonth);
  const rows = await categoryTotalsByPeriod(companyId, ytd.start, period.start);
  const monthly = rows.filter((r) => r.categoryKey === categoryKey);
  const current = monthly.find((r) => r.periodStart === period.start)?.amount ?? 0;
  const ytdTotal = round2(monthly.reduce((a, r) => a + r.amount, 0));
  const metrics = await getMonthlyMetrics(companyId, period);

  return {
    summary:
      monthly.length === 0
        ? `No ${categoryLabel(categoryKey)} activity is recorded between ${ytd.start} and ${period.end}. That may mean there was none, or that no account is mapped to ${categoryLabel(categoryKey)}.`
        : `${categoryLabel(categoryKey)} was ${formatCurrency(current)} in ${monthLabel(period)}${metrics ? ` (${formatPercent(safeDivide(current, metrics.netSales))} of revenue)` : ''}, and ${formatCurrency(ytdTotal)} year to date from ${ytd.start}.`,
    caveats:
      monthly.length === 0
        ? [`No accounts are mapped to ${categoryLabel(categoryKey)}, or the category had no activity.`]
        : [],
    data: {
      category: categoryLabel(categoryKey),
      category_key: categoryKey,
      period: period.start,
      amount: current,
      pct_of_revenue: metrics ? safeDivide(current, metrics.netSales) : null,
      ytd_total: ytdTotal,
      ytd_start: ytd.start,
      monthly: monthly.map((r) => ({ period: r.periodStart, amount: r.amount })),
    },
  };
}

async function vendorSpendAnswer(
  companyId: string,
  period: Period,
  limit: number,
): Promise<ResolvedAnswer> {
  const vendors = (await getVendorSpend(companyId, period)).slice(0, limit);
  if (vendors.length === 0) {
    return {
      summary: `No vendor transactions are stored for ${monthLabel(period)}, so I cannot rank vendors for that month.`,
      data: { period: period.start, vendors: [] },
      caveats: ['Vendor analysis needs transaction detail, which was not imported for this period.'],
    };
  }
  return {
    summary: `Largest vendors in ${monthLabel(period)}: ${vendors.map((v) => `${v.vendorName} ${formatCurrency(v.amount)}`).join(', ')}.`,
    data: {
      period: period.start,
      vendors: vendors.map((v) => ({ vendor: v.vendorName, amount: v.amount, transactions: v.txnCount })),
    },
  };
}

async function vendorLookup(
  companyId: string,
  period: Period,
  vendorHint: string | null,
  fiscalYearStartMonth: number,
): Promise<ResolvedAnswer> {
  if (!vendorHint) {
    return {
      summary: 'Name the vendor you want and I will total their spend, for example "How much did we pay Meta Platforms?".',
      data: { vendor: null },
    };
  }
  const ytd = yearToDate(period, fiscalYearStartMonth);
  const rows = await getVendorSpendRange(companyId, ytd.start, period.start);
  const needle = vendorHint.toLowerCase();
  const matches = rows.filter((r) => r.vendorName.toLowerCase().includes(needle));
  if (matches.length === 0) {
    return {
      summary: `No spend is recorded for a vendor matching "${vendorHint}" between ${ytd.start} and ${period.end}. Check the spelling, or the vendor may be recorded under a different name.`,
      data: { vendor: vendorHint, matched: false },
      caveats: [`No vendor matching "${vendorHint}" was found in the stored transactions.`],
    };
  }

  // A partial name can match several vendors; say so rather than silently
  // picking one and reporting its total as if it were the answer.
  const distinctNames = Array.from(new Set(matches.map((r) => r.vendorName)));
  if (distinctNames.length > 1) {
    const totals = distinctNames.map((n) => ({
      vendor: n,
      ytd_amount: round2(matches.filter((r) => r.vendorName === n).reduce((a, r) => a + r.amount, 0)),
    }));
    return {
      summary: `"${vendorHint}" matches ${distinctNames.length} vendors: ${totals.map((t) => `${t.vendor} ${formatCurrency(t.ytd_amount)} year to date`).join('; ')}. Ask again with the full name for a single vendor.`,
      data: { vendor_query: vendorHint, ambiguous: true, matches: totals, ytd_start: ytd.start },
      caveats: [`"${vendorHint}" is ambiguous — ${distinctNames.length} vendors match.`],
    };
  }

  const name = matches[0]?.vendorName ?? vendorHint;
  const monthAmount = matches.find((r) => r.periodStart === period.start)?.amount ?? 0;
  const ytdAmount = round2(matches.reduce((a, r) => a + r.amount, 0));
  return {
    summary: `${name} was paid ${formatCurrency(monthAmount)} in ${monthLabel(period)} and ${formatCurrency(ytdAmount)} year to date since ${ytd.start}.`,
    data: {
      vendor: name,
      period: period.start,
      month_amount: monthAmount,
      ytd_amount: ytdAmount,
      monthly: matches.map((m) => ({ period: m.periodStart, amount: m.amount })),
    },
  };
}

async function storePerformance(
  companyId: string,
  period: Period,
  classified: ClassifiedQuery,
): Promise<ResolvedAnswer> {
  const [current, prior, lastYear] = await Promise.all([
    getLocationMetrics(companyId, period),
    getLocationMetrics(companyId, priorMonth(period)),
    getLocationMetrics(companyId, sameMonthLastYear(period)),
  ]);
  if (current.length === 0) {
    return {
      summary:
        'This QuickBooks company has no Location or Class breakdown stored for that month, so store-level results are not available. Enable Locations or Classes in QuickBooks and re-sync to get them.',
      data: { period: period.start, stores: [] },
      caveats: ['No location or class data exists for this period.'],
    };
  }

  const silentStores = current.filter((s) => s.netSales === 0);
  const ranked = rankStores(current, prior, lastYear);
  const wantsPayroll = /payroll/i.test(classified.storeHint ?? '') || classified.categoryHint === 'payroll';
  const byPayroll = [...ranked].sort((a, b) => (b.payrollPct ?? 0) - (a.payrollPct ?? 0));
  const lead = ranked[0];
  const worst = ranked[ranked.length - 1];

  const summary = wantsPayroll
    ? `Payroll as a share of revenue by store in ${monthLabel(period)}: ${byPayroll.map((s) => `${s.dimensionName} ${formatPercent(s.payrollPct)}`).join(', ')}.`
    : `In ${monthLabel(period)}, ${lead?.dimensionName} led on contribution margin at ${formatPercent(lead?.contributionMargin ?? null)} on ${formatCurrency(lead?.netSales ?? 0)} of revenue; ${worst?.dimensionName} was weakest at ${formatPercent(worst?.contributionMargin ?? null)}. These are store contributions before corporate overhead.`;

  return {
    summary,
    caveats: [
      'Store figures are contribution before corporate overhead; shared costs are not allocated.',
      ...(silentStores.length > 0
        ? [`${silentStores.map((s) => s.dimensionName).join(', ')} recorded no revenue this period, so percentage comparisons for ${silentStores.length > 1 ? 'those stores' : 'that store'} are not meaningful.`]
        : []),
    ],
    data: {
      period: period.start,
      note: 'Shared corporate overhead is not allocated to stores.',
      stores: ranked.map((s) => ({
        store: s.dimensionName,
        revenue: s.netSales,
        revenue_change_mom: s.revenueMoM,
        revenue_change_yoy: s.revenueYoY,
        gross_profit: s.grossProfit,
        gross_margin: s.grossMargin,
        payroll: s.payrollExpense,
        payroll_pct_revenue: s.payrollPct,
        operating_expenses: s.operatingExpenses,
        contribution_profit: s.contributionProfit,
        contribution_margin: s.contributionMargin,
      })),
    },
  };
}

function marginTrend(allMetrics: Awaited<ReturnType<typeof listAllMetrics>>): ResolvedAnswer {
  const recent = allMetrics.slice(-12);
  const first = recent[0];
  const last = recent[recent.length - 1];
  return {
    summary: `Gross margin over the last ${recent.length} months moved from ${formatPercent(first?.grossMargin ?? null)} in ${monthLabel(first?.period ?? { start: '', end: '' })} to ${formatPercent(last?.grossMargin ?? null)} in ${monthLabel(last?.period ?? { start: '', end: '' })}.`,
    data: {
      trend: recent.map((m) => ({
        period: m.period.start,
        gross_margin: m.grossMargin,
        net_margin: m.netMargin,
        revenue: m.netSales,
      })),
    },
  };
}

async function cashAnswer(companyId: string, period: Period): Promise<ResolvedAnswer> {
  const [current, prior] = await Promise.all([
    getMonthlyMetrics(companyId, period),
    getMonthlyMetrics(companyId, priorMonth(period)),
  ]);
  if (!current || current.cash === null) {
    return {
      summary: `No verified cash balance is stored for ${monthLabel(period)}. A cash figure needs a Balance Sheet for that period, which was not captured.`,
      data: { period: period.start, cash: null },
      caveats: ['No Balance Sheet is stored for this period, so cash cannot be reported.'],
    };
  }
  const change = prior?.cash != null ? round2(current.cash - prior.cash) : null;
  return {
    summary: [
      `Cash at ${period.end} was ${formatCurrency(current.cash)}${change !== null ? `, ${change >= 0 ? 'up' : 'down'} ${formatCurrency(Math.abs(change))} from ${formatCurrency(prior?.cash ?? 0)} a month earlier` : ''}.`,
      `Net income for the month was ${formatCurrency(current.netIncome)}.`,
      change !== null && change < 0 && current.netIncome > 0
        ? 'Cash fell despite positive net income, so the difference sits in balance-sheet movements such as inventory, receivables, debt repayment or owner distributions.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    provenanceKeys: ['cash', 'net_income'],
    caveats:
      prior?.cash == null
        ? ['No prior-month cash balance is stored, so the change in cash cannot be calculated.']
        : [],
    data: {
      period: period.start,
      ending_cash: current.cash,
      beginning_cash: prior?.cash ?? null,
      change,
      net_income: current.netIncome,
      inventory: current.inventoryValue,
      accounts_receivable: current.accountsReceivable,
    },
  };
}

async function agingAnswer(
  companyId: string,
  period: Period,
  kind: 'receivable' | 'payable',
): Promise<ResolvedAnswer> {
  const aging = await getAging(companyId, kind, period.end);
  if (!aging) {
    return {
      summary: `No ${kind === 'receivable' ? 'receivables' : 'payables'} aging is stored as of ${period.end}, so I cannot break the balance down by age.`,
      data: { as_of: period.end, available: false },
      caveats: [`QuickBooks returned no ${kind} aging report for this period.`],
    };
  }
  const label = kind === 'receivable' ? 'Receivables' : 'Payables';
  const overdue = aging.entities
    .filter((e) => e.days31to60 + e.days61to90 + e.days90Plus > 0)
    .sort((a, b) => b.days90Plus - a.days90Plus || b.total - a.total)
    .slice(0, 5);

  return {
    summary: [
      `${label} at ${aging.asOf} total ${formatCurrency(aging.total.total)}: current ${formatCurrency(aging.total.current)}, 1-30 ${formatCurrency(aging.total.days1to30)}, 31-60 ${formatCurrency(aging.total.days31to60)}, 61-90 ${formatCurrency(aging.total.days61to90)}, over 90 ${formatCurrency(aging.total.days90Plus)}.`,
      overdue.length
        ? `Most overdue: ${overdue.map((e) => `${e.entityName} ${formatCurrency(e.days90Plus > 0 ? e.days90Plus : e.total)}`).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    data: {
      as_of: aging.asOf,
      kind,
      total: aging.total,
      top_overdue: overdue,
    },
  };
}

async function attentionAnswer(companyId: string, period: Period): Promise<ResolvedAnswer> {
  const anomalies = await getAnomalies(companyId, period);
  if (anomalies.length === 0) {
    return {
      summary: `No threshold alerts were raised for ${monthLabel(period)}.`,
      data: { period: period.start, alerts: [] },
    };
  }
  const top = anomalies.slice(0, 6);
  return {
    summary: `Priorities for ${monthLabel(period)}: ${top.map((a) => `[${a.severity}] ${a.title}`).join('; ')}.`,
    data: {
      period: period.start,
      alerts: top.map((a) => ({
        severity: a.severity,
        category: a.category,
        title: a.title,
        detail: a.detail,
        current_value: a.currentValue,
        comparison_value: a.comparisonValue,
        change_amount: a.deltaAmount,
      })),
    },
  };
}

function extremeMonths(
  allMetrics: Awaited<ReturnType<typeof listAllMetrics>>,
  direction: 'worst' | 'best',
  limit: number,
): ResolvedAnswer {
  const sorted = [...allMetrics].sort((a, b) =>
    direction === 'worst' ? a.netIncome - b.netIncome : b.netIncome - a.netIncome,
  );
  const picked = sorted.slice(0, Math.min(limit, 12));
  return {
    summary: `${direction === 'worst' ? 'Weakest' : 'Strongest'} months by net income: ${picked.map((m) => `${monthLabel(m.period)} ${formatCurrency(m.netIncome)} on ${formatCurrency(m.netSales)} of revenue`).join('; ')}.`,
    data: {
      direction,
      months: picked.map((m) => ({
        period: m.period.start,
        revenue: m.netSales,
        net_income: m.netIncome,
        gross_margin: m.grossMargin,
      })),
    },
  };
}

async function yearComparison(
  companyId: string,
  period: Period,
  fiscalYearStartMonth: number,
): Promise<ResolvedAnswer> {
  const ytd = yearToDate(period, fiscalYearStartMonth);
  const pytd = priorYearToDate(period, fiscalYearStartMonth);
  const [ytdRows, pytdRows] = await Promise.all([
    getMetricsRange(companyId, ytd.start, period.start),
    getMetricsRange(companyId, pytd.start, pytd.end),
  ]);
  const current = aggregateMetrics(ytdRows, ytd);
  const previous = aggregateMetrics(pytdRows, pytd);
  if (!current) {
    return {
      summary: 'No months of the current fiscal year are stored, so there is no year-to-date figure to report.',
      data: { available: false },
      caveats: ['No year-to-date data is stored.'],
    };
  }
  return {
    summary: [
      `Year to date (${ytd.start} to ${ytd.end}): revenue ${formatCurrency(current.netSales)}, gross profit ${formatCurrency(current.grossProfit)} (${formatPercent(current.grossMargin)}), net income ${formatCurrency(current.netIncome)}.`,
      previous
        ? `Prior year to date: revenue ${formatCurrency(previous.netSales)} (${formatPercent(pctChange(current.netSales, previous.netSales), 1, { signed: true })}), net income ${formatCurrency(previous.netIncome)}.`
        : 'No comparable prior-year period is stored, so the year-over-year comparison cannot be calculated.',
    ].join(' '),
    provenanceKeys: ['net_sales', 'gross_profit', 'net_income'],
    caveats: previous ? [] : ['The prior-year period is not stored, so no year-over-year change is available.'],
    data: {
      ytd_start: ytd.start,
      ytd_end: ytd.end,
      ytd: {
        revenue: current.netSales,
        gross_profit: current.grossProfit,
        gross_margin: current.grossMargin,
        operating_expenses: current.operatingExpenses,
        net_income: current.netIncome,
      },
      prior_ytd: previous
        ? {
            revenue: previous.netSales,
            gross_profit: previous.grossProfit,
            gross_margin: previous.grossMargin,
            net_income: previous.netIncome,
          }
        : null,
      revenue_change_pct: previous ? pctChange(current.netSales, previous.netSales) : null,
    },
  };
}

export { trailingMonths };
