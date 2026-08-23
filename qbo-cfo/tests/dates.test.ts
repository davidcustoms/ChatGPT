import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysInMonth,
  isPeriodIncomplete,
  isWeekend,
  lastClosedMonth,
  monthLabel,
  monthPeriod,
  monthPeriodOf,
  monthsBetween,
  priorMonth,
  priorYearToDate,
  sameMonthLastYear,
  trailingMonths,
  yearToDate,
} from '@/lib/util/dates';

describe('month periods', () => {
  it('produces the full calendar month', () => {
    expect(monthPeriod(2026, 8)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(monthPeriod(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(monthPeriod(2024, 2).end).toBe('2024-02-29');
  });

  it('derives the period from any date inside the month', () => {
    expect(monthPeriodOf('2026-08-17')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });
});

describe('period arithmetic', () => {
  it('steps across year boundaries', () => {
    expect(addMonths(monthPeriod(2026, 1), -1)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(addMonths(monthPeriod(2025, 12), 1)).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('finds the prior month and the same month last year', () => {
    const august = monthPeriod(2026, 8);
    expect(priorMonth(august).start).toBe('2026-07-01');
    expect(sameMonthLastYear(august)).toEqual({ start: '2025-08-01', end: '2025-08-31' });
  });

  it('handles the 31-to-30 day step without overflowing', () => {
    expect(priorMonth(monthPeriod(2026, 3))).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('lists trailing months inclusive of the current one', () => {
    const t12 = trailingMonths(monthPeriod(2026, 8), 12);
    expect(t12).toHaveLength(12);
    expect(t12[0]?.start).toBe('2025-09-01');
    expect(t12[11]?.start).toBe('2026-08-01');
  });

  it('measures the distance between periods', () => {
    expect(monthsBetween(monthPeriod(2025, 8), monthPeriod(2026, 8))).toBe(12);
  });
});

describe('year to date', () => {
  it('starts in January for a calendar fiscal year', () => {
    expect(yearToDate(monthPeriod(2026, 8), 1)).toEqual({ start: '2026-01-01', end: '2026-08-31' });
  });

  it('honours a non-calendar fiscal year', () => {
    // Fiscal year starting July: August 2026 is month two of FY2027.
    expect(yearToDate(monthPeriod(2026, 8), 7)).toEqual({ start: '2026-07-01', end: '2026-08-31' });
    // February 2026 still belongs to the fiscal year that began July 2025.
    expect(yearToDate(monthPeriod(2026, 2), 7)).toEqual({ start: '2025-07-01', end: '2026-02-28' });
  });

  it('shifts the whole window back one year for prior YTD', () => {
    expect(priorYearToDate(monthPeriod(2026, 8), 1)).toEqual({ start: '2025-01-01', end: '2025-08-31' });
    expect(priorYearToDate(monthPeriod(2026, 2), 7)).toEqual({ start: '2024-07-01', end: '2025-02-28' });
  });
});

describe('calendar helpers', () => {
  it('names the month', () => {
    expect(monthLabel(monthPeriod(2026, 8))).toBe('August 2026');
    expect(monthLabel(monthPeriod(2026, 8), 'short')).toBe('Aug 26');
  });

  it('finds the last closed month', () => {
    expect(lastClosedMonth(new Date('2026-08-23T00:00:00Z'))).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
    expect(lastClosedMonth(new Date('2026-01-02T00:00:00Z')).start).toBe('2025-12-01');
  });

  it('detects an incomplete reporting month', () => {
    const today = new Date('2026-08-23T00:00:00Z');
    expect(isPeriodIncomplete(monthPeriod(2026, 8), today)).toBe(true);
    expect(isPeriodIncomplete(monthPeriod(2026, 7), today)).toBe(false);
  });

  it('detects weekends', () => {
    expect(isWeekend('2026-08-22')).toBe(true); // Saturday
    expect(isWeekend('2026-08-24')).toBe(false); // Monday
  });
});
