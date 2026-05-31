// Procedural audio via the Web Audio API.
//
// No audio files are bundled — every sound is synthesized at runtime with
// oscillators and noise + gain envelopes. This keeps the demo self-contained and
// offline-friendly. The four public hooks (spin/stop/win/bonus) are called by the
// scene; call initAudio() from a user gesture first so browsers allow playback.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

/** Create / resume the AudioContext. Must be invoked from a user gesture. */
export function initAudio(): void {
  if (typeof window === 'undefined') return;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.45;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master && ctx) {
    master.gain.setTargetAtTime(muted ? 0 : 0.45, ctx.currentTime, 0.02);
  }
}

export function isMuted(): boolean {
  return muted;
}

// --- Synthesis helpers -----------------------------------------------------

/** A single enveloped oscillator note. `at` is an offset from "now" in seconds. */
function note(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = 'triangle',
  vol = 0.5,
): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A short filtered-noise burst — used for whooshes and ticks. */
function noiseBurst(at: number, dur: number, from: number, to: number, vol = 0.3): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  filter.Q.value = 6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + dur * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// --- Public hooks ----------------------------------------------------------

export function spinSound(): void {
  initAudio();
  // Rising whoosh as the reels launch.
  noiseBurst(0, 0.4, 300, 1800, 0.25);
  note(220, 0, 0.18, 'sawtooth', 0.18);
}

export function stopSound(): void {
  initAudio();
  // Mechanical reel-stop thunk.
  note(160, 0, 0.09, 'square', 0.3);
  noiseBurst(0, 0.06, 1200, 400, 0.18);
}

export function winSound(): void {
  initAudio();
  // Bright ascending arpeggio (C E G C).
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => note(f, i * 0.08, 0.28, 'triangle', 0.4));
}

export function bonusSound(): void {
  initAudio();
  // Larger, celebratory rising run with a supporting fifth.
  const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((f, i) => {
    note(f, i * 0.1, 0.5, 'triangle', 0.4);
    note(f * 1.5, i * 0.1, 0.5, 'sine', 0.18);
  });
  noiseBurst(0, 0.5, 600, 4000, 0.2);
}

/** Escalating win fanfare keyed to the win tier (big < mega < epic). */
export function bigWinSound(tier: 'big' | 'mega' | 'epic'): void {
  initAudio();
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.5];
  const reps = tier === 'epic' ? 3 : tier === 'mega' ? 2 : 1;
  const step = 0.09;
  let i = 0;
  for (let r = 0; r < reps; r++) {
    for (const base of scale) {
      const f = base * (1 + r * 0.5); // climb an octave-ish each repeat
      note(f, i * step, 0.32, 'triangle', 0.42);
      note(f * 1.5, i * step, 0.32, 'sine', 0.16);
      i++;
    }
  }
  noiseBurst(0, 0.4 + reps * 0.15, 700, 5000, 0.18);
}
