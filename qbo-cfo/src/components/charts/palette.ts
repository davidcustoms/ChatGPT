/**
 * Chart colour tokens.
 *
 * Categorical slots are assigned in fixed order and never cycled; the first
 * three slots are validated for all-pairs CVD separation against a white chart
 * surface (worst pair ΔE 9.2 deutan, 24.0 normal vision). The aqua slot sits
 * below 3:1 contrast on white, so every chart that uses it also ships a legend
 * plus a readable data table -- the required relief.
 *
 * Aging buckets use an ordinal blue ramp starting at step 250, the lightest
 * step that still clears 2:1 against white.
 */

export const SERIES = {
  /** slot 1 - blue */
  primary: '#2a78d6',
  /** slot 2 - orange */
  secondary: '#eb6834',
  /** slot 3 - aqua */
  tertiary: '#1baf7a',
} as const;

export const SERIES_ORDER = [SERIES.primary, SERIES.secondary, SERIES.tertiary] as const;

/** Ordinal ramp for aging buckets: light (current) to dark (most overdue). */
export const ORDINAL_BLUE = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'] as const;

/** Diverging pair for gains vs losses. Neutral midpoint is gray. */
export const DIVERGING = { positive: '#2a78d6', negative: '#e34948', neutral: '#f0efec' } as const;

export const AXIS_COLOR = '#8c95a3';
export const GRID_COLOR = '#e2e6ec';
export const SURFACE = '#ffffff';
