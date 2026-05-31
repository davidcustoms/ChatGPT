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
import { Background } from '../ui/Background';
import { texKey } from '../ui/symbolTextures';
import { FX_SPARK, FX_STAR } from '../ui/fxTextures';
import type { BonusIntroData } from './BonusIntroScene';
import { bigWinSound, bonusSound, initAudio, setMuted, spinSound, stopSound, winSound } from '../audio/sound';
import { loadSave, writeSave } from '../game/persistence';

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
const STARTING_CREDITS = 10000;

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
  private glowSprites: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('SlotScene');
  }

  create(): void {
    this.cameras.main.fadeIn(300);

    // Restore a saved session (fake credits, bet level, mute) if present.
    const saved = loadSave();
    if (saved) {
      this.betIndex = Phaser.Math.Clamp(saved.betIndex, 0, BET_STEPS.length - 1);
      this.muted = saved.muted;
    }

    this.state = {
      credits: saved ? saved.credits : STARTING_CREDITS,
      bet: BET_STEPS[this.betIndex],
      lastWin: 0,
      spinning: false,
      message: 'Spin to begin your ChronoQuest!',
      bonus: makeInactiveBonus(),
    };

    // Apply restored mute preference (also primes audio's initial gain).
    setMuted(this.muted);

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
      onInfo: () => this.openInfo(),
      onReset: () => this.resetBalance(),
    });
    this.hud.update(this.state);
    this.hud.setMuted(this.muted);
  }

  private persist(): void {
    writeSave({ credits: this.state.credits, betIndex: this.betIndex, muted: this.muted });
  }

  private resetBalance(): void {
    if (this.state.spinning || this.state.bonus.active) return;
    this.state.credits = STARTING_CREDITS;
    this.state.lastWin = 0;
    this.state.message = 'Balance reset to 10,000 fake credits.';
    this.persist();
    this.hud.update(this.state);
    this.hud.setWin(0);
  }

  // --- Rendering -----------------------------------------------------------

  private drawBackground(): void {
    // Shared cinematic backdrop (gradient, nebula, twinkling starfield, horizon).
    new Background(this);
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
    const cx = this.scale.width / 2;
    const maxRows = Math.max(...REEL_LAYOUT.rows);
    const frameH = maxRows * CELL_H + (maxRows - 1) * CELL_GAP + 48;
    const fx = startX - 28;
    const fy = CENTER_Y - frameH / 2;
    const fw = totalW + 56;

    // Outer glow halo (soft, breathing) behind the cabinet.
    const halo = this.add
      .image(cx, CENTER_Y, FX_SPARK)
      .setTint(0x18a8ff)
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(2);
    halo.setDisplaySize(fw + 160, frameH + 160);
    this.tweens.add({ targets: halo, alpha: 0.28, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const frame = this.add.graphics().setDepth(3);

    // Metallic bezel with an inner glass panel.
    frame.fillStyle(0x10152e, 0.96);
    frame.fillRoundedRect(fx, fy, fw, frameH, 26);
    frame.fillStyle(0x060a1c, 0.92);
    frame.fillRoundedRect(fx + 14, fy + 14, fw - 28, frameH - 28, 18);

    // Per-reel column tints + dividers (subtle "glass" channels).
    for (let r = 0; r < reels; r++) {
      const colX = this.reelX[r] - CELL_W / 2 - 3;
      frame.fillStyle(0x0a1130, 0.5);
      frame.fillRoundedRect(colX, fy + 18, CELL_W + 6, frameH - 36, 12);
      if (r > 0) {
        const dx = (this.reelX[r] + this.reelX[r - 1]) / 2;
        frame.lineStyle(1, 0x4affff, 0.16);
        frame.lineBetween(dx, fy + 22, dx, fy + frameH - 22);
      }
    }

    // Double neon edge: cyan outer, magenta inner.
    frame.lineStyle(4, 0x4affff, 0.9);
    frame.strokeRoundedRect(fx, fy, fw, frameH, 26);
    frame.lineStyle(2, 0xff2fb0, 0.55);
    frame.strokeRoundedRect(fx + 14, fy + 14, fw - 28, frameH - 28, 18);

    // Corner accents.
    frame.lineStyle(3, 0xffcc33, 0.85);
    const c = 22;
    const corners: [number, number, number, number][] = [
      [fx + 6, fy + 6, 1, 1],
      [fx + fw - 6, fy + 6, -1, 1],
      [fx + 6, fy + frameH - 6, 1, -1],
      [fx + fw - 6, fy + frameH - 6, -1, -1],
    ];
    for (const [px, py, sx, sy] of corners) {
      frame.lineBetween(px, py, px + c * sx, py);
      frame.lineBetween(px, py, px, py + c * sy);
    }

    this.drawLogoPlaque(cx, fy);
  }

  /** ChronoQuest logo plaque mounted on the top bezel — reinforces identity. */
  private drawLogoPlaque(cx: number, frameTop: number): void {
    const y = frameTop - 2;
    const w = 300;
    const h = 40;
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(0x12082e, 0.98);
    g.fillRoundedRect(cx - w / 2, y - h / 2, w, h, 14);
    g.lineStyle(2, 0x4affff, 0.9);
    g.strokeRoundedRect(cx - w / 2, y - h / 2, w, h, 14);

    // Small chrono emblem (orbit) on the left of the plaque.
    g.lineStyle(2, 0xffcc33, 0.9);
    g.strokeCircle(cx - w / 2 + 26, y, 10);
    g.lineBetween(cx - w / 2 + 26, y, cx - w / 2 + 26, y - 7);
    g.lineBetween(cx - w / 2 + 26, y, cx - w / 2 + 31, y + 3);

    const logo = this.add
      .text(cx + 12, y, 'CHRONOQUEST', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '22px',
        color: '#4affff',
      })
      .setOrigin(0.5)
      .setDepth(5);
    const sub = this.add
      .text(cx + 118, y + 1, 'SHOWDOWN', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '13px',
        color: '#ff2fb0',
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.tweens.add({ targets: [logo, sub], alpha: { from: 0.7, to: 1 }, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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

  /** Apply a symbol's texture + label styling to an image/label pair. */
  private styleCard(
    image: Phaser.GameObjects.Image,
    label: Phaser.GameObjects.Text,
    symbol: SymbolId,
  ): void {
    const def = SYMBOLS[symbol];
    image.setTexture(texKey(symbol)).setDisplaySize(CELL_W - 4, CELL_H - 4);
    // Low symbols show a big centered letter; everything else shows its emblem
    // (baked into the texture) with a small caption underneath.
    if (def.category === 'low') {
      label.setText(def.label).setColor(rgbToCss(def.glow)).setFontSize(34).setPosition(0, 0);
    } else {
      label
        .setText(def.label)
        .setColor(rgbToCss(def.glow))
        .setFontSize(12)
        .setPosition(0, CELL_H / 2 - 14);
    }
  }

  /** Build a standalone symbol node (image + label) for use in scrolling strips. */
  private makeSymbolCard(symbol: SymbolId): Phaser.GameObjects.Container {
    const image = this.add.image(0, 0, texKey(symbol));
    const label = this.add
      .text(0, 0, '', { fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);
    this.styleCard(image, label, symbol);
    return this.add.container(0, 0, [image, label]);
  }

  private drawCardFace(card: Card, symbol: SymbolId): void {
    this.styleCard(card.image, card.label, symbol);
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
    this.persist();
  }

  private openInfo(): void {
    // Pause the base game (also halts free-spin timers) while the overlay is up.
    this.scene.launch('InfoScene');
    this.scene.pause();
  }

  private changeBet(delta: number): void {
    if (this.state.spinning || this.state.bonus.active) return;
    this.betIndex = Phaser.Math.Clamp(this.betIndex + delta, 0, BET_STEPS.length - 1);
    this.state.bet = BET_STEPS[this.betIndex];
    this.hud.update(this.state);
    this.persist();
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
    this.hud.setWin(0);

    const result = createSpinResult(this.state.bonus);
    this.animateReels(result.grid, () => this.resolveSpin(result.grid));
  }

  private animateReels(finalGrid: SymbolGrid, onComplete: () => void): void {
    this.reelsDone = 0;
    const reels = REEL_LAYOUT.rows.length;

    // Hide the resting cards while the scrolling strips play over the window.
    for (const column of this.cards) {
      for (const card of column) card.container.setVisible(false);
    }

    let extra = 0; // accumulated anticipation slow-down (keeps stop order)
    for (let r = 0; r < reels; r++) {
      // Scatters already locked on earlier reels build "near-miss" suspense.
      let scattersBefore = 0;
      for (let k = 0; k < r; k++) {
        scattersBefore += finalGrid[k].filter((s) => s === SCATTER_ID).length;
      }
      const anticipate = scattersBefore >= 2;
      if (anticipate) extra += 850;

      const duration = 620 + r * 260 + extra;
      const anticGlow = anticipate ? this.anticipationGlow(r) : undefined;

      this.spinReelStrip(r, finalGrid[r], duration, () => {
        anticGlow?.destroy();
        this.setReelFinal(r, finalGrid);
        this.cards[r].forEach((card) => card.container.setVisible(true));
        stopSound();
        this.bounceReel(r);
        this.reelStopFlash(r);
        this.reelsDone++;
        if (this.reelsDone === reels) {
          this.time.delayedCall(120, onComplete);
        }
      });
    }
  }

  /** Center + extent of a reel's visible window. */
  private reelWindow(reel: number): { cx: number; cy: number; h: number } {
    const n = REEL_LAYOUT.rows[reel];
    const top = this.rowY(reel, 0) - CELL_H / 2;
    const bottom = this.rowY(reel, n - 1) + CELL_H / 2;
    return { cx: this.reelX[reel], cy: (top + bottom) / 2, h: bottom - top };
  }

  /** Brief additive flash when a reel snaps to a stop. */
  private reelStopFlash(reel: number): void {
    const w = this.reelWindow(reel);
    const rect = this.add
      .rectangle(w.cx, w.cy, CELL_W, w.h, 0xffffff, 0.35)
      .setDepth(40)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: rect, fillAlpha: 0, duration: 260, ease: 'Cubic.easeOut', onComplete: () => rect.destroy() });
  }

  /** Pulsing gold column highlight while a reel spins in scatter anticipation. */
  private anticipationGlow(reel: number): Phaser.GameObjects.Rectangle {
    const w = this.reelWindow(reel);
    const g = this.add
      .rectangle(w.cx, w.cy, CELL_W + 10, w.h + 10, 0xffcc33, 0.06)
      .setStrokeStyle(3, 0xffcc33, 0.9)
      .setDepth(12)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: g, fillAlpha: 0.2, duration: 360, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return g;
  }

  /**
   * Animate one reel as a masked vertical strip: the final symbols sit at the
   * top of a strip padded below with random symbols; the strip starts shifted up
   * (window full of randoms) and eases down so the finals settle into place.
   */
  private spinReelStrip(
    reel: number,
    finalSymbols: SymbolId[],
    duration: number,
    onDone: () => void,
  ): void {
    const n = REEL_LAYOUT.rows[reel];
    const pitch = CELL_H + CELL_GAP;
    const x = this.reelX[reel];
    const pad = n + 8; // random symbols below the finals (covers the scroll)
    const pool = REEL_SYMBOL_POOLS[reel];

    const strip = this.add.container(0, 0).setDepth(11);

    // Mask the strip to the reel's visible window.
    const top = this.rowY(reel, 0) - CELL_H / 2;
    const bottom = this.rowY(reel, n - 1) + CELL_H / 2;
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff);
    maskG.fillRect(x - CELL_W / 2, top, CELL_W, bottom - top);
    strip.setMask(maskG.createGeometryMask());

    // Finals at the top of the strip, random padding below.
    finalSymbols.forEach((sym, j) => {
      const card = this.makeSymbolCard(sym).setPosition(x, this.rowY(reel, j));
      strip.add(card);
    });
    for (let k = 1; k <= pad; k++) {
      const sym = pool[Math.floor(Math.random() * pool.length)];
      const card = this.makeSymbolCard(sym).setPosition(x, this.rowY(reel, n - 1) + k * pitch);
      strip.add(card);
    }

    strip.y = -(pad * pitch); // start with the window full of randoms
    this.tweens.add({
      targets: strip,
      y: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        strip.destroy();
        maskG.destroy();
        onDone();
      },
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
    let justTriggered = false;
    if (!wasInBonus) {
      const trig = evaluateBonusTrigger(grid);
      if (trig.triggered) {
        justTriggered = true;
        this.state.bonus = trig.bonus;
        // Any wild on the triggering grid becomes sticky immediately.
        this.state.bonus.stickyWilds = applyStickyWilds(grid, []);
        bonusSound();
        this.flashScreen();
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
    if (win > 0) this.hud.animateWin(win);
    else this.hud.setWin(0);
    this.persist();

    // Play the cinematic bonus intro before the free spins begin.
    if (justTriggered) {
      this.time.delayedCall(850, () => this.playBonusIntro(this.state.bonus.isSuperBonus));
    } else {
      this.scheduleNext();
    }
  }

  private playBonusIntro(isSuper: boolean): void {
    const data: BonusIntroData = { freeSpins: this.state.bonus.totalFreeSpins, isSuper };
    this.events.once('bonus-intro-done', () => this.scheduleNext());
    this.scene.launch('BonusIntroScene', data);
    this.scene.pause();
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
      // Soft additive halo behind the symbol (cleaned up on the next spin).
      const halo = this.add
        .image(this.reelX[pos.reel], this.rowY(pos.reel, pos.row), FX_SPARK)
        .setTint(SYMBOLS[card.symbol].glow)
        .setAlpha(0.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9);
      halo.setDisplaySize(CELL_W * 1.5, CELL_H * 1.6);
      this.tweens.add({ targets: halo, alpha: 0.75, scale: halo.scale * 1.12, duration: 560, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.glowSprites.push(halo);

      card.glowTween = this.tweens.add({
        targets: card.container,
        scale: 1.06,
        duration: 560,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** One-shot expanding ring "pop" at a winning cell. */
  private winRing(pos: GridPosition, color: number): void {
    const ring = this.add
      .circle(this.reelX[pos.reel], this.rowY(pos.reel, pos.row), 18, color, 0)
      .setStrokeStyle(3, color, 0.9)
      .setDepth(62);
    this.tweens.add({
      targets: ring,
      radius: 58,
      alpha: { from: 0.9, to: 0 },
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
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
    for (const g of this.glowSprites) g.destroy();
    this.glowSprites = [];
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
      this.winRing(pos, color);
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
    const x = win / this.state.bet;

    // Escalating tiers: BIG (>=20x) → MEGA (>=50x) → EPIC (>=100x).
    const tier: 'big' | 'mega' | 'epic' = x >= 100 ? 'epic' : x >= 50 ? 'mega' : 'big';
    const cfg = {
      big: { label: 'BIG WIN', color: '#ffcc33', stroke: '#5a0e3a', size: 60, shower: 1600 },
      mega: { label: 'MEGA WIN', color: '#ff8a3a', stroke: '#3a0e2e', size: 74, shower: 2400 },
      epic: { label: 'EPIC WIN', color: '#4affff', stroke: '#2a0e5a', size: 88, shower: 3400 },
    }[tier];

    bigWinSound(tier);
    this.starShower(cfg.shower);
    if (tier !== 'big') this.flashScreen();

    const label = this.add
      .text(width / 2, height / 2 - 56, cfg.label, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: `${cfg.size}px`,
        color: cfg.color,
        stroke: cfg.stroke,
        strokeThickness: 12,
      })
      .setOrigin(0.5)
      .setDepth(90)
      .setScale(0.2);

    // Count the amount up underneath the tier banner.
    const amount = this.add
      .text(width / 2, height / 2 + 14, '0', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '48px',
        color: '#ffffff',
        stroke: cfg.stroke,
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(90);

    this.tweens.add({ targets: label, scale: 1, duration: 450, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: label,
      scale: 1.05,
      duration: 600,
      yoyo: true,
      repeat: 1,
      delay: 450,
      ease: 'Sine.easeInOut',
    });
    const counter = { v: 0 };
    this.tweens.add({
      targets: counter,
      v: win,
      duration: Math.min(1400, 500 + x * 6),
      ease: 'Cubic.easeOut',
      onUpdate: () => amount.setText(Math.round(counter.v).toLocaleString()),
      onComplete: () => amount.setText(win.toLocaleString()),
    });

    this.tweens.add({
      targets: [label, amount],
      alpha: 0,
      delay: 1700 + cfg.shower * 0.2,
      duration: 500,
      onComplete: () => {
        label.destroy();
        amount.destroy();
      },
    });
  }
}

// Convert a 0xRRGGBB number to a CSS hex string for Phaser text colors.
function rgbToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
