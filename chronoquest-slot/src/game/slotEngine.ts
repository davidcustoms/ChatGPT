// Pure slot engine — NO Phaser imports.
//
// This module owns all the math: building a random grid, evaluating ways-to-win,
// counting scatters, detecting keys, sticky wilds, multipliers and free spins.
// Everything is a pure function (state passed in / new values returned) so it is
// trivially unit-testable and renderer-agnostic.

import type {
  BonusState,
  EvaluatedWin,
  GridPosition,
  ReelLayout,
  SpinEvaluation,
  SpinResult,
  SymbolGrid,
  SymbolId,
} from './types';
import { type Rng, defaultRng } from './rng';
import {
  PAYING_SYMBOLS,
  SCATTER_ID,
  WILD_ID,
  PAST_KEY_ID,
  FUTURE_KEY_ID,
} from './symbols';
import { PAYTABLE, SCATTER_AWARDS, SUPER_BONUS } from './paytable';
import { REEL_LAYOUT, REFERENCE_BET, getReelWeights } from './reelConfig';

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/** Weighted pick of one symbol for a given reel. */
function pickSymbol(reelIndex: number, rng: Rng): SymbolId {
  const weights = getReelWeights(reelIndex);
  const entries = Object.entries(weights).filter(([, w]) => w > 0) as [SymbolId, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1][0];
}

/**
 * Build a fresh random grid from weighted reels.
 * If a bonus is active, sticky wilds are stamped on afterwards (see createSpinResult).
 */
export function getSymbolGrid(
  layout: ReelLayout = REEL_LAYOUT,
  rng: Rng = defaultRng,
): SymbolGrid {
  return layout.rows.map((rowCount, reelIndex) => {
    const reel: SymbolId[] = [];
    for (let row = 0; row < rowCount; row++) {
      reel.push(pickSymbol(reelIndex, rng));
    }
    return reel;
  });
}

/**
 * Produce a spin result. When `bonus.active`, existing sticky wilds are stamped
 * back onto their exact positions before returning.
 */
export function createSpinResult(
  bonus?: BonusState,
  layout: ReelLayout = REEL_LAYOUT,
  rng: Rng = defaultRng,
): SpinResult {
  const grid = getSymbolGrid(layout, rng);
  if (bonus && bonus.active && bonus.stickyWilds.length > 0) {
    stampStickyWilds(grid, bonus.stickyWilds);
  }
  return { grid };
}

// ---------------------------------------------------------------------------
// Counting / detection helpers
// ---------------------------------------------------------------------------

/** Count total scatters anywhere on the grid. */
export function countScatters(grid: SymbolGrid): number {
  let count = 0;
  for (const reel of grid) {
    for (const sym of reel) {
      if (sym === SCATTER_ID) count++;
    }
  }
  return count;
}

/** Find every position of a given symbol. */
export function findPositions(grid: SymbolGrid, symbol: SymbolId): GridPosition[] {
  const out: GridPosition[] = [];
  grid.forEach((reel, reelIndex) => {
    reel.forEach((sym, row) => {
      if (sym === symbol) out.push({ reel: reelIndex, row });
    });
  });
  return out;
}

export interface KeyDetection {
  pastOnFirst: boolean;
  futureOnLast: boolean;
  bothPresent: boolean;
}

/** Past Key on reel 1 (index 0) AND Future Key on the last reel. */
export function detectKeys(grid: SymbolGrid): KeyDetection {
  const lastReel = grid.length - 1;
  const pastOnFirst = grid[0]?.includes(PAST_KEY_ID) ?? false;
  const futureOnLast = grid[lastReel]?.includes(FUTURE_KEY_ID) ?? false;
  return {
    pastOnFirst,
    futureOnLast,
    bothPresent: pastOnFirst && futureOnLast,
  };
}

// ---------------------------------------------------------------------------
// Wilds & multipliers
// ---------------------------------------------------------------------------

/** Stamp wilds onto exact positions (mutates grid). */
function stampStickyWilds(grid: SymbolGrid, sticky: GridPosition[]): void {
  for (const pos of sticky) {
    if (grid[pos.reel] && pos.row < grid[pos.reel].length) {
      grid[pos.reel][pos.row] = WILD_ID;
    }
  }
}

/**
 * Recompute the sticky-wild set for the bonus: existing stickies are kept and any
 * newly-landed wild becomes sticky too. Returns a fresh, de-duplicated list.
 */
