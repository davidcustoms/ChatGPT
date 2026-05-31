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
  TEN: { 3: 10, 4: 30, 5: 90 },
  J: { 3: 10, 4: 30, 5: 90 },
  Q: { 3: 20, 4: 50, 5: 110 },
  K: { 3: 25, 4: 55, 5: 130 },
  A: { 3: 30, 4: 70, 5: 160 },

  // --- Mid symbols (medium) ---
  GEAR: { 3: 45, 4: 110, 5: 275 },
  CRYSTAL: { 3: 55, 4: 130, 5: 330 },
  REACTOR: { 3: 65, 4: 165, 5: 440 },
  PORTAL_SHARD: { 3: 90, 4: 220, 5: 550 },

  // --- Premium team symbols (high) ---
  TIMEKEEPERS: { 3: 130, 4: 330, 5: 880 },
  CHRONOKNIGHTS: { 3: 165, 4: 440, 5: 1100 },
  PULSEWALKERS: { 3: 200, 4: 550, 5: 1375 },
  VOID_REBELS: { 3: 240, 4: 660, 5: 1650 },
  NEON_PHARAOHS: { 3: 330, 4: 880, 5: 2200 },
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
