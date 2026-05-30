// Symbol catalogue + presentation metadata.
//
// Art is intentionally placeholder-only for v1: each symbol renders as a glowing
// rounded card built from Phaser graphics, using the colors/labels declared here.
// Swap `label`/`color` (or wire up real textures) without touching the engine.

import type { SymbolId } from './types';

export type SymbolCategory = 'low' | 'mid' | 'premium' | 'special';

export interface SymbolDef {
  id: SymbolId;
  /** Short label drawn on the placeholder card. */
  label: string;
  /** Full display name for messages / paytable. */
  name: string;
  category: SymbolCategory;
  /** Fill color for the placeholder card (0xRRGGBB). */
  color: number;
  /** Border / glow color. */
  glow: number;
}

export const SYMBOLS: Record<SymbolId, SymbolDef> = {
  // --- Low symbols ---
  TEN: { id: 'TEN', label: '10', name: '10', category: 'low', color: 0x1e2a4a, glow: 0x4a6fff },
  J: { id: 'J', label: 'J', name: 'Jack', category: 'low', color: 0x1e2a4a, glow: 0x4a6fff },
  Q: { id: 'Q', label: 'Q', name: 'Queen', category: 'low', color: 0x24234a, glow: 0x6a4aff },
  K: { id: 'K', label: 'K', name: 'King', category: 'low', color: 0x24234a, glow: 0x6a4aff },
  A: { id: 'A', label: 'A', name: 'Ace', category: 'low', color: 0x2a1e4a, glow: 0x8a4aff },

  // --- Mid symbols ---
  GEAR: { id: 'GEAR', label: 'GEAR', name: 'Chrono Gear', category: 'mid', color: 0x0e3a3a, glow: 0x18d0c8 },
  CRYSTAL: { id: 'CRYSTAL', label: 'CRYST', name: 'Time Crystal', category: 'mid', color: 0x103a52, glow: 0x32c8ff },
  REACTOR: { id: 'REACTOR', label: 'RACTR', name: 'Reactor Core', category: 'mid', color: 0x0e2a4a, glow: 0x3ad0ff },
  PORTAL_SHARD: { id: 'PORTAL_SHARD', label: 'SHARD', name: 'Portal Shard', category: 'mid', color: 0x2a0e4a, glow: 0xb24aff },

  // --- Premium team symbols ---
  TIMEKEEPERS: { id: 'TIMEKEEPERS', label: 'TKPR', name: 'Timekeepers', category: 'premium', color: 0x3a2a08, glow: 0xffcc33 },
  CHRONOKNIGHTS: { id: 'CHRONOKNIGHTS', label: 'CHRNK', name: 'ChronoKnights', category: 'premium', color: 0x3a1010, glow: 0xff5a4a },
  PULSEWALKERS: { id: 'PULSEWALKERS', label: 'PULSE', name: 'Pulsewalkers', category: 'premium', color: 0x103a1e, glow: 0x4aff8a },
  VOID_REBELS: { id: 'VOID_REBELS', label: 'VOID', name: 'Void Rebels', category: 'premium', color: 0x24083a, glow: 0xc24aff },
  NEON_PHARAOHS: { id: 'NEON_PHARAOHS', label: 'PHRAO', name: 'Neon Pharaohs', category: 'premium', color: 0x3a3008, glow: 0xffe24a },

  // --- Special symbols ---
  WILD_CAPTAIN: { id: 'WILD_CAPTAIN', label: 'WILD', name: 'Wild Captain', category: 'special', color: 0x5a0e3a, glow: 0xff2fb0 },
  SCATTER: { id: 'SCATTER', label: 'PORTAL', name: 'Time Portal Scatter', category: 'special', color: 0x0e1a5a, glow: 0x4affff },
  PAST_KEY: { id: 'PAST_KEY', label: 'PAST', name: 'Past Key', category: 'special', color: 0x3a2008, glow: 0xffa83a },
  FUTURE_KEY: { id: 'FUTURE_KEY', label: 'FUTR', name: 'Future Key', category: 'special', color: 0x082a3a, glow: 0x3affd8 },
};

/** The wild symbol substitutes for these regular paying symbols. */
export const WILD_ID: SymbolId = 'WILD_CAPTAIN';
export const SCATTER_ID: SymbolId = 'SCATTER';
export const PAST_KEY_ID: SymbolId = 'PAST_KEY';
export const FUTURE_KEY_ID: SymbolId = 'FUTURE_KEY';

/** Symbols that pay via ways-to-win (low + mid + premium). Specials never pay as lines. */
export const PAYING_SYMBOLS: SymbolId[] = [
  'TEN', 'J', 'Q', 'K', 'A',
  'GEAR', 'CRYSTAL', 'REACTOR', 'PORTAL_SHARD',
  'TIMEKEEPERS', 'CHRONOKNIGHTS', 'PULSEWALKERS', 'VOID_REBELS', 'NEON_PHARAOHS',
];

export function isSpecial(id: SymbolId): boolean {
  return SYMBOLS[id].category === 'special';
}
