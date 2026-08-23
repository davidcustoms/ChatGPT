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
  /** Deterministic answer used when the model is unavailable. */
  deterministicAnswer: string;
  aiUsed: boolean;
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
      deterministicAnswer: 'No financial data is stored for this company yet.',
      aiUsed: false,
    };
  }

  const availableKeys = allMetrics.map((m) => m.period.start.slice(0, 7));
  const latest = (await latestMetricsPeriod(input.companyId)) as Period;

  // Newest first: "compare June and July" should read as July against June,
  // which is how an owner phrases the change they care about.
  const resolvedPeriods = Array.from(
    new Set(
      classified.periodHints
        .map((h) => resolvePeriodHint(h, availableKeys))
        .filter((p): p is string => p !== null),
    ),
  )
    .sort((a, b) => b.localeCompare(a))
    .map(periodFromKey);

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

  let answer = resolved.summary;
  let aiUsed = false;
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
              '',
              'VERIFIED RESULT (the only numbers you may use):',
              JSON.stringify(resolved.data, null, 2),
              '',
              'APPLICATION-COMPUTED ANSWER (already correct; reword it clearly, do not change any number):',
              resolved.summary,
            ].join('\n'),
          },
        ],
      });
      const content = completion.choices[0]?.message?.content?.trim();
      if (content) {
        answer = content;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn('chat narration failed, using deterministic answer', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    answer,
    intent: classified.intent,
    data: resolved.data,
    dataThrough,
    source,
    deterministicAnswer: resolved.summary,
    aiUsed,
  };
}

interface ResolvedAnswer {
  summary: string;
  data: Record<string, unknown>;
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
          'I could not match that question to a supported report. Try asking about revenue, margin, a specific expense category, a vendor, a store, cash, receivables or payables for a given month.',
        data: { intent: 'unknown' },
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
      summary: `No stored financial data for ${monthLabel(period)}.`,
      data: { period: period.start, available: false },
    };
  }
  const mom = prior ? pctChange(current.netSales, prior.netSales) : null;
  const yoy = lastYear ? pctChange(current.netSales, lastYear.netSales) : null;

  return {
    summary: [
      `${monthLabel(period)}: revenue ${formatCurrency(current.netSales)}${mom !== null ? ` (${formatPercent(mom, 1, { signed: true })} vs prior month)` : ''}${yoy !== null ? `, ${formatPercent(yoy, 1, { signed: true })} year over year` : ''}.`,
      `Gross profit ${formatCurrency(current.grossProfit)} at a ${formatPercent(current.grossMargin)} margin.`,
      `Operating expenses ${formatCurrency(current.operatingExpenses)}; net income ${formatCurrency(current.netIncome)}${current.netMargin !== null ? ` (${formatPercent(current.netMargin)} net margin)` : ''}.`,
      `Cash ${formatCurrency(current.cash)}, A/R ${formatCurrency(current.accountsReceivable)}, A/P ${formatCurrency(current.accountsPayable)}.`,
    ].join(' '),
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
    return {
      summary: `I do not have stored data for both ${monthLabel(a)} and ${monthLabel(b)}.`,
      data: { a: a.start, b: b.start, available: false },
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
    return {
      summary: `I need both ${monthLabel(period)} and ${monthLabel(prior)} to explain the change, and one of them is not stored.`,
      data: { period: period.start, prior_period: prior.start, available: false },
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
        ? `Revenue changed ${formatPercent(revChange, 1, { signed: true })} while operating expenses changed ${formatPercent(opexChange, 1, { signed: true })}, so expenses grew ${opexChange > revChange ? 'faster' : 'slower'} than sales.`
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
    },
  };
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
    };
  }
  const ytd = yearToDate(period, fiscalYearStartMonth);
  const rows = await categoryTotalsByPeriod(companyId, ytd.start, period.start);
  const monthly = rows.filter((r) => r.categoryKey === categoryKey);
  const current = monthly.find((r) => r.periodStart === period.start)?.amount ?? 0;
  const ytdTotal = round2(monthly.reduce((a, r) => a + r.amount, 0));
  const metrics = await getMonthlyMetrics(companyId, period);

  return {
    summary: `${categoryLabel(categoryKey)} was ${formatCurrency(current)} in ${monthLabel(period)}${metrics ? ` (${formatPercent(safeDivide(current, metrics.netSales))} of revenue)` : ''}, and ${formatCurrency(ytdTotal)} year to date from ${ytd.start}.`,
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
      summary: `No vendor transactions are stored for ${monthLabel(period)}.`,
      data: { period: period.start, vendors: [] },
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
      summary: `No spend recorded for a vendor matching "${vendorHint}" between ${ytd.start} and ${period.end}.`,
      data: { vendor: vendorHint, matched: false },
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
        'This QuickBooks company has no Location or Class breakdown stored for that month, so store-level results are not available.',
      data: { period: period.start, stores: [] },
    };
  }
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
      summary: `No verified cash balance is stored for ${monthLabel(period)}.`,
      data: { period: period.start, cash: null },
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
      summary: `No ${kind === 'receivable' ? 'receivables' : 'payables'} aging is stored as of ${period.end}.`,
      data: { as_of: period.end, available: false },
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
    return { summary: 'No year-to-date data is stored yet.', data: { available: false } };
  }
  return {
    summary: [
      `Year to date (${ytd.start} to ${ytd.end}): revenue ${formatCurrency(current.netSales)}, gross profit ${formatCurrency(current.grossProfit)} (${formatPercent(current.grossMargin)}), net income ${formatCurrency(current.netIncome)}.`,
      previous
        ? `Prior year to date: revenue ${formatCurrency(previous.netSales)} (${formatPercent(pctChange(current.netSales, previous.netSales), 1, { signed: true })}), net income ${formatCurrency(previous.netIncome)}.`
        : 'No comparable prior-year period is stored.',
    ].join(' '),
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
