import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricsFixture } from '../fixtures/metrics';

/**
 * AI numeric safety.
 *
 * The rule under test is the one that makes this application safe to run a
 * business on: **the model never produces a number.** Every figure comes from
 * the deterministic resolver, and where the resolver cannot compute something
 * the answer must say so.
 *
 * These tests therefore run the chat pipeline with OpenAI deliberately
 * unconfigured, which is the strongest form of the assertion: the answer the
 * owner sees is exactly the application's own arithmetic. Each case builds a
 * month designed to break naive code — zero revenue, a missing comparison
 * period, refunds larger than sales — and asserts on what the pipeline says.
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

// The narration step is skipped when no key is present, leaving the
// deterministic answer verbatim. That is what these assertions read.
delete process.env['OPENAI_API_KEY'];

suite('AI numeric safety', () => {
  let pool: typeof import('@/lib/db/pool');
  let userId: string;
  let companyId: string;
  let ask: (question: string) => Promise<import('@/lib/ai/nlq').NlqResult>;

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { createCompany } = await import('@/lib/db/repositories/companies');
    const { saveMonthlyMetrics } = await import('@/lib/db/repositories/metrics');
    const { answerQuestion } = await import('@/lib/ai/nlq');

    await runMigrations();
    const email = 'ai-safety-test@example.invalid';
    const existing = await findUserByEmail(email);
    userId = existing?.id ?? (await createUser({ email, password: 'ai-safety-test-password' })).id;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);

    const company = await createCompany({
      ownerUserId: userId,
      name: 'Edge Case Furnishings',
      fiscalYearStartMonth: 1,
    });
    companyId = company.id;

    // A deliberately awkward three-month history.
    //
    //  2026-04  a normal month, and the only one with a balance sheet
    //  2026-05  zero revenue (every ratio of revenue is undefined)
    //  2026-06  refunds exceed gross sales, so net sales are negative
    //
    // Note there is no 2026-03 and no 2025 at all: month-over-month for April
    // and every year-over-year comparison are genuinely uncomputable.
    await saveMonthlyMetrics(
      metricsFixture(companyId, '2026-04', {
        grossSales: 500_000, netSales: 500_000, cogs: 275_000,
        grossProfit: 225_000, grossMargin: 0.45,
        operatingExpenses: 180_000, payrollExpense: 120_000, advertisingExpense: 30_000,
        netOperatingIncome: 45_000, netIncome: 45_000, netMargin: 0.09,
        cash: 300_000, accountsReceivable: 150_000, accountsPayable: 90_000,
        inventoryValue: 800_000, totalAssets: 1_250_000, totalLiabilities: 400_000,
        equity: 850_000, balanceSheetBalanced: true,
      }),
    );
    await saveMonthlyMetrics(
      metricsFixture(companyId, '2026-05', {
        grossSales: 0, netSales: 0, cogs: 0, grossProfit: 0, grossMargin: null,
        operatingExpenses: 165_000, payrollExpense: 118_000,
        netOperatingIncome: -165_000, netIncome: -165_000, netMargin: null,
        // No balance sheet was captured for this month.
        cash: null,
      }),
    );
    await saveMonthlyMetrics(
      metricsFixture(companyId, '2026-06', {
        grossSales: 120_000, refunds: 190_000, netSales: -70_000,
        cogs: -38_500, grossProfit: -31_500, grossMargin: 0.45,
        operatingExpenses: 170_000,
        netOperatingIncome: -201_500, netIncome: -201_500, netMargin: null,
        cash: null,
      }),
    );

    ask = (question: string) => answerQuestion({ companyId, question });
  }, 120_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.getPool().end();
  });

  /** Every dollar figure the answer states, normalised for comparison. */
  function dollarsIn(text: string): number[] {
    return (text.match(/-?\$[\d,]+(?:\.\d{2})?/g) ?? []).map((s) =>
      Number(s.replace(/[$,]/g, '')),
    );
  }

  it('1. refuses a metric it does not track rather than inventing one', async () => {
    const result = await ask('What was our EBITDA-adjusted customer lifetime value in April 2026?');

    expect(result.intent).toBe('unknown');
    expect(result.aiUsed).toBe(false);
    expect(result.answer).toMatch(/could not match that question/i);
    expect(result.caveats.join(' ')).toMatch(/no figures were computed/i);
    // The decisive assertion: no number at all was produced.
    expect(dollarsIn(result.answer)).toEqual([]);
  });

  it('2. states that a comparison period is missing instead of estimating it', async () => {
    const result = await ask('How did April 2026 revenue compare with the same month last year?');

    const text = `${result.answer} ${result.caveats.join(' ')}`;
    expect(text).toMatch(/not stored|cannot be calculated/i);
    // April 2025 was never imported; no year-over-year percentage may appear.
    expect(result.data['revenue_change_yoy'] ?? null).toBeNull();
    expect(result.answer).not.toMatch(/year over year/i);
  });

  it('3. reports N/M rather than dividing by zero', async () => {
    const result = await ask('Summarise May 2026.');

    // Revenue is zero: margin and every ratio of revenue are undefined.
    expect(result.data['revenue']).toBe(0);
    expect(result.data['net_margin'] ?? null).toBeNull();
    expect(result.caveats.join(' ')).toMatch(/not meaningful \(N\/M\)/);
    expect(result.answer).not.toMatch(/Infinity|NaN/);
    // A percent-change against a zero base is never printed as a number.
    const compare = await ask('Compare May 2026 with April 2026.');
    expect(compare.answer).not.toMatch(/Infinity|NaN/);
  });

  it('4. flags an unmapped category instead of reporting a confident total', async () => {
    const result = await ask('How much did we spend on advertising in June 2026?');

    // No account_metrics rows exist for this company at all, so nothing is
    // mapped to advertising. The answer must say that, not report $0 as fact.
    expect(result.answer).toMatch(/no account is mapped|No Advertising activity/i);
    expect(result.caveats.join(' ')).toMatch(/mapped/i);
  });

  it('5. says a store breakdown is unavailable when no dimension data exists', async () => {
    const result = await ask('Which store had the best margin in April 2026?');

    expect(result.answer).toMatch(/no Location or Class breakdown stored/i);
    expect(result.caveats.join(' ')).toMatch(/No location or class data/i);
    expect(dollarsIn(result.answer)).toEqual([]);
  });

  it('6. does not answer a vendor question when no vendor matches', async () => {
    const result = await ask('How much did we pay Nonexistent Supplier Co?');

    expect(result.answer).toMatch(/No spend is recorded/i);
    expect(result.data['matched']).toBe(false);
    expect(dollarsIn(result.answer)).toEqual([]);
  });

  it('7. leaves a period unanswerable when its report was never stored', async () => {
    // February 2026 was never imported — the equivalent of a failed report
    // fetch. The pipeline must not interpolate between March and April.
    const result = await ask('Summarise 2026-02.');

    expect(result.data['available']).toBe(false);
    expect(result.answer).toMatch(/do not have stored financial data/i);
    expect(dollarsIn(result.answer)).toEqual([]);
  });

  it('8. does not extrapolate a 12-month trend from 3 months of history', async () => {
    const result = await ask('What has the gross margin trend been over the last 12 months?');

    const trend = result.data['trend'] as Array<Record<string, unknown>>;
    expect(trend).toHaveLength(3);
    // The answer names the window it actually had, not the window asked for.
    expect(result.answer).toMatch(/last 3 months/);
    expect(result.answer).not.toMatch(/last 12 months/);
  });

  it('9. reports a negative-revenue month as negative, with no ratios', async () => {
    const result = await ask('Summarise June 2026.');

    expect(result.data['revenue']).toBe(-70_000);
    expect(result.answer).toMatch(/-\$70,000/);
    expect(result.data['net_margin'] ?? null).toBeNull();
    expect(result.answer).not.toMatch(/NaN|Infinity/);
  });

  it('10. keeps refunds exceeding gross sales visible instead of clamping to zero', async () => {
    const { getMonthlyMetrics } = await import('@/lib/db/repositories/metrics');
    const { monthPeriodOf } = await import('@/lib/util/dates');
    const june = await getMonthlyMetrics(companyId, monthPeriodOf('2026-06-01'));

    expect(june?.grossSales).toBe(120_000);
    expect(june?.refunds).toBe(190_000);
    // Net sales stay negative: the figure is reported, not floored at zero.
    expect(june?.netSales).toBe(-70_000);
    expect(june?.netSales).toBeLessThan(0);
  });

  it('11. declines to state cash when no balance sheet was captured', async () => {
    const result = await ask('How much cash did we have at the end of May 2026?');

    expect(result.answer).toMatch(/No verified cash balance is stored/i);
    expect(result.data['cash'] ?? null).toBeNull();
    expect(result.caveats.join(' ')).toMatch(/No Balance Sheet is stored/i);
    expect(dollarsIn(result.answer)).toEqual([]);
  });

  it('labels every answer with its accounting basis and prompt version', async () => {
    const result = await ask('Summarise April 2026.');

    expect(result.basisLabel).toBe('Accrual Basis');
    expect(result.accountingMethod).toBe('Accrual');
    expect(result.data['accounting_basis']).toBe('Accrual');
    expect(result.promptVersion).toBe('deterministic_v1.0');
    // Provenance travels with the figures so "how was this calculated" works.
    expect(result.provenance.length).toBeGreaterThan(0);
  });

  it('never emits a placeholder or an unformatted number', async () => {
    const questions = [
      'Summarise April 2026.',
      'Summarise May 2026.',
      'Summarise June 2026.',
      'Compare June 2026 with May 2026.',
      'Why did profit change in June 2026?',
      'What is our cash position?',
      'What needs my attention in May 2026?',
      'What were our worst months?',
    ];
    for (const q of questions) {
      const { answer } = await ask(q);
      expect(answer, q).not.toMatch(/NaN|Infinity|undefined|null|\[object Object\]|\$\s|XX|TBD/);
    }
  });
});
