import { describe, it, expect } from 'vitest';

import type { SymbolGrid, GridPosition } from '../src/game/types';
import {
  applyStickyWilds,
  calculateWildMultiplier,
  countScatters,
  detectKeys,
  evaluateBonusTrigger,
  evaluateSpin,
  getSymbolGrid,
  startFreeSpinsIfTriggered,
} from '../src/game/slotEngine';
import { REEL_LAYOUT } from '../src/game/reelConfig';
import { PAYTABLE } from '../src/game/paytable';
import { SeededRng } from '../src/game/rng';

// Helper: build a 3-4-5-4-3 grid filled with a base symbol, then patch cells.
function makeGrid(fill: SymbolGrid[number][number] = 'TEN'): SymbolGrid {
  return REEL_LAYOUT.rows.map((n) => Array.from({ length: n }, () => fill));
}

describe('getSymbolGrid', () => {
  it('produces the 3-4-5-4-3 variable layout (19 positions)', () => {
    const grid = getSymbolGrid(REEL_LAYOUT, new SeededRng(123));
    expect(grid.map((r) => r.length)).toEqual([3, 4, 5, 4, 3]);
    const total = grid.reduce((sum, reel) => sum + reel.length, 0);
    expect(total).toBe(19);
  });

  it('never places wilds on the outer reels or keys on the wrong reels', () => {
    for (let seed = 0; seed < 40; seed++) {
      const grid = getSymbolGrid(REEL_LAYOUT, new SeededRng(seed));
      expect(grid[0]).not.toContain('WILD_CAPTAIN');
      expect(grid[4]).not.toContain('WILD_CAPTAIN');
      // Future key only on last reel; past key only on first.
      expect(grid[0]).not.toContain('FUTURE_KEY');
      expect(grid[4]).not.toContain('PAST_KEY');
      for (let r = 1; r <= 3; r++) {
        expect(grid[r]).not.toContain('PAST_KEY');
        expect(grid[r]).not.toContain('FUTURE_KEY');
      }
    }
  });
});

describe('countScatters', () => {
  it('counts scatters anywhere on the grid', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'SCATTER';
    grid[2][2] = 'SCATTER';
    grid[4][1] = 'SCATTER';
    expect(countScatters(grid)).toBe(3);
  });

  it('returns 0 when there are no scatters', () => {
    expect(countScatters(makeGrid('A'))).toBe(0);
  });
});

describe('startFreeSpinsIfTriggered', () => {
  it('awards 8 / 10 / 12 free spins for 3 / 4 / 5 scatters', () => {
    expect(startFreeSpinsIfTriggered(2)).toBe(0);
    expect(startFreeSpinsIfTriggered(3)).toBe(8);
    expect(startFreeSpinsIfTriggered(4)).toBe(10);
    expect(startFreeSpinsIfTriggered(5)).toBe(12);
    expect(startFreeSpinsIfTriggered(6)).toBe(12);
  });
});

describe('detectKeys', () => {
  it('detects Past Key on reel 1 and Future Key on the last reel', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'PAST_KEY';
    grid[4][2] = 'FUTURE_KEY';
    const keys = detectKeys(grid);
    expect(keys.pastOnFirst).toBe(true);
    expect(keys.futureOnLast).toBe(true);
    expect(keys.bothPresent).toBe(true);
  });

  it('does not trigger when only one key is present', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'PAST_KEY';
    expect(detectKeys(grid).bothPresent).toBe(false);
  });
});

describe('calculateWildMultiplier', () => {
  it('adds +1 per wild on the middle reels', () => {
    const grid = makeGrid('TEN');
    expect(calculateWildMultiplier(grid)).toBe(1); // no wilds -> x1

    grid[1][0] = 'WILD_CAPTAIN';
    expect(calculateWildMultiplier(grid)).toBe(2); // 1 wild -> x2

    grid[2][1] = 'WILD_CAPTAIN';
    expect(calculateWildMultiplier(grid)).toBe(3); // 2 wilds -> x3

    grid[3][0] = 'WILD_CAPTAIN';
    expect(calculateWildMultiplier(grid)).toBe(4); // 3 wilds -> x4
  });

  it('respects the bonus base multiplier (Super Bonus starts at x3)', () => {
    const grid = makeGrid('TEN');
    grid[2][0] = 'WILD_CAPTAIN';
    expect(calculateWildMultiplier(grid, 3)).toBe(4); // base 3 + 1 wild
  });

  it('ignores wilds on the outer reels', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'WILD_CAPTAIN';
    grid[4][0] = 'WILD_CAPTAIN';
    expect(calculateWildMultiplier(grid)).toBe(1);
  });
});

