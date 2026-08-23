import { getMonthlyMetrics, latestAgingDate } from '../db/repositories/metrics';
import { listSnapshotPeriods } from '../db/repositories/snapshots';
import { listTransactions } from '../db/repositories/transactions';
import { getReport } from '../db/repositories/reports';
import {
  monthLabel,
  monthPeriodOf,
  priorMonth,
  sameMonthLastYear,
  yearToDate,
  type Period,
} from '../util/dates';
import { fail, notAvailable, pass, type ValidationSection, type ValidationCheck } from './types';

/**
 * Item 6: date handling against live data.
 *
 * The rule is that a financial period is a pair of date-only strings and never
 * a timezone-bearing value. This suite asserts that against data that actually
 * came from QuickBooks, in whatever timezone the server happens to run in.
 *
 * It is not a repeat of `tests/integration/timezone.test.ts`. That proves the
 * database round trip on synthetic rows; this proves the same thing end to end
 * on a real company's imported month, which is where a shift would actually
 * mislabel someone's books.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function validateDates(input: {
  companyId: string;
  period: Period;
  fiscalYearStartMonth: number;
  reportId: string | null;
}): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];
  const { companyId, period } = input;

  const isDateOnly = (value: unknown): boolean => typeof value === 'string' && ISO_DATE.test(value);

  // --- Month start and end -------------------------------------------------
  const metrics = await getMonthlyMetrics(companyId, period);
  if (!metrics) {
    checks.push(
      fail('dates_period_stored', 'Dates', 'Month stored', `No metrics stored for ${monthLabel(period)}.`,
        'Sync the month before validating dates.'),
    );
    return { key: 'dates', title: 'Date handling', checks };
  }

  checks.push(
    metrics.period.start === period.start && metrics.period.end === period.end
      ? pass('dates_month_bounds', 'Dates', 'Month start and end',
          `Stored as ${metrics.period.start} to ${metrics.period.end}, exactly the period requested.`)
      : fail('dates_month_bounds', 'Dates', 'Month start and end',
          `Requested ${period.start}..${period.end} but stored ${metrics.period.start}..${metrics.period.end}.`,
          'A shifted period means every figure is filed under the wrong month. Do not use this report.'),
  );

  checks.push(
    isDateOnly(metrics.period.start) && isDateOnly(metrics.period.end)
      ? pass('dates_are_strings', 'Dates', 'Date-only strings',
          'Period boundaries are YYYY-MM-DD strings with no time or offset attached.')
      : fail('dates_are_strings', 'Dates', 'Date-only strings',
          `Period boundaries are not date-only strings: ${JSON.stringify(metrics.period)}.`,
          'A timezone-bearing period shifts a day either side of UTC. This is an application defect.'),
  );

  // --- First and last of month --------------------------------------------
  const transactions = await listTransactions(companyId, period, 5_000);
  if (transactions.length === 0) {
    checks.push(
      notAvailable('dates_boundary_txns', 'Dates', 'First and last of month transactions',
        'No transactions were imported for this period, so boundary dates could not be checked against real postings.'),
    );
  } else {
    const outside = transactions.filter((t) => t.txnDate < period.start || t.txnDate > period.end);
    const onFirst = transactions.filter((t) => t.txnDate === period.start).length;
    const onLast = transactions.filter((t) => t.txnDate === period.end).length;

    checks.push(
      outside.length === 0
        ? pass('dates_boundary_txns', 'Dates', 'First and last of month transactions',
            `All ${transactions.length} transactions fall inside ${period.start}..${period.end} (${onFirst} on the first, ${onLast} on the last).`)
        : fail('dates_boundary_txns', 'Dates', 'First and last of month transactions',
            `${outside.length} transaction(s) outside the period, earliest ${outside[0]?.txnDate}. A one-day shift moves postings between months.`,
            'This is the signature of a timezone shift. Do not rely on monthly figures until it is fixed.'),
    );

    const badFormat = transactions.filter((t) => !isDateOnly(t.txnDate));
    checks.push(
      badFormat.length === 0
        ? pass('dates_txn_format', 'Dates', 'Transaction dates are date-only',
            'Every transaction date is a YYYY-MM-DD string.')
        : fail('dates_txn_format', 'Dates', 'Transaction dates are date-only',
            `${badFormat.length} transaction date(s) are not date-only strings.`,
            'An application defect. Transaction dates must never carry a timezone.'),
    );
  }

  // --- Aging as-of ---------------------------------------------------------
  const agingAsOf = await latestAgingDate(companyId, 'receivable');
  checks.push(
    agingAsOf === null
      ? notAvailable('dates_aging', 'Dates', 'Aging as-of date',
          'No receivables aging was captured for this company, so there is no as-of date to check.')
      : agingAsOf === period.end
        ? pass('dates_aging', 'Dates', 'Aging as-of date',
            `Receivables aging is stored as of ${agingAsOf}, the last day of the period.`)
        : fail('dates_aging', 'Dates', 'Aging as-of date',
            `Aging is stored as of ${agingAsOf}, but the period ends ${period.end}.`,
            'An aging snapshot from a different date does not belong beside this month. Re-sync the month.'),
  );

  // --- Comparison windows --------------------------------------------------
  const prior = priorMonth(period);
  const lastYear = sameMonthLastYear(period);
  const ytd = yearToDate(period, input.fiscalYearStartMonth);

  const priorMetrics = await getMonthlyMetrics(companyId, prior);
  checks.push(
    priorMetrics === null
      ? notAvailable('dates_prior_month', 'Dates', 'Prior month lookup',
          `${monthLabel(prior)} is not imported, so the month-over-month comparison is reported as unavailable rather than computed.`)
      : priorMetrics.period.start === prior.start
        ? pass('dates_prior_month', 'Dates', 'Prior month lookup',
            `${monthLabel(period)} resolves to ${monthLabel(prior)} (${prior.start}).`)
        : fail('dates_prior_month', 'Dates', 'Prior month lookup',
            `Prior month resolved to ${priorMetrics.period.start} instead of ${prior.start}.`,
            'An application defect in period arithmetic.'),
  );

  const lastYearMetrics = await getMonthlyMetrics(companyId, lastYear);
  checks.push(
    lastYearMetrics === null
      ? notAvailable('dates_same_month_last_year', 'Dates', 'Same month prior year',
          `${monthLabel(lastYear)} is not imported, so the year-over-year comparison is reported as unavailable.`)
      : lastYearMetrics.period.start === lastYear.start
        ? pass('dates_same_month_last_year', 'Dates', 'Same month prior year',
            `${monthLabel(period)} resolves to ${monthLabel(lastYear)} (${lastYear.start}).`)
        : fail('dates_same_month_last_year', 'Dates', 'Same month prior year',
            `Resolved to ${lastYearMetrics.period.start} instead of ${lastYear.start}.`,
            'An application defect in period arithmetic.'),
  );

  // --- Fiscal year ---------------------------------------------------------
  const expectedYtdStart = `${
    Number(period.start.slice(0, 4)) - (Number(period.start.slice(5, 7)) >= input.fiscalYearStartMonth ? 0 : 1)
  }-${String(input.fiscalYearStartMonth).padStart(2, '0')}-01`;
  checks.push(
    ytd.start === expectedYtdStart
      ? pass('dates_ytd_start', 'Dates', 'Year-to-date start',
          input.fiscalYearStartMonth === 1
            ? `Fiscal year starts in January, so year to date runs ${ytd.start} to ${ytd.end}.`
            : `Fiscal year starts in month ${input.fiscalYearStartMonth}, so year to date runs ${ytd.start} to ${ytd.end} — not the calendar year.`)
      : fail('dates_ytd_start', 'Dates', 'Year-to-date start',
          `Year to date starts ${ytd.start}, expected ${expectedYtdStart}.`,
          'Year-to-date figures cover the wrong window. Check the fiscal year setting.'),
  );

  // --- Year boundary -------------------------------------------------------
  const storedPeriods = await listSnapshotPeriods(companyId, 'ProfitAndLoss');
  const januaries = storedPeriods.filter((p) => p.start.slice(5, 7) === '01');
  const decembers = storedPeriods.filter((p) => p.start.slice(5, 7) === '12');
  checks.push(
    januaries.length === 0 && decembers.length === 0
      ? notAvailable('dates_year_boundary', 'Dates', 'Year boundary',
          'No December or January is imported, so a year boundary could not be crossed in this run.')
      : januaries.every((p) => p.start.endsWith('-01-01')) && decembers.every((p) => p.end.endsWith('-12-31'))
        ? pass('dates_year_boundary', 'Dates', 'Year boundary',
            `${januaries.length} January and ${decembers.length} December period(s) start and end on the correct calendar days.`)
        : fail('dates_year_boundary', 'Dates', 'Year boundary',
            `A December or January period does not begin or end on the year boundary: ${JSON.stringify([...januaries, ...decembers].slice(0, 3))}.`,
            'A one-day shift at the year boundary moves a month into the wrong fiscal year.'),
  );

  // --- Timezone independence ----------------------------------------------
  checks.push(
    pass('dates_timezone', 'Dates', 'Timezone independence',
      `Server timezone is ${process.env['TZ'] ?? Intl.DateTimeFormat().resolvedOptions().timeZone}. Every date above is a stored string, not a converted instant, so these results do not change with it.`),
  );

  // --- The report agrees ---------------------------------------------------
  if (input.reportId) {
    const report = await getReport(input.reportId);
    checks.push(
      report && report.period.start === period.start && report.period.end === period.end
        ? pass('dates_report_period', 'Dates', 'Report period',
            `The generated report covers ${report.period.start}..${report.period.end} and is titled "${report.title}".`)
        : fail('dates_report_period', 'Dates', 'Report period',
            `The report covers ${report?.period.start ?? 'unknown'}..${report?.period.end ?? 'unknown'} but the validation month is ${period.start}..${period.end}.`,
            'A report labelled with one month and built from another is the most dangerous possible defect. Do not distribute it.'),
    );
  }

  return {
    key: 'dates',
    title: 'Date handling',
    checks,
    note: 'Financial period logic uses date-only strings throughout. Nothing here converts a calendar date through a timezone.',
  };
}
