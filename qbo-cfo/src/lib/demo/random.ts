/** Deterministic PRNG so demo data is identical on every machine and re-seed. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

export function jitter(rng: () => number, base: number, spread: number): number {
  return base * (1 + (rng() * 2 - 1) * spread);
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function roundTo(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
