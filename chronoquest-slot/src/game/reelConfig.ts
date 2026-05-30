// Reel layout + per-reel symbol weights.
//
// EDIT THIS FILE to retune the math feel:
//   - REEL_LAYOUT controls the variable-height grid.
//   - BASE_WEIGHTS controls how common each symbol is.
//   - getReelWeights() applies per-reel rules (wild only on middle reels,
//     keys only on the outer reels) so features behave as designed.

import type { ReelLayout, SymbolId } from './types';

/**
 * Unique variable-height layout: 3-4-5-4-3 = 19 visible positions.
 * (Deliberately not the classic 2-3-3-3-2 shape.)
 */
export const REEL_LAYOUT: ReelLayout = {
  rows: [3, 4, 5, 4, 3],
};

export const TOTAL_REELS = REEL_LAYOUT.rows.length;
export const TOTAL_POSITIONS = REEL_LAYOUT.rows.reduce((a, b) => a + b, 0); // 19

/** Reference bet the paytable values are expressed against. */
export const REFERENCE_BET = 100;

/** Base relative weights. Higher = more common. */
export const BASE_WEIGHTS: Record<SymbolId, number> = {
  // Low — most common
  TEN: 50,
  J: 48,
  Q: 44,
  K: 40,
  A: 36,
  // Mid
  GEAR: 30,
  CRYSTAL: 27,
  REACTOR: 23,
  PORTAL_SHARD: 20,
  // Premium — rarer
  TIMEKEEPERS: 14,
  CHRONOKNIGHTS: 12,
  PULSEWALKERS: 10,
  VOID_REBELS: 9,
  NEON_PHARAOHS: 8,
  // Specials
  WILD_CAPTAIN: 7,
  SCATTER: 6,
  PAST_KEY: 5,
  FUTURE_KEY: 5,
};

/**
 * Per-reel weight rules:
 *   - Wild Captain only appears on reels 2-4 (indices 1,2,3) — enables the
 *     middle-reel multiplier feature.
 *   - Past Key only on reel 1 (index 0); Future Key only on reel 5 (index 4).
 */
export function getReelWeights(reelIndex: number): Record<SymbolId, number> {
  const w = { ...BASE_WEIGHTS };
  const isFirst = reelIndex === 0;
  const isLast = reelIndex === TOTAL_REELS - 1;
  const isMiddle = !isFirst && !isLast;

  w.WILD_CAPTAIN = isMiddle ? BASE_WEIGHTS.WILD_CAPTAIN : 0;
  w.PAST_KEY = isFirst ? BASE_WEIGHTS.PAST_KEY : 0;
  w.FUTURE_KEY = isLast ? BASE_WEIGHTS.FUTURE_KEY : 0;

  return w;
}
