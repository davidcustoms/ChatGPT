/**
 * Date helpers. All period boundaries are handled as calendar dates in
 * `YYYY-MM-DD` form (never Date objects with a timezone) so that a reporting
 * month means the same thing on every machine.
 */

export type IsoDate = string; // YYYY-MM-DD

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
    return toIsoDate(parsed);
  }
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid ISO date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last calendar day of the given month (1-indexed month). */
export function monthPeriod(year: number, month: number): Period {
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

/** Month period from any date inside the month. */
export function monthPeriodOf(date: IsoDate): Period {
  const { year, month } = parseIsoDate(date);
  return monthPeriod(year, month);
}

export function addMonths(period: Period, delta: number): Period {
  const { year, month } = parseIsoDate(period.start);
  const zeroBased = year * 12 + (month - 1) + delta;
  return monthPeriod(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

export function priorMonth(period: Period): Period {
  return addMonths(period, -1);
}

export function sameMonthLastYear(period: Period): Period {
  return addMonths(period, -12);
}

/** Inclusive list of the N months ending with (and including) `period`. */
export function trailingMonths(period: Period, count: number): Period[] {
  const out: Period[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addMonths(period, -i));
  return out;
}

/**
 * Year-to-date window ending at `period.end`, honouring a fiscal year that may
 * not start in January.
 */
export function yearToDate(period: Period, fiscalYearStartMonth = 1): Period {
  const { year, month } = parseIsoDate(period.start);
  const startYear = month >= fiscalYearStartMonth ? year : year - 1;
  return {
    start: `${startYear}-${pad2(fiscalYearStartMonth)}-01`,
    end: period.end,
  };
}

/** Same YTD window shifted back one year (prior-year-to-date). */
export function priorYearToDate(period: Period, fiscalYearStartMonth = 1): Period {
  const ytd = yearToDate(period, fiscalYearStartMonth);
  const start = parseIsoDate(ytd.start);
  const end = parseIsoDate(ytd.end);
  const endLastYear = monthPeriod(end.year - 1, end.month);
  return {
    start: `${start.year - 1}-${pad2(start.month)}-01`,
    end: endLastYear.end,
  };
}

export function monthLabel(period: Period, style: 'long' | 'short' = 'long'): string {
  const { year, month } = parseIsoDate(period.start);
  const name = MONTH_NAMES[month - 1] ?? '';
  return style === 'long' ? `${name} ${year}` : `${name.slice(0, 3)} ${String(year).slice(2)}`;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/** Number of whole months between two periods (b - a). */
export function monthsBetween(a: Period, b: Period): number {
  const pa = parseIsoDate(a.start);
  const pb = parseIsoDate(b.start);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

export function periodKey(period: Period): string {
  return period.start.slice(0, 7);
}

/** The most recently *completed* calendar month relative to `today`. */
export function lastClosedMonth(today: Date = new Date()): Period {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  return addMonths(monthPeriod(y, m), -1);
}

/** True when the period's end date is in the future (month not yet complete). */
export function isPeriodIncomplete(period: Period, today: Date = new Date()): boolean {
  return period.end >= toIsoDate(today);
}

export function isWeekend(date: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(date);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}
