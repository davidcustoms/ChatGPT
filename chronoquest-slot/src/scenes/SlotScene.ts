import Phaser from 'phaser';

import type { GridPosition, SlotGameState, SymbolGrid, SymbolId } from '../game/types';
import { REEL_LAYOUT, getReelWeights } from '../game/reelConfig';
import { SYMBOLS, SCATTER_ID, WILD_ID } from '../game/symbols';
import { KEY_BONUS_BET_MULTIPLIER, SUPER_BONUS } from '../game/paytable';
import {
  applyStickyWilds,
  calculateWildMultiplier,
  createSpinResult,
  detectKeys,
  evaluateBonusTrigger,
  evaluateSpin,
  getSymbolGrid,
  makeInactiveBonus,
} from '../game/slotEngine';
import { Hud } from '../ui/Hud';
import { texKey } from '../ui/symbolTextures';
import { FX_SPARK, FX_STAR } from '../ui/fxTextures';
import { bonusSound, initAudio, setMuted, spinSound, stopSound, winSound } from '../audio/sound';

// --- Layout constants ---
const CELL_W = 118;
const CELL_H = 80;
const CELL_GAP = 8;
const REEL_GAP = 14;
const CENTER_Y = 358;

// Per-reel pools of symbols that can legally appear on that reel — used so the
// spin "blur" never flashes a symbol (e.g. a key) on a reel where it can't land.
const REEL_SYMBOL_POOLS: SymbolId[][] = REEL_LAYOUT.rows.map((_, reel) => {
  const weights = getReelWeights(reel);
  return (Object.keys(weights) as SymbolId[]).filter((id) => weights[id] > 0);
});

const BET_STEPS = [50, 100, 200, 300, 500];

interface Card {
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  symbol: SymbolId;
  glowTween?: Phaser.Tweens.Tween;
  pulseTween?: Phaser.Tweens.Tween;
}

