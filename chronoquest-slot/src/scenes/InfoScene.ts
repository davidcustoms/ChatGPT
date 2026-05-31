import Phaser from 'phaser';

import { PAYTABLE, SCATTER_AWARDS, KEY_BONUS_BET_MULTIPLIER, SUPER_BONUS } from '../game/paytable';
import { REFERENCE_BET } from '../game/reelConfig';
import { PAYING_SYMBOLS, SYMBOLS } from '../game/symbols';
import { texKey } from '../ui/symbolTextures';
import type { SymbolId } from '../game/types';

/**
 * InfoScene — a paytable + rules overlay launched on top of the SlotScene.
 * The SlotScene is paused while this is open and resumed on close.
 */
export class InfoScene extends Phaser.Scene {
  constructor() {
    super('InfoScene');
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Dim backdrop (click anywhere to close).
    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.92).setInteractive();
    backdrop.on('pointerdown', () => this.close());

    this.add
      .text(W / 2, 40, 'PAYTABLE & FEATURES', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '32px',
        color: '#4affff',
      })
      .setOrigin(0.5);
    this.add
      .text(W / 2, 72, `Payouts shown per way at bet ${REFERENCE_BET} — they scale with your bet and the win multiplier.`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#9fd8ff',
      })
      .setOrigin(0.5);

    // --- Paying symbols in 3 columns ---
    const colX = [240, 640, 1040];
    const startY = 130;
    const stepY = 56;
    PAYING_SYMBOLS.forEach((id, i) => {
      const col = Math.floor(i / 5);
      const row = i % 5;
      this.drawPayRow(colX[col], startY + row * stepY, id);
    });

    // --- Special symbols + feature rules ---
    const specialY = 430;
    this.add
      .text(W / 2, specialY - 24, 'SPECIAL SYMBOLS & FEATURES', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '20px',
        color: '#ffcc33',
      })
      .setOrigin(0.5);

    const rules: { id: SymbolId; text: string }[] = [
      { id: 'WILD_CAPTAIN', text: 'Substitutes for paying symbols (middle reels). Each adds +1x to the multiplier.' },
      { id: 'SCATTER', text: `3/4/5 anywhere award ${SCATTER_AWARDS[3]}/${SCATTER_AWARDS[4]}/${SCATTER_AWARDS[5]} free spins. Wilds turn sticky in the bonus.` },
      { id: 'PAST_KEY', text: `Past Key (reel 1) + Future Key (reel 5) together pay an instant ${KEY_BONUS_BET_MULTIPLIER}x bet.` },
      { id: 'FUTURE_KEY', text: `Scatters + both Keys trigger CHRONO SHOWDOWN: ${SUPER_BONUS.freeSpins} free spins starting at x${SUPER_BONUS.startMultiplier}.` },
    ];
    rules.forEach((r, i) => {
      const y = specialY + 20 + i * 52;
      this.add.image(120, y, texKey(r.id)).setDisplaySize(60, 42);
      this.add
        .text(170, y - 12, SYMBOLS[r.id].name, {
          fontFamily: 'Arial Black, sans-serif',
          fontSize: '15px',
          color: rgbToCss(SYMBOLS[r.id].glow),
        })
        .setOrigin(0, 0.5);
      this.add
        .text(170, y + 10, r.text, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
          color: '#c8d4ff',
        })
        .setOrigin(0, 0.5);
    });

    // --- Close button ---
    const close = this.add.container(W - 50, 44);
    const g = this.add.graphics();
    g.fillStyle(0xff2fb0, 0.18);
    g.fillRoundedRect(-26, -22, 52, 44, 12);
    g.lineStyle(3, 0xff2fb0, 1);
    g.strokeRoundedRect(-26, -22, 52, 44, 12);
    close.add([g, this.add.text(0, 0, '✕', { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff' }).setOrigin(0.5)]);
    close.setSize(52, 44).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());

    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private drawPayRow(x: number, y: number, id: SymbolId): void {
    const def = SYMBOLS[id];
    const pay = PAYTABLE[id];
    this.add.image(x - 110, y, texKey(id)).setDisplaySize(58, 40);
    this.add
      .text(x - 72, y - 12, def.name, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '15px',
        color: rgbToCss(def.glow),
      })
      .setOrigin(0, 0.5);
    const payText = pay ? `3:${pay[3]}   4:${pay[4]}   5:${pay[5]}` : '';
    this.add
      .text(x - 72, y + 10, payText, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#c8d4ff',
      })
      .setOrigin(0, 0.5);
  }

  private close(): void {
    this.scene.resume('SlotScene');
    this.scene.stop();
  }
}

function rgbToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
