import Phaser from 'phaser';
import { FX_STAR } from '../ui/fxTextures';
import { SUPER_BONUS } from '../game/paytable';

export interface BonusIntroData {
  freeSpins: number;
  isSuper: boolean;
}

/**
 * BonusIntroScene — a short cinematic reveal played when free spins trigger.
 * Pauses the SlotScene, plays an animated banner, then emits `bonus-intro-done`
 * on the SlotScene and resumes it so the free spins can begin.
 */
export class BonusIntroScene extends Phaser.Scene {
  constructor() {
    super('BonusIntroScene');
  }

  create(data: BonusIntroData): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const isSuper = data.isSuper;
    const accent = isSuper ? 0xffcc33 : 0x4affff;
    const accentCss = isSuper ? '#ffcc33' : '#4affff';

    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0).setInteractive();
    this.tweens.add({ targets: backdrop, fillAlpha: 0.82, duration: 300 });

    // Expanding glow rings.
    for (let i = 0; i < 3; i++) {
      const ring = this.add.circle(W / 2, H / 2, 40, accent, 0).setStrokeStyle(4, accent, 0.9);
      this.tweens.add({
        targets: ring,
        radius: 260 + i * 60,
        alpha: { from: 0.9, to: 0 },
        duration: 1100,
        delay: 120 + i * 160,
        ease: 'Cubic.easeOut',
      });
    }

    // Star burst.
    const stars = this.add
      .particles(W / 2, H / 2, FX_STAR, {
        speed: { min: 120, max: 420 },
        scale: { start: 1.1, end: 0 },
        lifespan: 1300,
        quantity: 60,
        tint: [accent, 0xffffff, 0xff2fb0],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(5);
    stars.explode(60);

    // Title.
    const title = this.add
      .text(W / 2, H / 2 - 50, isSuper ? 'CHRONO SHOWDOWN' : 'FREE SPINS', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: isSuper ? '66px' : '72px',
        color: accentCss,
        stroke: '#1a0a2e',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScale(0.2)
      .setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 520, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: title,
      scale: 1.04,
      duration: 700,
      yoyo: true,
      repeat: -1,
      delay: 520,
      ease: 'Sine.easeInOut',
    });

    // Subtitle.
    const sub = isSuper
      ? `${data.freeSpins} FREE SPINS  ·  STARTS AT x${SUPER_BONUS.startMultiplier}  ·  STICKY WILDS`
      : `${data.freeSpins} FREE SPINS AWARDED`;
    const subtitle = this.add
      .text(W / 2, H / 2 + 40, sub, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: subtitle, alpha: 1, duration: 400, delay: 420 });

    const hint = this.add
      .text(W / 2, H - 70, 'tap to continue', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#9fd8ff',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: hint, alpha: 0.8, duration: 400, delay: 900 });

    // Auto-dismiss, or tap to skip.
    const finish = () => this.finish();
    backdrop.once('pointerdown', finish);
    this.input.keyboard?.once('keydown', finish);
    this.time.delayedCall(2600, finish);
  }

  private done = false;
  private finish(): void {
    if (this.done) return;
    this.done = true;
    const slot = this.scene.get('SlotScene');
    this.cameras.main.fadeOut(220, 5, 6, 15);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.resume('SlotScene');
      slot.events.emit('bonus-intro-done');
      this.scene.stop();
    });
  }
}
