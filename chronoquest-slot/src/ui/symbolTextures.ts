// Procedural symbol art.
//
// Instead of loading PNGs, we draw each symbol once with Phaser Graphics and
// bake it into a cached texture (Texture Manager). The reels then use cheap
// Image sprites that just swap textures. Everything here is original, generated
// vector art — gradients, glow rings and a distinct emblem per symbol.
//
// To replace this with real PNG art later, preload your images in BootScene with
// the same keys (`texKey(id)`) and skip calling generateSymbolTextures().

import Phaser from 'phaser';
import { SYMBOLS, type SymbolDef } from '../game/symbols';
import type { SymbolId } from '../game/types';

/** Supersampled base texture size (downscaled at display time for crisp edges). */
export const TEX_SCALE = 2;
const BASE_W = 120;
const BASE_H = 84;

export function texKey(id: SymbolId): string {
  return `sym-${id}`;
}

/** Bake a texture for every symbol into the scene's texture manager. */
export function generateSymbolTextures(scene: Phaser.Scene): void {
  const W = BASE_W * TEX_SCALE;
  const H = BASE_H * TEX_SCALE;
  (Object.keys(SYMBOLS) as SymbolId[]).forEach((id) => {
    const key = texKey(id);
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawCard(g, W, H, SYMBOLS[id]);
    g.generateTexture(key, W, H);
    g.destroy();
  });
}

// --- Card composition ------------------------------------------------------

function drawCard(g: Phaser.GameObjects.Graphics, W: number, H: number, def: SymbolDef): void {
  const big = def.id === 'WILD_CAPTAIN' || def.id === 'SCATTER';
  const r = Math.round(W * 0.12);

  // Soft outer glow (stacked translucent strokes).
  for (let i = 4; i >= 1; i--) {
    g.lineStyle(i * 3, def.glow, 0.05 * i);
    g.strokeRoundedRect(i * 2, i * 2, W - i * 4, H - i * 4, r);
  }

  // Base fill + top sheen for depth.
  g.fillStyle(darken(def.color, 0.2), 1);
  g.fillRoundedRect(8, 8, W - 16, H - 16, r);
  g.fillStyle(lighten(def.color, 0.28), 0.45);
  g.fillRoundedRect(16, 14, W - 32, H * 0.42, r * 0.8);

  // Border.
  g.lineStyle(big ? 8 : 4, def.glow, 1);
  g.strokeRoundedRect(8, 8, W - 16, H - 16, r);
  if (big) {
    g.lineStyle(3, lighten(def.glow, 0.3), 0.5);
    g.strokeRoundedRect(22, 22, W - 44, H - 44, r * 0.7);
  }

  // Emblem.
  drawIcon(g, def, W, H);
}

// --- Per-symbol emblems ----------------------------------------------------

