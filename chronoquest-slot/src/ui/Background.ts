// Cinematic animated background — shared by the game scenes for a consistent,
// premium ChronoQuest identity. Built from cheap generated sprites (the soft
// FX_SPARK dot baked in BootScene), so there are no image files.

import Phaser from 'phaser';
import { FX_SPARK } from './fxTextures';

const STAR_TINTS = [0x4affff, 0x8a4aff, 0xff2fb0, 0xffffff, 0xffcc33];

export class Background {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, opts: { horizon?: boolean } = {}) {
    this.scene = scene;
    this.build(opts.horizon ?? true);
  }

  private build(horizon: boolean): void {
    const { width: W, height: H } = this.scene.scale;

    // Deep space gradient.
    const grad = this.scene.add.graphics().setDepth(0);
    grad.fillGradientStyle(0x05060f, 0x070a1c, 0x140a30, 0x0a1438, 1);
    grad.fillRect(0, 0, W, H);

    // Slow drifting nebula blobs (big, soft, low alpha).
    const nebula: { x: number; y: number; s: number; tint: number }[] = [
      { x: W * 0.2, y: H * 0.35, s: 9, tint: 0x6a2fff },
      { x: W * 0.8, y: H * 0.55, s: 11, tint: 0x18a0ff },
      { x: W * 0.5, y: H * 0.2, s: 8, tint: 0xff2fb0 },
    ];
    for (const n of nebula) {
      const blob = this.scene.add
        .image(n.x, n.y, FX_SPARK)
        .setTint(n.tint)
        .setAlpha(0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(n.s)
        .setDepth(0);
      this.scene.tweens.add({
        targets: blob,
        scale: n.s * 1.25,
        alpha: 0.16,
        duration: 4000 + Math.random() * 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Twinkling starfield with gentle parallax bob.
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const scale = 0.1 + Math.random() * 0.35;
      const star = this.scene.add
        .image(x, y, FX_SPARK)
        .setTint(STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0])
        .setAlpha(0.2 + Math.random() * 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(scale)
        .setDepth(1);
      this.scene.tweens.add({
        targets: star,
        alpha: 0.05,
        duration: 1200 + Math.random() * 2600,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 2000,
        ease: 'Sine.easeInOut',
      });
      this.scene.tweens.add({
        targets: star,
        y: y - 8 - Math.random() * 16,
        duration: 3000 + Math.random() * 3000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Faint neon scan-grid.
    const gridG = this.scene.add.graphics().setDepth(1).setAlpha(0.08);
    gridG.lineStyle(1, 0x4affff, 1);
    for (let x = 0; x <= W; x += 64) gridG.lineBetween(x, 90, x, H - 120);
    for (let y = 90; y <= H - 120; y += 64) gridG.lineBetween(0, y, W, y);

    // Glowing "timeline horizon" behind the reels.
    if (horizon) {
      const glow = this.scene.add
        .image(W / 2, H * 0.5, FX_SPARK)
        .setTint(0x18d0ff)
        .setAlpha(0.12)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(1);
      glow.setDisplaySize(W * 1.1, H * 0.5);
      this.scene.tweens.add({
        targets: glow,
        alpha: 0.2,
        duration: 3200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
}
