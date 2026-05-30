// Placeholder sound hooks.
//
// No audio assets are bundled for v1. These functions are safe no-ops (with a
// debug log) so the rest of the game can call them today and we can wire real
// audio in later by filling in the bodies — without changing call sites.

const DEBUG_SOUND = false;

function play(name: string): void {
  if (DEBUG_SOUND) {
    // eslint-disable-next-line no-console
    console.debug(`[sound] ${name}`);
  }
}

export function spinSound(): void {
  play('spin');
}

export function stopSound(): void {
  play('reel-stop');
}

export function winSound(): void {
  play('win');
}

export function bonusSound(): void {
  play('bonus');
}
