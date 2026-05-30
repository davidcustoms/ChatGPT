import Phaser from 'phaser';
import { generateSymbolTextures } from '../ui/symbolTextures';

/**
 * BootScene — lightweight intro. Art is generated procedurally, so this scene
 * bakes the symbol textures once and then shows a branded splash before handing
 * off to the SlotScene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const { width, height } = this.scale;

    // Bake all symbol sprites into the texture cache up front.
    generateSymbolTextures(this);

    this.cameras.main.setBackgroundColor('#05060f');

    const title = this.add
      .text(width / 2, height / 2 - 30, 'ChronoQuest', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '64px',
        color: '#4affff',
        stroke: '#1a1f4a',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const subtitle = this.add
      .text(width / 2, height / 2 + 30, 'TEAM SHOWDOWN', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '30px',
        color: '#ff2fb0',
        letterSpacing: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const hint = this.add
      .text(width / 2, height - 80, 'Free-play demo · fake credits only', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#6a7ba8',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({ targets: [title, subtitle, hint], alpha: 1, duration: 600, ease: 'Sine.easeOut' });

    this.time.delayedCall(1100, () => {
      this.cameras.main.fadeOut(350, 5, 6, 15);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('SlotScene'));
    });
  }
}
