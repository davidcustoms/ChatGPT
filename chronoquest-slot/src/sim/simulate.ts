// RTP / volatility simulation — pure logic, no Phaser.
//
// Replays the full game flow (base spins + any triggered free-spin rounds)
// through the real engine so the reported numbers reflect the live math.
// Driven by the swappable RNG, so a SeededRng makes runs reproducible.

import { type Rng, DefaultRng } from '../game/rng';
import {
  applyStickyWilds,
  calculateWildMultiplier,
  createSpinResult,
  detectKeys,
  evaluateBonusTrigger,
  evaluateSpin,
} from '../game/slotEngine';
import { KEY_BONUS_BET_MULTIPLIER } from '../game/paytable';
import { REEL_LAYOUT } from '../game/reelConfig';
import type { SymbolGrid } from '../game/types';

export interface SimStats {
  spins: number;
  bet: number;
  totalBet: number;
  totalWin: number;
  /** Return to player: totalWin / totalBet. */
  rtp: number;
  /** Fraction of base rounds that returned any win. */
  hitFrequency: number;
  hitCount: number;
  bonusTriggers: number;
  /** Average base spins per bonus trigger (1-in-N). */
  bonusRate: number;
  freeSpinsPlayed: number;
  keyAwards: number;
  /** Rounds paying >= 20x bet. */
  bigWins: number;
  /** Largest single round win, in credits and in bet multiples. */
  maxWin: number;
  maxWinX: number;
  /** Average win per spin (credits) — equals rtp * bet. */
  averageWin: number;
  /** Average win across winning rounds only (credits). */
  averageWinPerHit: number;
  /** Std-dev of per-round return in bet units — a volatility indicator. */
  stdDev: number;
  /** Rough volatility classification derived from stdDev. */
  volatility: 'low' | 'medium' | 'high' | 'very high';
}

function classifyVolatility(stdDev: number): SimStats['volatility'] {
  if (stdDev < 3) return 'low';
  if (stdDev < 6) return 'medium';
  if (stdDev < 12) return 'high';
  return 'very high';
}

/** Total win for one settled grid = ways win + (both keys ? 5x bet : 0). */
function gridWin(grid: SymbolGrid, bet: number, multiplier: number): { win: number; key: boolean } {
  const ways = evaluateSpin(grid, bet, multiplier).totalWin;
  const key = detectKeys(grid).bothPresent;
  return { win: ways + (key ? KEY_BONUS_BET_MULTIPLIER * bet : 0), key };
}

export function simulate(spins: number, bet = 100, rng: Rng = new DefaultRng()): SimStats {
  let totalBet = 0;
  let totalWin = 0;
  let hitCount = 0;
  let bonusTriggers = 0;
  let freeSpinsPlayed = 0;
  let keyAwards = 0;
  let bigWins = 0;
  let maxWin = 0;
  let sumSqX = 0; // sum of (roundWin / bet)^2, for volatility/std-dev

  for (let i = 0; i < spins; i++) {
    totalBet += bet;

    // Base spin (bet deducted once per round).
    const baseGrid = createSpinResult(undefined, REEL_LAYOUT, rng).grid;
    let roundWin = 0;
    const base = gridWin(baseGrid, bet, calculateWildMultiplier(baseGrid, 1));
    roundWin += base.win;
    if (base.key) keyAwards++;

    // Free-spin round (no extra bet). Sticky wilds + persistent multiplier.
    const trig = evaluateBonusTrigger(baseGrid);
    if (trig.triggered) {
      bonusTriggers++;
      const bonus = trig.bonus;
      bonus.stickyWilds = applyStickyWilds(baseGrid, []);
      while (bonus.freeSpins > 0) {
        const grid = createSpinResult(bonus, REEL_LAYOUT, rng).grid;
        bonus.stickyWilds = applyStickyWilds(grid, bonus.stickyWilds);
        const fs = gridWin(grid, bet, calculateWildMultiplier(grid, bonus.baseMultiplier));
        roundWin += fs.win;
        if (fs.key) keyAwards++;
        bonus.freeSpins--;
        freeSpinsPlayed++;
      }
    }

    totalWin += roundWin;
    const x = roundWin / bet;
    sumSqX += x * x;
    if (roundWin > 0) hitCount++;
    if (roundWin >= bet * 20) bigWins++;
    if (roundWin > maxWin) maxWin = roundWin;
  }

  const rtp = totalWin / totalBet;
  // Variance of per-round return (in bet units): E[x^2] - E[x]^2, where E[x] = rtp.
  const variance = Math.max(0, sumSqX / spins - rtp * rtp);
  const stdDev = Math.sqrt(variance);

  return {
    spins,
    bet,
    totalBet,
    totalWin,
    rtp,
    hitFrequency: hitCount / spins,
    hitCount,
    bonusTriggers,
    bonusRate: bonusTriggers > 0 ? spins / bonusTriggers : Infinity,
    freeSpinsPlayed,
    keyAwards,
    bigWins,
    maxWin,
    maxWinX: maxWin / bet,
    averageWin: totalWin / spins,
    averageWinPerHit: hitCount > 0 ? totalWin / hitCount : 0,
    stdDev,
    volatility: classifyVolatility(stdDev),
  };
}
