// Lightweight persistence for the free-play demo.
//
// Stores fake-credit balance, bet level and mute flag in localStorage so they
// survive page reloads. All access is guarded + wrapped in try/catch so the game
// still runs where localStorage is unavailable (SSR, private mode, tests).

const KEY = 'chronoquest.save.v1';

export interface SaveData {
  credits: number;
  betIndex: number;
  muted: boolean;
}

export function loadSave(): SaveData | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (typeof d.credits !== 'number' || !Number.isFinite(d.credits)) return null;
    return {
      credits: Math.max(0, d.credits),
      betIndex: typeof d.betIndex === 'number' ? d.betIndex : 1,
      muted: Boolean(d.muted),
    };
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / availability errors — demo only */
  }
}

export function clearSave(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
