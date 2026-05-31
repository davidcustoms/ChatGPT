// CLI runner for the demo math simulation.
//
// =====================================================================
//  DEMO MATH ONLY — free-play prototype.
//  These figures come from a Math.random model of an original demo game.
//  They are NOT a certified RTP, NOT a regulatory return statement, and
//  describe FAKE CREDITS only. No real money is involved.
// =====================================================================
//
//   npm run sim                         # 1,000,000 spins @ bet 100
//   npm run sim -- --spins 5000000      # more spins
//   npm run sim -- --seed 42            # reproducible run (SeededRng)
//   npm run sim -- --bet 200

import { simulate } from './simulate';
import { DefaultRng, SeededRng } from '../game/rng';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const spins = Number(arg('spins') ?? 1_000_000);
const bet = Number(arg('bet') ?? 100);
const seedArg = arg('seed');
const rng = seedArg !== undefined ? new SeededRng(Number(seedArg)) : new DefaultRng();

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const num = (n: number) => n.toLocaleString('en-US');
const rule = '─'.repeat(58);

console.log(`\n${rule}`);
console.log(`  ChronoQuest: Team Showdown — DEMO MATH SIMULATION`);
console.log(`  ⚠  DEMO MATH ONLY · fake credits · not a certified RTP`);
console.log(rule);
console.log(`  spins: ${num(spins)}    bet: ${bet}    rng: ${seedArg !== undefined ? `seeded(${seedArg})` : 'Math.random'}`);
console.log(rule);

const t0 = Date.now();
const s = simulate(spins, bet, rng);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`  Estimated RTP ........ ${pct(s.rtp)}`);
console.log(`  Hit frequency ........ ${pct(s.hitFrequency)}   (${num(s.hitCount)} winning rounds)`);
console.log(`  Bonus frequency ...... ${pct(s.bonusTriggers / s.spins)}   (1 in ${s.bonusRate.toFixed(0)} spins)`);
console.log(`  Average win / spin ... ${num(Math.round(s.averageWin))}   (${(s.averageWin / bet).toFixed(3)}x bet)`);
console.log(`  Average win / hit .... ${num(Math.round(s.averageWinPerHit))}   (${(s.averageWinPerHit / bet).toFixed(2)}x bet)`);
console.log(`  Max win .............. ${num(Math.round(s.maxWin))}   (${s.maxWinX.toFixed(1)}x bet)`);
console.log(`  Big wins (>=20x) ..... ${num(s.bigWins)}   (${pct(s.bigWins / s.spins)} of spins)`);
console.log(`  Bonus triggers ....... ${num(s.bonusTriggers)}   (${num(s.freeSpinsPlayed)} free spins played)`);
console.log(`  Timeline Key awards .. ${num(s.keyAwards)}`);
console.log(rule);

// --- Volatility notes ---
console.log(`  VOLATILITY NOTES`);
console.log(`  Std-dev of return .... ${s.stdDev.toFixed(2)}x bet  →  ${s.volatility.toUpperCase()} volatility`);
const notes: Record<string, string> = {
  low: 'Frequent small wins; balance moves smoothly.',
  medium: 'Mixed wins; moderate swings between hits.',
  high: 'Long dry spells punctuated by big bonus/wild-multiplier hits.',
  'very high': 'Very swingy — most return is concentrated in rare large hits.',
};
console.log(`  ${notes[s.volatility]}`);
console.log(`  Most of the upside sits in the free-spins bonus (sticky wilds +`);
console.log(`  stacking multipliers), so RTP/variance are sensitive to its rate.`);
console.log(rule);
console.log(`  total bet ${num(s.totalBet)}  →  total win ${num(Math.round(s.totalWin))}   (${secs}s)`);
console.log(`  Reminder: DEMO MATH ONLY — adjust src/game/paytable.ts &`);
console.log(`  src/game/reelConfig.ts, then re-run to retune. Not for real money.`);
console.log(`${rule}\n`);
