import { describe, expect, it } from 'vitest';
import {
  average,
  currentRatio,
  grossMargin,
  grossProfit,
  marginImpact,
  netMargin,
  pctChange,
  pointChange,
  quickRatio,
  ratioOfRevenue,
  round2,
  safeDivide,
  workingCapital,
} from '@/lib/finance/math';
import { formatPercent, formatPoints, NOT_MEANINGFUL } from '@/lib/util/format';

describe('percentage change', () => {
  it('uses ABS(previous) as the denominator', () => {
    expect(pctChange(110, 100)).toBeCloseTo(0.1, 10);
    expect(pctChange(90, 100)).toBeCloseTo(-0.1, 10);
  });

  it('keeps the sign meaningful when the prior period was negative', () => {
    // A loss shrinking from -10,000 to -5,000 is an improvement, not a decline.
    expect(pctChange(-5_000, -10_000)).toBeCloseTo(0.5, 10);
    expect(pctChange(-15_000, -10_000)).toBeCloseTo(-0.5, 10);
  });

  it('returns null rather than dividing by zero', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(100, undefined)).toBeNull();
  });

  it('renders a null change as N/M, never as a number', () => {
    expect(formatPercent(pctChange(100, 0))).toBe(NOT_MEANINGFUL);
    expect(formatPercent(null)).toBe('N/M');
  });
});

describe('gross profit and margin', () => {
  it('computes gross profit as revenue minus COGS', () => {
    expect(grossProfit(470_000, 258_500)).toBe(211_500);
  });

  it('computes gross margin as gross profit over revenue', () => {
    expect(grossMargin(470_000, 258_500)).toBeCloseTo(0.45, 10);
  });

  it('returns null when revenue is zero', () => {
    expect(grossMargin(0, 1_000)).toBeNull();
  });

  it('quantifies a margin change in dollars', () => {
    // 44.7% -> 43.6% on 842,503 of revenue.
    expect(marginImpact(842_503, 0.436, 0.447)).toBeCloseTo(-9_267.53, 2);
  });
});

describe('ratios', () => {
  it('computes net margin', () => {
    expect(netMargin(60_000, 470_000)).toBeCloseTo(0.12766, 5);
  });

  it('computes expense ratios of revenue', () => {
    expect(ratioOfRevenue(80_000, 470_000)).toBeCloseTo(0.170213, 5);
  });

  it('computes working capital and the current ratio', () => {
    expect(workingCapital(800_000, 500_000)).toBe(300_000);
    expect(currentRatio(800_000, 500_000)).toBeCloseTo(1.6, 10);
    expect(currentRatio(800_000, 0)).toBeNull();
    expect(workingCapital(null, 500_000)).toBeNull();
  });

  it('excludes inventory from the quick ratio', () => {
    expect(quickRatio(800_000, 480_000, 500_000)).toBeCloseTo(0.64, 10);
  });

  it('never divides by zero', () => {
    expect(safeDivide(1, 0)).toBeNull();
    expect(safeDivide(null, 10)).toBeNull();
    expect(safeDivide(10, null)).toBeNull();
  });
});

describe('percentage-point movement', () => {
  it('reports margin moves in points, not percent', () => {
    const points = pointChange(0.436, 0.447);
    expect(points).toBeCloseTo(-0.011, 10);
    expect(formatPoints(points)).toBe('-1.1 pts');
  });

  it('is N/M when either side is missing', () => {
    expect(pointChange(null, 0.4)).toBeNull();
    expect(formatPoints(null)).toBe('N/M');
  });
});

describe('rounding', () => {
  it('rounds to cents without binary drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });

  it('averages only the values that exist', () => {
    expect(average([10, null, 20, undefined])).toBe(15);
    expect(average([])).toBeNull();
  });
});
