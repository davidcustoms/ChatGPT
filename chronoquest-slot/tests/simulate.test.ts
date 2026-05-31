import { describe, it, expect } from 'vitest';
import { simulate } from '../src/sim/simulate';
import { SeededRng } from '../src/game/rng';

describe('simulate', () => {
  it('runs a full simulation and reports sane, bounded stats', () => {
    const s = simulate(3000, 100, new SeededRng(12345));
    expect(s.spins).toBe(3000);
    expect(s.totalBet).toBe(3000 * 100);
    // RTP should be a finite, non-negative ratio (not asserting a tuned target).
    expect(Number.isFinite(s.rtp)).toBe(true);
    expect(s.rtp).toBeGreaterThanOrEqual(0);
    expect(s.hitFrequency).toBeGreaterThanOrEqual(0);
    expect(s.hitFrequency).toBeLessThanOrEqual(1);
    expect(s.bonusTriggers).toBeGreaterThanOrEqual(0);

    // Average win per spin equals RTP * bet by definition.
    expect(s.averageWin).toBeCloseTo(s.rtp * s.bet, 6);
    // Volatility metrics are present and sane.
    expect(Number.isFinite(s.stdDev)).toBe(true);
    expect(s.stdDev).toBeGreaterThanOrEqual(0);
    expect(['low', 'medium', 'high', 'very high']).toContain(s.volatility);
  });

  it('is deterministic for a fixed seed', () => {
    const a = simulate(2000, 100, new SeededRng(7));
    const b = simulate(2000, 100, new SeededRng(7));
    expect(a.totalWin).toBe(b.totalWin);
    expect(a.bonusTriggers).toBe(b.bonusTriggers);
    expect(a.rtp).toBe(b.rtp);
  });
});
