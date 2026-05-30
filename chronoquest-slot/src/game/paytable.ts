// Paytable — EDIT THIS FILE to retune payouts.
//
// Values are credits awarded *per way* at the REFERENCE_BET (100). The engine
// scales by (bet / REFERENCE_BET) and applies the wild/bonus multiplier.
//
// Indexed by match length: [3 reels, 4 reels, 5 reels].
// Wild Captain has no entry (it does not pay by itself in v1).
// Scatter has no entry (it triggers free spins instead of paying as a line).
// Past/Future Keys are feature symbols, not pay symbols.

import type { SymbolId } from './types';

export type PayRow = {
  /** payout per way for [3, 4, 5] matching reels */
  3: number;
  4: number;
  5: number;
};

export const PAYTABLE: Partial<Record<SymbolId, PayRow>> = {
  // --- Low symbols (small) ---
  TEN: { 3: 1, 4: 3, 5: 8 },
  J: { 3: 1, 4: 3, 5: 8 },
  Q: { 3: 2, 4: 4, 5: 10 },
  K: { 3: 2, 4: 5, 5: 12 },
  A: { 3: 3, 4: 6, 5: 15 },

  // --- Mid symbols (medium) ---
  GEAR: { 3: 4, 4: 10, 5: 25 },
  CRYSTAL: { 3: 5, 4: 12, 5: 30 },
  REACTOR: { 3: 6, 4: 15, 5: 40 },
  PORTAL_SHARD: { 3: 8, 4: 20, 5: 50 },

  // --- Premium team symbols (high) ---
  TIMEKEEPERS: { 3: 12, 4: 30, 5: 80 },
  CHRONOKNIGHTS: { 3: 15, 4: 40, 5: 100 },
  PULSEWALKERS: { 3: 18, 4: 50, 5: 125 },
  VOID_REBELS: { 3: 22, 4: 60, 5: 150 },
  NEON_PHARAOHS: { 3: 30, 4: 80, 5: 200 },
};

/** Free spins awarded by scatter count. */
export const SCATTER_AWARDS: Record<number, number> = {
  3: 8,
  4: 10,
  5: 12,
};

/** Instant award (in bet multiples) when Past Key + Future Key both land. */
export const KEY_BONUS_BET_MULTIPLIER = 5;

/** Super Bonus (Chrono Showdown) configuration. */
export const SUPER_BONUS = {
  freeSpins: 12,
  startMultiplier: 3,
};
