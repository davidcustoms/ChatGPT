// HUD: credits / bet / win / message / free-spin counter + buttons.
//
// Pure Phaser display layer. It exposes update methods the SlotScene calls and
// fires callbacks for the Spin / Auto / bet-adjust buttons.

import Phaser from 'phaser';
import type { SlotGameState } from '../game/types';
import { FX_SPARK } from './fxTextures';

export interface HudCallbacks {
  onSpin: () => void;
  onToggleAuto: () => void;
  onBetChange: (delta: number) => void;
  onToggleMute: () => void;
  onInfo: () => void;
}

const PANEL = 0x0a0e24;
const ACCENT = 0x4affff;
const GOLD = 0xffcc33;

export class Hud {
  private scene: Phaser.Scene;
  private cb: HudCallbacks;

  private creditsText!: Phaser.GameObjects.Text;
  private betText!: Phaser.GameObjects.Text;
  private winText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private freeSpinText!: Phaser.GameObjects.Text;
  private multiplierText!: Phaser.GameObjects.Text;
  private bonusBanner!: Phaser.GameObjects.Text;

  private spinButton!: Phaser.GameObjects.Container;
  private spinLabel!: Phaser.GameObjects.Text;
  private autoButton!: Phaser.GameObjects.Container;
  private autoLabel!: Phaser.GameObjects.Text;
  private muteLabel!: Phaser.GameObjects.Text;
  private spinGlow!: Phaser.GameObjects.Image;
  private spinGlowTween?: Phaser.Tweens.Tween;
  private winTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, cb: HudCallbacks) {
    this.scene = scene;
    this.cb = cb;
    this.build();
  }

  private build(): void {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;

    // --- Bonus banner (top center, hidden by default) ---
    this.bonusBanner = this.scene.add
      .text(W / 2, 30, '', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '34px',
        color: '#ffcc33',
        stroke: '#5a0e3a',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setVisible(false)
      .setDepth(50);

    // --- Message line (above reels) ---
    this.messageText = this.scene.add
      .text(W / 2, 78, 'Spin to begin your ChronoQuest!', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#9fd8ff',
      })
      .setOrigin(0.5)
      .setDepth(50);

    // --- Free spins + multiplier (top-right) ---
    this.freeSpinText = this.scene.add
      .text(W - 24, 96, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#4affff',
        align: 'right',
      })
      .setOrigin(1, 0.5)
      .setDepth(50);

    this.multiplierText = this.scene.add
      .text(24, 96, '', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '22px',
        color: '#ff2fb0',
      })
      .setOrigin(0, 0.5)
      .setDepth(50);

    // --- Bottom info panel ---
    const panelY = H - 70;
    const panel = this.scene.add.graphics().setDepth(40);
    panel.fillStyle(PANEL, 0.92);
    panel.fillRoundedRect(16, H - 120, W - 32, 104, 16);
    panel.lineStyle(2, ACCENT, 0.5);
    panel.strokeRoundedRect(16, H - 120, W - 32, 104, 16);

    this.creditsText = this.makeStat(120, panelY, 'CREDITS', '#ffffff');
    this.betText = this.makeStat(360, panelY, 'BET', '#9fd8ff');
    this.winText = this.makeStat(600, panelY, 'WIN', '#ffcc33');

    // --- Bet +/- buttons ---
    this.makeMiniButton(300, panelY + 22, '-', () => this.cb.onBetChange(-1));
    this.makeMiniButton(420, panelY + 22, '+', () => this.cb.onBetChange(1));

    // --- Spin button (with a pulsing glow when ready) ---
    this.spinGlow = this.scene.add
      .image(W - 130, panelY, FX_SPARK)
      .setTint(GOLD)
      .setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(45);
    this.spinGlow.setDisplaySize(196, 116);
    this.spinButton = this.makeButton(W - 130, panelY, 150, 76, 'SPIN', GOLD, () =>
      this.cb.onSpin(),
    );
    this.spinLabel = this.spinButton.getData('label');

    // --- Auto button ---
    this.autoButton = this.makeButton(W - 300, panelY, 130, 76, 'AUTO', ACCENT, () =>
      this.cb.onToggleAuto(),
    );
    this.autoLabel = this.autoButton.getData('label');

    // --- Mute toggle (top-left) ---
    const muteButton = this.makeButton(74, 36, 116, 40, '♪ SOUND', ACCENT, () =>
      this.cb.onToggleMute(),
    );
    this.muteLabel = muteButton.getData('label');
    this.muteLabel.setFontSize(15);

    // --- Info / paytable button (top-left, next to mute) ---
    const infoButton = this.makeButton(202, 36, 92, 40, 'ⓘ INFO', GOLD, () => this.cb.onInfo());
    (infoButton.getData('label') as Phaser.GameObjects.Text).setFontSize(15);
  }

  private makeStat(x: number, y: number, label: string, color: string): Phaser.GameObjects.Text {
    this.scene.add
      .text(x, y - 18, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '13px',
        color: '#6a7ba8',
      })
      .setOrigin(0.5)
      .setDepth(50);
    return this.scene.add
      .text(x, y + 8, '0', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '26px',
        color,
      })
      .setOrigin(0.5)
      .setDepth(50);
  }

  private makeMiniButton(x: number, y: number, label: string, onClick: () => void): void {
    const g = this.scene.add.graphics().setDepth(50);
    g.fillStyle(0x1a2148, 1);
    g.fillRoundedRect(x - 22, y - 22, 44, 44, 10);
    g.lineStyle(2, ACCENT, 0.7);
    g.strokeRoundedRect(x - 22, y - 22, 44, 44, 10);
    const t = this.scene.add
      .text(x, y, label, { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(51);
    t.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    const zone = this.scene.add
      .zone(x, y, 44, 44)
      .setInteractive({ useHandCursor: true })
      .setDepth(52);
    zone.on('pointerdown', onClick);
  }

  private makeButton(
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(cx, cy).setDepth(50);
    const g = this.scene.add.graphics();
    g.fillStyle(color, 0.18);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.lineStyle(3, color, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    container.add([g, text]);
    container.setData('label', text);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    container.on('pointerover', () => g.setAlpha(0.8));
    container.on('pointerout', () => g.setAlpha(1));
    return container;
  }

  // --- Public update API ---------------------------------------------------

  update(state: SlotGameState): void {
    this.creditsText.setText(formatNumber(state.credits));
    this.betText.setText(formatNumber(state.bet));
    this.messageText.setText(state.message);

    if (state.bonus.active) {
      this.bonusBanner
        .setVisible(true)
        .setText(state.bonus.isSuperBonus ? '★ CHRONO SHOWDOWN ★' : 'BONUS MODE');
      this.freeSpinText.setText(
        `FREE SPINS  ${state.bonus.freeSpins} / ${state.bonus.totalFreeSpins}`,
      );
    } else {
      this.bonusBanner.setVisible(false);
      this.freeSpinText.setText('');
    }
  }

  setMultiplier(mult: number): void {
    this.multiplierText.setText(mult > 1 ? `MULTIPLIER  x${mult}` : '');
  }

  setSpinEnabled(enabled: boolean): void {
    this.spinButton.setAlpha(enabled ? 1 : 0.4);
    if (enabled) {
      this.spinButton.setInteractive({ useHandCursor: true });
      this.spinGlow.setVisible(true);
      this.spinGlowTween?.remove();
      this.spinGlowTween = this.scene.tweens.add({
        targets: this.spinGlow,
        alpha: 0.7,
        scale: this.spinGlow.scale * 1.08,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.spinButton.disableInteractive();
      this.spinGlowTween?.remove();
      this.spinGlowTween = undefined;
      this.spinGlow.setVisible(false);
    }
  }

  /** Set the win amount instantly (no animation). */
  setWin(value: number): void {
    this.winTween?.remove();
    this.winTween = undefined;
    this.winText.setScale(1).setText(formatNumber(Math.round(value)));
  }

  /** Count the win up from zero with a little pop. */
  animateWin(value: number): void {
    this.winTween?.remove();
    const counter = { v: 0 };
    this.winText.setScale(1);
    this.scene.tweens.add({ targets: this.winText, scale: 1.3, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
    this.winTween = this.scene.tweens.add({
      targets: counter,
      v: value,
      duration: Math.min(900, 350 + value / 2),
      ease: 'Cubic.easeOut',
      onUpdate: () => this.winText.setText(formatNumber(Math.round(counter.v))),
      onComplete: () => {
        this.winText.setText(formatNumber(Math.round(value)));
        this.winTween = undefined;
      },
    });
  }

  setSpinLabel(label: string): void {
    this.spinLabel.setText(label);
  }

  setAutoActive(active: boolean): void {
    this.autoLabel.setText(active ? 'STOP' : 'AUTO');
  }

  setMuted(muted: boolean): void {
    this.muteLabel.setText(muted ? '✕ MUTED' : '♪ SOUND');
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