export class SlotScene extends Phaser.Scene {
  private state!: SlotGameState;
  private hud!: Hud;
  private cards: Card[][] = [];
  private reelX: number[] = [];
  private betIndex = 1; // default 100
  private auto = false;
  private muted = false;
  private reelsDone = 0;
  private flashRect?: Phaser.GameObjects.Rectangle;
  private winBox!: Phaser.GameObjects.Graphics;
  private winBoxTween?: Phaser.Tweens.Tween;
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private starEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('SlotScene');
  }

  create(): void {
    this.cameras.main.fadeIn(300);

    this.state = {
      credits: 10000,
      bet: BET_STEPS[this.betIndex],
      lastWin: 0,
      spinning: false,
      message: 'Spin to begin your ChronoQuest!',
      bonus: makeInactiveBonus(),
    };

    this.drawBackground();
    this.computeReelGeometry();
    this.drawReelFrame();
    this.buildCards();

    // Initial grid (visual only — no win evaluation).
    this.renderGrid(getSymbolGrid(REEL_LAYOUT));

    this.flashRect = this.add
      .rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x4affff)
      .setAlpha(0)
      .setDepth(80);

    this.createEffects();

    this.hud = new Hud(this, {
      onSpin: () => this.onSpinClicked(),
      onToggleAuto: () => this.toggleAuto(),
      onBetChange: (d) => this.changeBet(d),
      onToggleMute: () => this.toggleMute(),
    });
    this.hud.update(this.state);
  }

  // --- Rendering -----------------------------------------------------------

  private drawBackground(): void {
    const { width, height } = this.scale;
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x070a1c, 0x070a1c, 0x12082e, 0x0a1330, 1);
    bg.fillRect(0, 0, width, height);

    // Faint neon grid lines for a futuristic vibe.
    const grid = this.add.graphics().setDepth(1).setAlpha(0.12);
    grid.lineStyle(1, 0x4affff, 1);
    for (let x = 0; x <= width; x += 64) {
      grid.lineBetween(x, 100, x, height - 130);
    }
    for (let y = 100; y <= height - 130; y += 64) {
      grid.lineBetween(0, y, width, y);
    }
  }

  private computeReelGeometry(): void {
    const reels = REEL_LAYOUT.rows.length;
    const totalW = reels * CELL_W + (reels - 1) * REEL_GAP;
    const startX = this.scale.width / 2 - totalW / 2;
    this.reelX = [];
    for (let r = 0; r < reels; r++) {
      this.reelX.push(startX + r * (CELL_W + REEL_GAP) + CELL_W / 2);
    }
  }

  private rowY(reel: number, row: number): number {
    const n = REEL_LAYOUT.rows[reel];
    const totalH = n * CELL_H + (n - 1) * CELL_GAP;
    const top = CENTER_Y - totalH / 2;
    return top + row * (CELL_H + CELL_GAP) + CELL_H / 2;
  }

  private drawReelFrame(): void {
    const reels = REEL_LAYOUT.rows.length;
    const totalW = reels * CELL_W + (reels - 1) * REEL_GAP;
    const startX = this.scale.width / 2 - totalW / 2;
    const maxRows = Math.max(...REEL_LAYOUT.rows);
    const frameH = maxRows * CELL_H + (maxRows - 1) * CELL_GAP + 40;

    const frame = this.add.graphics().setDepth(2);
    frame.fillStyle(0x0a0e24, 0.7);
    frame.fillRoundedRect(startX - 24, CENTER_Y - frameH / 2, totalW + 48, frameH, 24);
    frame.lineStyle(4, 0x4affff, 0.8);
    frame.strokeRoundedRect(startX - 24, CENTER_Y - frameH / 2, totalW + 48, frameH, 24);
    frame.lineStyle(2, 0xff2fb0, 0.4);
    frame.strokeRoundedRect(startX - 16, CENTER_Y - frameH / 2 + 8, totalW + 32, frameH - 16, 20);
  }

  private buildCards(): void {
    this.cards = [];
    REEL_LAYOUT.rows.forEach((rowCount, reel) => {
      const column: Card[] = [];
      for (let row = 0; row < rowCount; row++) {
        const x = this.reelX[reel];
        const y = this.rowY(reel, row);
        const image = this.add
          .image(0, 0, texKey('TEN'))
          .setDisplaySize(CELL_W - 4, CELL_H - 4);
        const label = this.add
          .text(0, 0, '', {
            fontFamily: 'Arial Black, sans-serif',
            fontSize: '20px',
            color: '#ffffff',
          })
          .setOrigin(0.5);
        const container = this.add.container(x, y, [image, label]).setDepth(10);
        column.push({ container, image, label, symbol: 'TEN' });
      }
      this.cards.push(column);
    });
  }

  private drawCardFace(card: Card, symbol: SymbolId): void {
    const def = SYMBOLS[symbol];
    card.image.setTexture(texKey(symbol)).setDisplaySize(CELL_W - 4, CELL_H - 4);

    // Low symbols show a big centered letter; everything else shows its emblem
    // (baked into the texture) with a small caption underneath.
    if (def.category === 'low') {
      card.label
        .setText(def.label)
        .setColor(rgbToCss(def.glow))
        .setFontSize(34)
        .setPosition(0, 0);
    } else {
      card.label
        .setText(def.label)
        .setColor(rgbToCss(def.glow))
        .setFontSize(12)
        .setPosition(0, CELL_H / 2 - 14);
    }
    card.symbol = symbol;
  }

  private renderGrid(grid: SymbolGrid): void {
    grid.forEach((reel, r) => {
      reel.forEach((sym, row) => {
        if (this.cards[r] && this.cards[r][row]) {
          this.drawCardFace(this.cards[r][row], sym);
        }
      });
    });
  }

  // --- Input ---------------------------------------------------------------

  private onSpinClicked(): void {
    initAudio(); // unlock audio on the first user gesture
    if (this.state.spinning || this.state.bonus.active) return;
    this.doSpin(false);
  }

  private toggleAuto(): void {
    initAudio();
    if (this.state.bonus.active) return;
    this.auto = !this.auto;
    this.hud.setAutoActive(this.auto);
    if (this.auto && !this.state.spinning) this.doSpin(false);
  }

  private toggleMute(): void {
    initAudio();
    this.muted = !this.muted;
    setMuted(this.muted);
    this.hud.setMuted(this.muted);
  }

  private changeBet(delta: number): void {
    if (this.state.spinning || this.state.bonus.active) return;
    this.betIndex = Phaser.Math.Clamp(this.betIndex + delta, 0, BET_STEPS.length - 1);
    this.state.bet = BET_STEPS[this.betIndex];
    this.hud.update(this.state);
  }

  // --- Spin lifecycle ------------------------------------------------------

  private doSpin(isFree: boolean): void {
    if (this.state.spinning) return;

    if (!isFree && !this.state.bonus.active) {
      if (this.state.credits < this.state.bet) {
        this.state.message = 'Not enough credits — lower your bet.';
        this.auto = false;
        this.hud.setAutoActive(false);
        this.hud.update(this.state);
        return;
      }
      this.state.credits -= this.state.bet;
    }

    this.state.spinning = true;
    this.state.lastWin = 0;
    this.hud.setSpinEnabled(false);
    this.hud.setMultiplier(1);
    this.clearHighlights();
    spinSound();
    this.hud.update(this.state);

    const result = createSpinResult(this.state.bonus);
    this.animateReels(result.grid, () => this.resolveSpin(result.grid));
  }

  private animateReels(finalGrid: SymbolGrid, onComplete: () => void): void {
    this.reelsDone = 0;
    const reels = REEL_LAYOUT.rows.length;

    for (let r = 0; r < reels; r++) {
      const spinDuration = 350 + r * 220;
      const ticker = this.time.addEvent({
        delay: 55,
        loop: true,
        callback: () => this.setReelRandom(r),
      });

      this.time.delayedCall(spinDuration, () => {
        ticker.remove();
        this.setReelFinal(r, finalGrid);
        stopSound();
        this.bounceReel(r);
        this.reelsDone++;
        if (this.reelsDone === reels) {
          this.time.delayedCall(120, onComplete);
        }
      });
    }
  }

  private setReelRandom(reel: number): void {
    const pool = REEL_SYMBOL_POOLS[reel];
    this.cards[reel].forEach((card) => {
      const sym = pool[Math.floor(Math.random() * pool.length)];
      this.drawCardFace(card, sym);
    });
  }

  private setReelFinal(reel: number, grid: SymbolGrid): void {
    this.cards[reel].forEach((card, row) => {
      this.drawCardFace(card, grid[reel][row]);
    });
  }

  private bounceReel(reel: number): void {
    this.cards[reel].forEach((card) => {
      card.container.setScale(1, 0.7);
      this.tweens.add({ targets: card.container, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
    });
  }

  private resolveSpin(grid: SymbolGrid): void {
    const wasInBonus = this.state.bonus.active;

    // Sticky wilds persist & accumulate during the bonus.
    if (wasInBonus) {
      this.state.bonus.stickyWilds = applyStickyWilds(grid, this.state.bonus.stickyWilds);
      this.renderGrid(grid); // reflect any newly stamped wilds
    }

    const baseMult = wasInBonus ? this.state.bonus.baseMultiplier : 1;
    const multiplier = calculateWildMultiplier(grid, baseMult);
    this.hud.setMultiplier(multiplier);

    const evaluation = evaluateSpin(grid, this.state.bet, multiplier);
    const keys = detectKeys(grid);

    const messages: string[] = [];
    let win = evaluation.totalWin;

    // Past + Future key instant award.
    if (keys.bothPresent) {
      const keyBonus = KEY_BONUS_BET_MULTIPLIER * this.state.bet;
      win += keyBonus;
      messages.push(`Timeline Keys Unlocked! +${keyBonus.toLocaleString()}`);
      this.glowPositions([
        ...this.findSymbol(grid, 'PAST_KEY'),
        ...this.findSymbol(grid, 'FUTURE_KEY'),
      ]);
    }

    win = Math.round(win);
    this.state.credits += win;
    this.state.lastWin = win;

    // Highlight winning positions (boxes + sparks + pulse) + glow specials.
    const winPositions = evaluation.wins.flatMap((w) => w.positions);
    this.highlightWinBoxes(winPositions);
    this.pulsePositions(winPositions);
    this.glowPositions(this.findSymbol(grid, SCATTER_ID));
    this.glowPositions(this.findSymbol(grid, WILD_ID));

    if (win > 0) {
      winSound();
      messages.unshift(`WIN ${win.toLocaleString()}${multiplier > 1 ? `  (x${multiplier})` : ''}`);
    }

    // Big win celebration.
    if (win >= this.state.bet * 20) {
      this.showBigWin(win);
    }

    // Bonus trigger / progression.
    if (!wasInBonus) {
      const trig = evaluateBonusTrigger(grid);
      if (trig.triggered) {
        this.state.bonus = trig.bonus;
        // Any wild on the triggering grid becomes sticky immediately.
        this.state.bonus.stickyWilds = applyStickyWilds(grid, []);
        bonusSound();
        this.flashScreen();
        this.burstAt(this.scale.width / 2, CENTER_Y, 60);
        this.starShower(trig.isSuper ? 2600 : 1600);
        messages.push(
          trig.isSuper
            ? `★ CHRONO SHOWDOWN! ${trig.freeSpinsAwarded} free spins · starting x${SUPER_BONUS.startMultiplier} ★`
            : `Time Portal! ${trig.freeSpinsAwarded} free spins awarded!`,
        );
        // Manual play is locked during the bonus.
        this.auto = false;
        this.hud.setAutoActive(false);
      }
    } else {
      this.state.bonus.freeSpins -= 1;
    }

    this.state.message = messages.length ? messages.join('   ·   ') : 'No win — spin again!';
    this.state.spinning = false;
    this.hud.update(this.state);

    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.state.bonus.active) {
      if (this.state.bonus.freeSpins > 0) {
        this.time.delayedCall(950, () => this.doSpin(true));
      } else {
        this.time.delayedCall(1100, () => this.endBonus());
      }
      return;
    }

    if (this.auto) {
      if (this.state.credits >= this.state.bet) {
        this.time.delayedCall(650, () => {
          if (this.auto && !this.state.spinning) this.doSpin(false);
        });
        return;
      }
      this.auto = false;
      this.hud.setAutoActive(false);
    }

    this.hud.setSpinEnabled(true);
  }

  private endBonus(): void {
    const wasSuper = this.state.bonus.isSuperBonus;
    this.state.bonus = makeInactiveBonus();
    this.state.message = wasSuper
      ? 'Chrono Showdown complete — winnings secured!'
      : 'Bonus complete — back to base game.';
    this.hud.setMultiplier(1);
    this.hud.update(this.state);
    this.hud.setSpinEnabled(true);
  }

  // --- Highlight / FX ------------------------------------------------------

  private findSymbol(grid: SymbolGrid, symbol: SymbolId): GridPosition[] {
    const out: GridPosition[] = [];
    grid.forEach((reel, r) =>
      reel.forEach((s, row) => {
        if (s === symbol) out.push({ reel: r, row });
      }),
    );
    return out;
  }

  private cardAt(pos: GridPosition): Card | undefined {
    return this.cards[pos.reel]?.[pos.row];
  }

  private pulsePositions(positions: GridPosition[]): void {
    const seen = new Set<string>();
    for (const pos of positions) {
      const key = `${pos.reel}:${pos.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const card = this.cardAt(pos);
      if (!card) continue;
      card.pulseTween = this.tweens.add({
        targets: card.container,
        scale: 1.12,
        duration: 380,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private glowPositions(positions: GridPosition[]): void {
    for (const pos of positions) {
      const card = this.cardAt(pos);
      if (!card) continue;
      card.glowTween = this.tweens.add({
        targets: card.container,
        alpha: 0.55,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private clearHighlights(): void {
    for (const column of this.cards) {
      for (const card of column) {
        card.pulseTween?.remove();
        card.glowTween?.remove();
        card.pulseTween = undefined;
        card.glowTween = undefined;
        card.container.setScale(1).setAlpha(1);
      }
    }
    this.winBoxTween?.remove();
    this.winBoxTween = undefined;
    this.winBox.clear().setAlpha(1);
  }

  private createEffects(): void {
    // Win-highlight box layer (drawn around paying cells).
    this.winBox = this.add.graphics().setDepth(60);

    // Sparkle burst emitter for wins (tinted in neon/gold tones).
    this.sparkEmitter = this.add
      .particles(0, 0, FX_SPARK, {
        speed: { min: 40, max: 150 },
        scale: { start: 0.7, end: 0 },
        lifespan: 600,
        tint: [0x4affff, 0xffcc33, 0xff2fb0],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(70);

    // Gold star shower for big wins / bonus, falling from the top.
    this.starEmitter = this.add
      .particles(0, 0, FX_STAR, {
        x: { min: 0, max: this.scale.width },
        y: -20,
        speedY: { min: 120, max: 280 },
        speedX: { min: -50, max: 50 },
        scale: { start: 0.9, end: 0.2 },
        rotate: { start: 0, end: 360 },
        gravityY: 140,
        lifespan: 1900,
        tint: [0xffcc33, 0xfff0a0, 0xff2fb0, 0x4affff],
        blendMode: 'ADD',
        frequency: 35,
        quantity: 2,
        emitting: false,
      })
      .setDepth(85);
  }

  /** Draw + pulse highlight boxes around every paying cell, and spark them. */
  private highlightWinBoxes(positions: GridPosition[]): void {
    this.winBox.clear();
    const seen = new Set<string>();
    for (const pos of positions) {
      const key = `${pos.reel}:${pos.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const card = this.cardAt(pos);
      if (!card) continue;
      const color = SYMBOLS[card.symbol].glow;
      const x = this.reelX[pos.reel];
      const y = this.rowY(pos.reel, pos.row);
      const w = CELL_W - 2;
      const h = CELL_H - 2;
      this.winBox.lineStyle(3, color, 0.95);
      this.winBox.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 12);
      this.sparkEmitter.explode(7, x, y);
    }
    if (seen.size > 0) {
      this.winBoxTween = this.tweens.add({
        targets: this.winBox,
        alpha: { from: 1, to: 0.25 },
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private burstAt(x: number, y: number, count: number): void {
    this.sparkEmitter.explode(count, x, y);
  }

  private starShower(durationMs: number): void {
    this.starEmitter.start();
    this.time.delayedCall(durationMs, () => this.starEmitter.stop());
  }

  private flashScreen(): void {
    if (!this.flashRect) return;
    this.flashRect.setAlpha(0);
    this.tweens.add({
      targets: this.flashRect,
      alpha: 0.6,
      duration: 120,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
    });
  }

  private showBigWin(win: number): void {
    const { width, height } = this.scale;
    this.starShower(1600);
    const text = this.add
      .text(width / 2, height / 2 - 40, `BIG WIN!\n${win.toLocaleString()}`, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '64px',
        color: '#ffcc33',
        align: 'center',
        stroke: '#5a0e3a',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(90)
      .setScale(0.2);

    this.tweens.add({
      targets: text,
      scale: 1,
      duration: 450,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: text,
          alpha: 0,
          delay: 1100,
          duration: 500,
          onComplete: () => text.destroy(),
        });
      },
    });
  }
}

// Convert a 0xRRGGBB number to a CSS hex string for Phaser text colors.
function rgbToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
