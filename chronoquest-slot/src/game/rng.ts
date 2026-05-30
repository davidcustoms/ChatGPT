// RNG wrapper.
//
// For this free-play demo we wrap Math.random behind a small interface so it
// can later be swapped for a certified/server RNG without touching the engine.
// A deterministic seeded generator (mulberry32) is also provided — it is used
// by unit tests and can be handy for reproducible demos.

export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number;
}

/** Default RNG backed by Math.random (non-deterministic). */
export class DefaultRng implements Rng {
  next(): number {
    return Math.random();
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/** Deterministic seeded RNG (mulberry32). Great for reproducible tests/demos. */
export class SeededRng implements Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid a zero state which would stick the generator.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/** Convenience singleton used by the live game. */
export const defaultRng = new DefaultRng();
