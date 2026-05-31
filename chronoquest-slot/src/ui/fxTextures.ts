// Procedural particle textures.
//
// Like the symbols, particle art is generated at runtime (no image files) and
// baked into the texture cache for the win/bonus effect emitters.

import Phaser from 'phaser';

export const FX_SPARK = 'fx-spark';
export const FX_STAR = 'fx-star';

export function generateFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_SPARK)) {
    // Soft round glow dot (tinted per-emitter at runtime).
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let r = 16; r > 0; r--) {
      g.fillStyle(0xffffff, 0.08);
      g.fillCircle(16, 16, r);
    }
    g.generateTexture(FX_SPARK, 32, 32);
    g.destroy();
  }

  if (!scene.textures.exists(FX_STAR)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const cx = 14;
    const cy = 14;
    const pts: Phaser.Geom.Point[] = [];
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? 13 : 5.5;
      const a = (Math.PI * i) / points - Math.PI / 2;
      pts.push(new Phaser.Geom.Point(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
    }
    g.fillStyle(0xffffff, 1);
    g.fillPoints(pts, true);
    g.generateTexture(FX_STAR, 28, 28);
    g.destroy();
  }
}