function drawIcon(g: Phaser.GameObjects.Graphics, def: SymbolDef, W: number, H: number): void {
  const cx = W / 2;
  // Low symbols carry a big letter (drawn as a Text overlay by the scene), so
  // their emblem is a subtle backing diamond positioned center.
  const cy = def.category === 'low' ? H / 2 : H * 0.4;
  const s = W * 0.3;
  const c = def.glow;
  const hi = lighten(def.glow, 0.4);

  switch (def.id) {
    // Low — faint backing rune.
    case 'TEN':
    case 'J':
    case 'Q':
    case 'K':
    case 'A':
      g.lineStyle(3, c, 0.35);
      diamond(g, cx, cy, s * 1.2, s * 1.4, false);
      break;

    // Mid
    case 'GEAR':
      cog(g, cx, cy, s, c, hi);
      break;
    case 'CRYSTAL':
      g.fillStyle(c, 0.9);
      diamond(g, cx, cy, s, s * 1.3, true);
      g.lineStyle(2, hi, 0.9);
      diamond(g, cx, cy, s, s * 1.3, false);
      g.lineStyle(2, hi, 0.6);
      g.lineBetween(cx, cy - s * 0.65, cx, cy + s * 0.65);
      break;
    case 'REACTOR':
      g.lineStyle(4, c, 0.9);
      g.strokeCircle(cx, cy, s * 0.7);
      g.fillStyle(hi, 1);
      g.fillCircle(cx, cy, s * 0.28);
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        g.fillStyle(c, 0.9);
        g.fillCircle(cx + Math.cos(a) * s * 0.7, cy + Math.sin(a) * s * 0.7, s * 0.12);
      }
      break;
    case 'PORTAL_SHARD':
      g.fillStyle(c, 0.9);
      g.fillPoints(
        [p(cx, cy - s), p(cx + s * 0.5, cy), p(cx + s * 0.15, cy + s), p(cx - s * 0.45, cy + s * 0.3)],
        true,
      );
      break;

    // Premium teams
    case 'TIMEKEEPERS': // clock
      g.lineStyle(4, c, 1);
      g.strokeCircle(cx, cy, s * 0.75);
      g.lineStyle(3, hi, 1);
      g.lineBetween(cx, cy, cx, cy - s * 0.5);
      g.lineBetween(cx, cy, cx + s * 0.4, cy + s * 0.1);
      g.fillStyle(hi, 1);
      g.fillCircle(cx, cy, s * 0.1);
      break;
    case 'CHRONOKNIGHTS': // shield
      g.fillStyle(c, 0.85);
      g.fillPoints(
        [p(cx, cy - s), p(cx + s * 0.7, cy - s * 0.5), p(cx + s * 0.7, cy + s * 0.2), p(cx, cy + s), p(cx - s * 0.7, cy + s * 0.2), p(cx - s * 0.7, cy - s * 0.5)],
        true,
      );
      g.lineStyle(3, hi, 0.9);
      g.lineBetween(cx, cy - s * 0.6, cx, cy + s * 0.6);
      g.lineBetween(cx - s * 0.4, cy - s * 0.1, cx + s * 0.4, cy - s * 0.1);
      break;
    case 'PULSEWALKERS': // pulse / heartbeat
      g.lineStyle(4, c, 1);
      g.strokePoints(
        [p(cx - s, cy), p(cx - s * 0.4, cy), p(cx - s * 0.15, cy - s * 0.7), p(cx + s * 0.15, cy + s * 0.7), p(cx + s * 0.4, cy), p(cx + s, cy)],
        false,
        false,
      );
      break;
    case 'VOID_REBELS': // inverted notched triangle
      g.fillStyle(c, 0.85);
      g.fillPoints([p(cx - s, cy - s * 0.7), p(cx + s, cy - s * 0.7), p(cx, cy + s)], true);
      g.fillStyle(darken(def.color, 0.2), 1);
      g.fillCircle(cx, cy - s * 0.25, s * 0.22);
      break;
    case 'NEON_PHARAOHS': // pyramid + eye
      g.fillStyle(c, 0.85);
      g.fillPoints([p(cx, cy - s), p(cx + s * 0.9, cy + s * 0.7), p(cx - s * 0.9, cy + s * 0.7)], true);
      g.fillStyle(darken(def.color, 0.25), 1);
      g.fillCircle(cx, cy + s * 0.15, s * 0.2);
      g.fillStyle(hi, 1);
      g.fillCircle(cx, cy + s * 0.15, s * 0.08);
      break;

    // Specials
    case 'WILD_CAPTAIN': // starburst
      star(g, cx, cy, 8, s * 1.05, s * 0.42, c);
      g.fillStyle(hi, 1);
      g.fillCircle(cx, cy, s * 0.22);
      break;
    case 'SCATTER': // portal swirl
      for (let i = 0; i < 3; i++) {
        g.lineStyle(4 - i, c, 0.9 - i * 0.22);
        g.strokeCircle(cx, cy, s * (0.4 + i * 0.27));
      }
      g.fillStyle(hi, 1);
      g.fillCircle(cx, cy, s * 0.16);
      break;
    case 'PAST_KEY':
      key(g, cx, cy, s, c, hi, -1);
      break;
    case 'FUTURE_KEY':
      key(g, cx, cy, s, c, hi, 1);
      break;
  }
}

// --- Primitive helpers -----------------------------------------------------

function p(x: number, y: number): Phaser.Geom.Point {
  return new Phaser.Geom.Point(x, y);
}

function diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, fill: boolean): void {
  const pts = [p(cx, cy - h / 2), p(cx + w / 2, cy), p(cx, cy + h / 2), p(cx - w / 2, cy)];
  if (fill) g.fillPoints(pts, true);
  else g.strokePoints(pts, true, true);
}

function cog(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, c: number, hi: number): void {
  const teeth = 8;
  g.fillStyle(c, 0.95);
  for (let i = 0; i < teeth; i++) {
    const a = (Math.PI * 2 * i) / teeth;
    g.fillCircle(cx + Math.cos(a) * s * 0.78, cy + Math.sin(a) * s * 0.78, s * 0.18);
  }
  g.fillCircle(cx, cy, s * 0.6);
  g.fillStyle(hi, 1);
  g.fillCircle(cx, cy, s * 0.24);
}

function star(g: Phaser.GameObjects.Graphics, cx: number, cy: number, points: number, outer: number, inner: number, color: number): void {
  const pts: Phaser.Geom.Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(p(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
  }
  g.fillStyle(color, 0.95);
  g.fillPoints(pts, true);
}

function key(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, c: number, hi: number, dir: number): void {
  // Bow (ring) on the left, shaft + teeth on the right, plus a direction arrow.
  g.lineStyle(5, c, 1);
  g.strokeCircle(cx - s * 0.5, cy, s * 0.4);
  g.lineStyle(5, c, 1);
  g.lineBetween(cx - s * 0.1, cy, cx + s, cy);
  g.lineBetween(cx + s * 0.6, cy, cx + s * 0.6, cy + s * 0.35);
  g.lineBetween(cx + s, cy, cx + s, cy + s * 0.35);
  // Direction arrow inside the bow (rewind vs forward).
  g.fillStyle(hi, 1);
  const ax = cx - s * 0.5;
  g.fillPoints(
    [p(ax + dir * s * 0.18, cy - s * 0.16), p(ax + dir * s * 0.18, cy + s * 0.16), p(ax - dir * s * 0.16, cy)],
    true,
  );
}

// --- Color math ------------------------------------------------------------

function lighten(color: number, amt: number): number {
  return mix(color, 0xffffff, amt);
}
function darken(color: number, amt: number): number {
  return mix(color, 0x000000, amt);
}
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}
