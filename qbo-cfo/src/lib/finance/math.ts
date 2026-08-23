/**
 * Financial arithmetic primitives.
 *
 * Every helper returns `null` rather than Infinity/NaN when a calculation is
 * not meaningful (typically a zero or missing denominator). The UI renders
 * `null` as "N/M" so an owner never sees a fabricated percentage.
 */

export const NOT_MEANINGFUL = null;

/** Round to cents, avoiding binary-float drift such as 0.1+0.2. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function sum(values: Array<number | null | undefined>): number {
  return round2(values.reduce<number>((acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0));
}

/**
 * Percentage change: (current - previous) / ABS(previous).
 *
 * ABS on the denominator keeps the sign meaningful when the prior period was
 * negative (a loss of -10k improving to -5k is a +50% change, not -50%).
 * Returns null when previous is zero, missing, or non-finite.
 */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Absolute change; null when the prior value is unknown. */
export function absChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
  return round2(current - previous);
}

/** Safe ratio. Returns null when the denominator is zero/missing. */
export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function grossProfit(revenue: number, cogs: number): number {
  return round2(revenue - cogs);
}

export function grossMargin(revenue: number, cogs: number): number | null {
  return safeDivide(grossProfit(revenue, cogs), revenue);
}

export function netMargin(netIncome: number, revenue: number): number | null {
  return safeDivide(netIncome, revenue);
}

export function ratioOfRevenue(amount: number, revenue: number): number | null {
  return safeDivide(amount, revenue);
}

export function workingCapital(
  currentAssets: number | null,
  currentLiabilities: number | null,
): number | null {
  if (currentAssets === null || currentLiabilities === null) return null;
  return round2(currentAssets - currentLiabilities);
}

export function currentRatio(
  currentAssets: number | null,
  currentLiabilities: number | null,
): number | null {
  return safeDivide(currentAssets, currentLiabilities);
}

export function quickRatio(
  currentAssets: number | null,
  inventory: number | null,
  currentLiabilities: number | null,
): number | null {
  if (currentAssets === null) return null;
  return safeDivide(currentAssets - (inventory ?? 0), currentLiabilities);
}

/** Percentage-point difference between two ratios (0.447 -> 0.436 = -0.011). */
export function pointChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) return round2(((nums[mid - 1] as number) + (nums[mid] as number)) / 2);
  return nums[mid] as number;
}

export function stdDev(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/**
 * Impact of a margin change, expressed in dollars:
 * how much gross profit was lost/gained relative to holding last period's margin.
 */
export function marginImpact(
  currentRevenue: number,
  currentMargin: number | null,
  priorMargin: number | null,
): number | null {
  if (currentMargin === null || priorMargin === null) return null;
  return round2(currentRevenue * (currentMargin - priorMargin));
}