describe('evaluateSpin (ways-to-win)', () => {
  it('multiplies per-reel counts for a known grid', () => {
    // A on reel1 x2, reel2 x1, reel3 x3 -> ways = 6, then chain breaks.
    const grid = makeGrid('TEN');
    grid[0] = ['A', 'A', 'TEN'];
    grid[1] = ['A', 'TEN', 'TEN', 'TEN'];
    grid[2] = ['A', 'A', 'A', 'TEN', 'TEN'];
    grid[3] = ['TEN', 'TEN', 'TEN', 'TEN']; // breaks the A chain at length 3
    grid[4] = ['TEN', 'TEN', 'TEN'];

    const result = evaluateSpin(grid, 100, 1);
    const aWin = result.wins.find((w) => w.symbol === 'A');
    expect(aWin).toBeDefined();
    expect(aWin!.reels).toBe(3);
    expect(aWin!.ways).toBe(6);
    // basePay * ways * betFactor(1) * multiplier(1)
    expect(aWin!.basePay).toBe(PAYTABLE.A![3]);
    expect(aWin!.win).toBe(PAYTABLE.A![3] * 6);
  });

  it('lets Wild Captain substitute for paying symbols', () => {
    const grid = makeGrid('TEN');
    grid[0] = ['A', 'TEN', 'TEN'];
    grid[1] = ['WILD_CAPTAIN', 'TEN', 'TEN', 'TEN']; // wild stands in for A
    grid[2] = ['A', 'TEN', 'TEN', 'TEN', 'TEN'];
    grid[3] = ['TEN', 'TEN', 'TEN', 'TEN'];
    grid[4] = ['TEN', 'TEN', 'TEN'];

    const result = evaluateSpin(grid, 100, 1);
    const aWin = result.wins.find((w) => w.symbol === 'A');
    expect(aWin).toBeDefined();
    expect(aWin!.reels).toBe(3);
    expect(aWin!.ways).toBe(1); // 1 * 1 * 1
  });

  it('applies the bet factor and multiplier to the payout', () => {
    const grid = makeGrid('TEN');
    grid[0] = ['K', 'TEN', 'TEN'];
    grid[1] = ['K', 'TEN', 'TEN', 'TEN'];
    grid[2] = ['K', 'TEN', 'TEN', 'TEN', 'TEN'];
    grid[3] = ['TEN', 'TEN', 'TEN', 'TEN'];
    grid[4] = ['TEN', 'TEN', 'TEN'];

    const result = evaluateSpin(grid, 200, 3); // betFactor = 2, multiplier = 3
    const kWin = result.wins.find((w) => w.symbol === 'K');
    expect(kWin!.win).toBe(PAYTABLE.K![3] * 1 * 2 * 3);
  });

  it('does not pay for fewer than 3 reels', () => {
    const grid = makeGrid('TEN');
    grid[0] = ['A', 'TEN', 'TEN'];
    grid[1] = ['A', 'TEN', 'TEN', 'TEN'];
    grid[2] = ['TEN', 'TEN', 'TEN', 'TEN', 'TEN']; // chain length 2
    const result = evaluateSpin(grid, 100, 1);
    expect(result.wins.find((w) => w.symbol === 'A')).toBeUndefined();
  });
});

describe('evaluateBonusTrigger', () => {
  it('triggers standard free spins for 3 scatters (no keys)', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'SCATTER';
    grid[2][0] = 'SCATTER';
    grid[4][0] = 'SCATTER';
    const trig = evaluateBonusTrigger(grid);
    expect(trig.triggered).toBe(true);
    expect(trig.isSuper).toBe(false);
    expect(trig.freeSpinsAwarded).toBe(8);
    expect(trig.bonus.baseMultiplier).toBe(1);
  });

  it('triggers Chrono Showdown super bonus with 3+ scatters AND both keys', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'SCATTER';
    grid[2][0] = 'SCATTER';
    grid[4][0] = 'SCATTER';
    grid[0][1] = 'PAST_KEY';
    grid[4][1] = 'FUTURE_KEY';
    const trig = evaluateBonusTrigger(grid);
    expect(trig.triggered).toBe(true);
    expect(trig.isSuper).toBe(true);
    expect(trig.freeSpinsAwarded).toBe(12);
    expect(trig.bonus.baseMultiplier).toBe(3);
  });

  it('does not trigger with fewer than 3 scatters', () => {
    const grid = makeGrid('TEN');
    grid[0][0] = 'SCATTER';
    grid[2][0] = 'SCATTER';
    expect(evaluateBonusTrigger(grid).triggered).toBe(false);
  });
});

describe('applyStickyWilds', () => {
  it('keeps existing sticky wilds and adds newly landed ones', () => {
    const sticky: GridPosition[] = [{ reel: 1, row: 0 }];

    // New grid where the sticky position is NOT a wild, but a new wild lands elsewhere.
    const grid = makeGrid('TEN');
    grid[2][1] = 'WILD_CAPTAIN';

    const updated = applyStickyWilds(grid, sticky);

    // The previously sticky position is re-stamped as a wild on the grid...
    expect(grid[1][0]).toBe('WILD_CAPTAIN');
    // ...and the sticky set now contains both positions.
    expect(updated).toEqual(
      expect.arrayContaining([
        { reel: 1, row: 0 },
        { reel: 2, row: 1 },
      ]),
    );
    expect(updated).toHaveLength(2);
  });

  it('de-duplicates positions', () => {
    const grid = makeGrid('TEN');
    grid[1][0] = 'WILD_CAPTAIN';
    const updated = applyStickyWilds(grid, [{ reel: 1, row: 0 }]);
    expect(updated).toHaveLength(1);
  });
});