export function applyStickyWilds(grid: SymbolGrid, existing: GridPosition[]): GridPosition[] {
  // Ensure existing stickies are present on the grid.
  stampStickyWilds(grid, existing);
  // Collect all wild positions (existing + new).
  const all = findPositions(grid, WILD_ID);
  const seen = new Set<string>();
  const result: GridPosition[] = [];
  for (const pos of all) {
    const key = `${pos.reel}:${pos.row}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(pos);
    }
  }
  return result;
}

/**
 * Wild multiplier. Each Wild Captain on the middle reels (2,3,4 → indices 1-3)
 * adds +1. The result is `baseMultiplier + wildCount`.
 *   - Normal play: base 1 → 1 wild = x2, 2 = x3, 3 = x4.
 *   - Super Bonus: base 3 → starts at x3 and climbs with wilds.
 */
export function calculateWildMultiplier(grid: SymbolGrid, baseMultiplier = 1): number {
  let wildCount = 0;
  for (let reel = 1; reel < grid.length - 1; reel++) {
    for (const sym of grid[reel]) {
      if (sym === WILD_ID) wildCount++;
    }
  }
  return baseMultiplier + wildCount;
}

// ---------------------------------------------------------------------------
// Ways-to-win evaluation
// ---------------------------------------------------------------------------

/** Count occurrences of `symbol` (wild substitutes) on a single reel, plus positions. */
function countOnReel(
  reel: SymbolId[],
  reelIndex: number,
  symbol: SymbolId,
): { count: number; positions: GridPosition[] } {
  const positions: GridPosition[] = [];
  let count = 0;
  reel.forEach((sym, row) => {
    if (sym === symbol || sym === WILD_ID) {
      count++;
      positions.push({ reel: reelIndex, row });
    }
  });
  return { count, positions };
}

/**
 * Evaluate ways-to-win, left-to-right from reel 1.
 *   - A symbol wins if it appears on consecutive reels starting at reel 1.
 *   - ways = product of per-reel counts.
 *   - payout = paytable[symbol][len] * ways * (bet/REFERENCE_BET) * multiplier.
 *   - Wild Captain substitutes for regular symbols (but never pays on its own).
 */
export function evaluateSpin(
  grid: SymbolGrid,
  bet: number,
  multiplier = 1,
): SpinEvaluation {
  const betFactor = bet / REFERENCE_BET;
  const wins: EvaluatedWin[] = [];
  let totalWin = 0;

  for (const symbol of PAYING_SYMBOLS) {
    const perReelCounts: number[] = [];
    const perReelPositions: GridPosition[][] = [];

    // Walk reels left to right until the chain breaks.
    let matchLen = 0;
    for (let reelIndex = 0; reelIndex < grid.length; reelIndex++) {
      const { count, positions } = countOnReel(grid[reelIndex], reelIndex, symbol);
      if (count === 0) break;
      perReelCounts.push(count);
      perReelPositions.push(positions);
      matchLen++;
    }

    if (matchLen < 3) continue; // shortest paying combo is 3 reels

    const pay = PAYTABLE[symbol];
    if (!pay) continue;
    const basePay = pay[matchLen as 3 | 4 | 5];
    if (!basePay) continue;

    const ways = perReelCounts.reduce((a, b) => a * b, 1);
    const win = basePay * ways * betFactor * multiplier;

    if (win > 0) {
      wins.push({
        symbol,
        reels: matchLen,
        ways,
        basePay,
        multiplier,
        win,
        positions: perReelPositions.flat(),
      });
      totalWin += win;
    }
  }

  // Highest-paying combo first for nicer display.
  wins.sort((a, b) => b.win - a.win);
  return { wins, totalWin, multiplier };
}

// ---------------------------------------------------------------------------
// Free spins triggering
// ---------------------------------------------------------------------------

/** Free spins awarded for a given scatter count (0 if no trigger). */
export function startFreeSpinsIfTriggered(scatterCount: number): number {
  if (scatterCount >= 5) return SCATTER_AWARDS[5];
  if (scatterCount === 4) return SCATTER_AWARDS[4];
  if (scatterCount === 3) return SCATTER_AWARDS[3];
  return 0;
}

export interface TriggerResult {
  bonus: BonusState;
  triggered: boolean;
  isSuper: boolean;
  freeSpinsAwarded: number;
}

/**
 * Given the current grid, decide whether/which bonus to (re)trigger.
 *   - 3+ scatters → free spins (8/10/12).
 *   - 3+ scatters AND both keys → Super Bonus "Chrono Showdown":
 *       12 free spins, starting multiplier x3, sticky wilds active.
 */
export function evaluateBonusTrigger(grid: SymbolGrid): TriggerResult {
  const scatters = countScatters(grid);
  const keys = detectKeys(grid);
  const baseFreeSpins = startFreeSpinsIfTriggered(scatters);

  if (baseFreeSpins === 0) {
    return { bonus: makeInactiveBonus(), triggered: false, isSuper: false, freeSpinsAwarded: 0 };
  }

  const isSuper = keys.bothPresent;
  const freeSpins = isSuper ? SUPER_BONUS.freeSpins : baseFreeSpins;
  const baseMultiplier = isSuper ? SUPER_BONUS.startMultiplier : 1;

  return {
    bonus: {
      active: true,
      freeSpins,
      totalFreeSpins: freeSpins,
      stickyWilds: [],
      baseMultiplier,
      isSuperBonus: isSuper,
    },
    triggered: true,
    isSuper,
    freeSpinsAwarded: freeSpins,
  };
}

export function makeInactiveBonus(): BonusState {
  return {
    active: false,
    freeSpins: 0,
    totalFreeSpins: 0,
    stickyWilds: [],
    baseMultiplier: 1,
    isSuperBonus: false,
  };
}
