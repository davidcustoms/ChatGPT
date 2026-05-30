// Core type definitions for the ChronoQuest slot engine.
// These are intentionally framework-agnostic — no Phaser imports here so the
// engine can be unit-tested and reused outside the renderer.

/** Every symbol that can appear on a reel. */
export type SymbolId =
  // Low symbols
  | 'TEN'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'
  // Mid symbols
  | 'GEAR'
  | 'CRYSTAL'
  | 'REACTOR'
  | 'PORTAL_SHARD'
  // Premium team symbols
  | 'TIMEKEEPERS'
  | 'CHRONOKNIGHTS'
  | 'PULSEWALKERS'
  | 'VOID_REBELS'
  | 'NEON_PHARAOHS'
  // Special symbols
  | 'WILD_CAPTAIN'
  | 'SCATTER'
  | 'PAST_KEY'
  | 'FUTURE_KEY';

/** A position on the grid. `reel` is 0-indexed left-to-right, `row` top-to-bottom. */
export interface GridPosition {
  reel: number;
  row: number;
}

/**
 * The variable-height reel layout.
 * `rows[i]` is the number of visible rows on reel `i`.
 */
export interface ReelLayout {
  rows: number[];
}

/**
 * A 2D grid of symbols. Outer index = reel, inner index = row.
 * Because the layout is variable-height, inner arrays differ in length.
 */
export type SymbolGrid = SymbolId[][];

/** The raw result of spinning the reels, before evaluation. */
export interface SpinResult {
  grid: SymbolGrid;
}

/** A single winning combination produced by `evaluateSpin`. */
export interface EvaluatedWin {
  symbol: SymbolId;
  /** Number of consecutive reels (from the left) that contributed. */
  reels: number;
  /** Number of distinct ways (product of per-reel counts). */
  ways: number;
  /** Base paytable value per way at the reference bet. */
  basePay: number;
  /** Applied multiplier (wild + bonus base multiplier). */
  multiplier: number;
  /** Final credits awarded for this win. */
  win: number;
  /** Grid positions that should be highlighted for this win. */
  positions: GridPosition[];
}

/** Aggregated evaluation output. */
export interface SpinEvaluation {
  wins: EvaluatedWin[];
  totalWin: number;
  multiplier: number;
}

/** State for the free-spins / bonus mode. */
export interface BonusState {
  active: boolean;
  /** Free spins remaining. */
  freeSpins: number;
  /** Total free spins awarded this bonus (for display). */
  totalFreeSpins: number;
  /** Positions of sticky Wild Captains held for the rest of the bonus. */
  stickyWilds: GridPosition[];
  /** Base multiplier the bonus starts with (Super Bonus = 3, normal = 1). */
  baseMultiplier: number;
  /** True when triggered as a "Chrono Showdown" super bonus. */
  isSuperBonus: boolean;
}

/** The complete game state held by the scene. */
export interface SlotGameState {
  credits: number;
  bet: number;
  lastWin: number;
  spinning: boolean;
  message: string;
  bonus: BonusState;
}
