# ChronoQuest: Team Showdown

A **free-play** slot machine demo built with **Phaser 3 + TypeScript + Vite**.
Different hero teams battle across timelines in a neon, futuristic universe.

> ⚠️ **Legal note:** This is a free-play demo only. It uses **fake credits**.
> There is **no real money**, no wallet, no deposits, no withdrawals, no casino
> backend, and no real-money gambling of any kind. It is an original prototype,
> only loosely *inspired* by the idea of high-volatility, team-based bonus slots —
> it does not copy any existing game's art, math, symbols, names, or mechanics.

---

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the dev server (Vite) and open the printed URL
```

Other scripts:

```bash
npm run build    # type-check (tsc --noEmit) + production build to dist/
npm run preview  # preview the production build locally
npm run test     # run the Vitest engine test-suite
npm run sim      # RTP / volatility simulation (see "Measuring RTP" below)
```

---

## What's in the box

| Area | File |
| --- | --- |
| Entry / Phaser config | `src/main.ts` |
| Splash scene | `src/scenes/BootScene.ts` |
| Main game scene (render, animation, flow) | `src/scenes/SlotScene.ts` |
| Paytable / info overlay scene | `src/scenes/InfoScene.ts` |
| Cinematic bonus intro overlay scene | `src/scenes/BonusIntroScene.ts` |
| Animated cinematic background | `src/ui/Background.ts` |
| HUD (credits, bet, win, buttons) | `src/ui/Hud.ts` |
| **Pure math engine** | `src/game/slotEngine.ts` |
| Types / interfaces | `src/game/types.ts` |
| Symbol catalogue + colors/labels | `src/game/symbols.ts` |
| Procedural sprite-texture generator | `src/ui/symbolTextures.ts` |
| Procedural particle textures (win/bonus FX) | `src/ui/fxTextures.ts` |
| Reel layout + symbol weights | `src/game/reelConfig.ts` |
| Paytable + bonus config | `src/game/paytable.ts` |
| RNG wrapper (swappable) | `src/game/rng.ts` |
| Procedural audio (Web Audio API) | `src/audio/sound.ts` |
| RTP / volatility simulation | `src/sim/simulate.ts`, `src/sim/runSim.ts` |
| Engine + simulation tests | `tests/engine.test.ts`, `tests/simulate.test.ts` |

The engine in `src/game/` has **no Phaser imports**, so all math is unit-testable
and renderer-agnostic.

---

## How the game plays

- Start with **10,000 fake credits**, default bet **100**.
- **Variable-height reels: 3-4-5-4-3** = **19** visible positions.
- **Ways-to-win**, left-to-right from reel 1: a symbol wins when it lands on
  consecutive reels starting at reel 1. Ways = product of per-reel counts.
  `payout = paytable[symbol][reels] × ways × (bet / 100) × multiplier`.
- **Wild Captain** (middle reels only) substitutes for paying symbols and adds
  `+1×` to the multiplier per wild (1 wild = ×2, 2 = ×3, 3 = ×4). It never pays
  on its own.
- **Time Portal Scatter** (anywhere): 3 → 8, 4 → 10, 5 → 12 free spins.
- **Free Spins mode:** no bet deducted, counter ticks down, any Wild Captain that
  lands becomes **sticky** for the rest of the bonus and keeps contributing to the
  persistent multiplier.
- **Timeline Keys:** Past Key on reel 1 **and** Future Key on reel 5 in the same
  spin → instant **5× bet**.
- **Chrono Showdown (Super Bonus):** 3+ scatters **and** both keys in the same
  spin → 12 free spins, starting at **×3**, with sticky wilds active.
- **Big Win** celebration when a spin pays **20× bet** or more.

---

## Tuning the math

Everything that controls the math lives in `src/game/`:

### Change symbol weights
Edit `src/game/reelConfig.ts`:
- `BASE_WEIGHTS` — relative frequency of each symbol (higher = more common).
- `getReelWeights(reelIndex)` — per-reel rules (e.g. wilds only on middle reels,
  keys only on the outer reels).
- `REEL_LAYOUT.rows` — the visible row count per reel.

### Change the paytable
Edit `src/game/paytable.ts`:
- `PAYTABLE[symbol]` — payout per way for `{ 3, 4, 5 }` matching reels.
- `SCATTER_AWARDS` — free spins per scatter count.
- `KEY_BONUS_BET_MULTIPLIER` — the Timeline Keys instant award.
- `SUPER_BONUS` — Chrono Showdown free spins + starting multiplier.

### Swap the RNG
`src/game/rng.ts` isolates randomness behind an `Rng` interface. The live game
uses `DefaultRng` (Math.random); tests use the deterministic `SeededRng`. Replace
`DefaultRng` with a certified RNG later without touching the engine.

### Measuring RTP
`npm run sim` replays the full game flow (base spins + free-spin rounds) through
the real engine and reports **RTP**, hit frequency, bonus-trigger rate, big-win
count and max win. Use it to retune weights/paytable with real numbers.

```bash
npm run sim                       # 1,000,000 spins @ bet 100
npm run sim -- --spins 5000000    # more spins for tighter numbers
npm run sim -- --seed 42          # reproducible run (SeededRng)
```

The shipped config measures ~94–95% RTP (high-volatility profile, bonus ~1 in
330). Change a paytable value and re-run to see the impact immediately.

---

## Art & audio

**Art** is generated procedurally — no image files. `src/ui/symbolTextures.ts`
draws each symbol once with Phaser Graphics (gradient card, glow ring, and a
distinct vector emblem per symbol) and bakes it into a cached texture in
`BootScene`. The reels are lightweight `Image` sprites that swap textures via
`texKey(id)`. Tweak the look by editing `symbolTextures.ts` (emblems) and the
`color`/`glow`/`label` fields in `src/game/symbols.ts`.

To drop in **real PNG art** later: preload your images in `BootScene` using the
same keys (`texKey(id)`) and skip the `generateSymbolTextures(this)` call — the
scene needs no other changes.

**Audio** is synthesized at runtime with the Web Audio API (`src/audio/sound.ts`)
— oscillators + filtered noise for spin / reel-stop / win / bonus cues, so there
are no audio files to ship. A **SOUND** toggle (top-left) mutes everything.
Browsers require a user gesture before audio can start, so `initAudio()` is
called on the first Spin/Auto click. To use real audio samples instead, load
them in `BootScene` and play them inside these same four hook functions.

---

## Ideas for what to improve next

- A layered music track / ambience on top of the procedural SFX.
- Configurable autoplay (spin count, stop-on-win/bonus).
- Persisted balance + settings via `localStorage`.
- Real sprite/audio assets dropped in over the procedural placeholders.

---

## License

MIT — for demonstration/prototype use.
