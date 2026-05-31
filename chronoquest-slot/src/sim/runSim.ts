// CLI runner for the RTP simulation.
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

console.log(`\nChronoQuest: Team Showdown — RTP simulation`);
console.log(`  spins: ${num(spins)}   bet: ${bet}   rng: ${seedArg !== undefined ? `seeded(${seedArg})` : 'Math.random'}\n`);

const t0 = Date.now();
const s = simulate(spins, bet, rng);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`  RTP ................. ${pct(s.rtp)}`);
console.log(`  Hit frequency ....... ${pct(s.hitFrequency)} (${num(s.hitCount)} winning rounds)`);
console.log(`  Bonus trigger rate .. ${pct(s.bonusTriggers / s.spins)}  (1 in ${s.bonusRate.toFixed(0)})`);
console.log(`  Bonus triggers ...... ${num(s.bonusTriggers)}  (${num(s.freeSpinsPlayed)} free spins played)`);
console.log(`  Timeline Key awards . ${num(s.keyAwards)}`);
console.log(`  Big wins (>=20x) .... ${num(s.bigWins)}`);
console.log(`  Max win ............. ${num(Math.round(s.maxWin))}  (${s.maxWinX.toFixed(1)}x bet)`);
console.log(`\n  total bet ${num(s.totalBet)}  →  total win ${num(Math.round(s.totalWin))}   (${secs}s)\n`);
