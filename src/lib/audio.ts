"use client";

/**
 * Tiny Web Audio engine — everything is synthesized (no audio assets).
 *
 * - Per-page ambient "themes": layered detuned oscillators through a slowly
 *   modulated lowpass filter (classic space-pad), each page with its own
 *   root note and character.
 * - One-shot SFX: meteor whoosh, impact boom, rocket launch.
 * - Autoplay policy: nothing sounds until the user enables sound (persisted
 *   in localStorage); a one-time pointer listener resumes the context after
 *   navigation.
 */

type Theme = "home" | "observatory" | "impact" | "globe" | "deflection";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { stop: () => void; theme: Theme } | null = null;
let pendingTheme: Theme | null = null;

const LS_KEY = "mm-sound";

export function soundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LS_KEY) === "on";
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Resume audio after navigation on the first user gesture. */
function armGestureResume() {
  if (typeof window === "undefined") return;
  const onDown = () => {
    if (!soundEnabled()) return;
    ensureCtx();
    if (pendingTheme) {
      const t = pendingTheme;
      pendingTheme = null;
      startAmbient(t);
    }
  };
  window.addEventListener("pointerdown", onDown, { once: true });
}

export function setSoundEnabled(on: boolean, theme?: Theme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, on ? "on" : "off");
  if (on) {
    ensureCtx();
    if (theme) startAmbient(theme);
  } else {
    stopAmbient();
  }
}

export function stopAmbient() {
  ambient?.stop();
  ambient = null;
}

/** Theme configs: root frequency (Hz), intervals, filter, extra character */
const THEMES: Record<
  Theme,
  {
    root: number;
    intervals: number[];
    filterHz: number;
    lfoHz: number;
    gain: number;
    noise?: number; // optional airy-noise layer gain
  }
> = {
  // warm, wide home pad — A minor feel
  home: { root: 55, intervals: [1, 1.5, 2, 2.4], filterHz: 420, lfoHz: 0.05, gain: 0.045 },
  // airy, bright observatory shimmer
  observatory: { root: 82.4, intervals: [1, 2, 3, 4.05], filterHz: 900, lfoHz: 0.08, gain: 0.035, noise: 0.006 },
  // impactor lab — dark, focused
  impact: { root: 49, intervals: [1, 1.498, 2.997], filterHz: 300, lfoHz: 0.04, gain: 0.05 },
  // impact site — tense low drone
  globe: { root: 41.2, intervals: [1, 1.189, 2, 2.378], filterHz: 260, lfoHz: 0.03, gain: 0.055 },
  // deflection — hopeful open fifth
  deflection: { root: 65.4, intervals: [1, 1.5, 2, 3], filterHz: 520, lfoHz: 0.06, gain: 0.045 },
};

export function startAmbient(theme: Theme) {
  if (!soundEnabled()) return;
  const c = ensureCtx();
  if (!c || !master) return;
  if (c.state === "suspended") {
    // no gesture yet on this page — start when the user first interacts
    pendingTheme = theme;
    armGestureResume();
    return;
  }
  if (ambient?.theme === theme) return;
  stopAmbient();

  const cfg = THEMES[theme];
  const bus = c.createGain();
  bus.gain.value = 0;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cfg.filterHz;
  filter.Q.value = 0.8;
  filter.connect(bus);
  bus.connect(master);

  const nodes: (OscillatorNode | AudioBufferSourceNode | OscillatorNode)[] =
    [];

  // slow filter sweep gives the pad its "breathing"
  const lfo = c.createOscillator();
  lfo.frequency.value = cfg.lfoHz;
  const lfoGain = c.createGain();
  lfoGain.gain.value = cfg.filterHz * 0.45;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();
  nodes.push(lfo);

  for (const iv of cfg.intervals) {
    for (const detune of [-4, 4]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = cfg.root * iv;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = 1 / (cfg.intervals.length * 2);
      o.connect(g);
      g.connect(filter);
      o.start();
      nodes.push(o);
    }
  }

  if (cfg.noise) {
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const ng = c.createGain();
    ng.gain.value = cfg.noise / cfg.gain;
    const nf = c.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 2400;
    nf.Q.value = 0.4;
    src.connect(nf);
    nf.connect(ng);
    ng.connect(bus);
    src.start();
    nodes.push(src);
  }

  // gentle fade in
  bus.gain.linearRampToValueAtTime(cfg.gain, c.currentTime + 2.5);

  ambient = {
    theme,
    stop: () => {
      try {
        bus.gain.cancelScheduledValues(c.currentTime);
        bus.gain.setValueAtTime(bus.gain.value, c.currentTime);
        bus.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
        window.setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {}
          }
          try {
            bus.disconnect();
          } catch {}
        }, 900);
      } catch {}
    },
  };
}

function noiseBurst(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Deep impact boom: sub-bass thump + rumbling noise tail. */
export function sfxBoom(intensity = 1) {
  if (!soundEnabled()) return;
  const c = ensureCtx();
  if (!c || !master || c.state === "suspended") return;
  const t0 = c.currentTime;

  // sub thump
  const sub = c.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(120, t0);
  sub.frequency.exponentialRampToValueAtTime(24, t0 + 1.2);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.9 * intensity, t0);
  sg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
  sub.connect(sg);
  sg.connect(master);
  sub.start(t0);
  sub.stop(t0 + 1.7);

  // rumble tail
  const noise = noiseBurst(c, 3);
  const nf = c.createBiquadFilter();
  nf.type = "lowpass";
  nf.frequency.setValueAtTime(900, t0);
  nf.frequency.exponentialRampToValueAtTime(60, t0 + 2.6);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.55 * intensity, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 2.8);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(master);
  noise.start(t0);
}

/** Meteor whoosh: bandpass noise sweeping down as it tears in. */
export function sfxWhoosh(seconds = 1.8) {
  if (!soundEnabled()) return;
  const c = ensureCtx();
  if (!c || !master || c.state === "suspended") return;
  const t0 = c.currentTime;
  const noise = noiseBurst(c, seconds + 0.2);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.1;
  f.frequency.setValueAtTime(300, t0);
  f.frequency.exponentialRampToValueAtTime(2600, t0 + seconds * 0.7);
  f.frequency.exponentialRampToValueAtTime(500, t0 + seconds);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.35, t0 + seconds * 0.75);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
  noise.connect(f);
  f.connect(g);
  g.connect(master);
  noise.start(t0);
}

/** Rocket launch: filtered noise swelling upward. */
export function sfxLaunch() {
  if (!soundEnabled()) return;
  const c = ensureCtx();
  if (!c || !master || c.state === "suspended") return;
  const t0 = c.currentTime;
  const noise = noiseBurst(c, 2);
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(200, t0);
  f.frequency.exponentialRampToValueAtTime(1800, t0 + 1.2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.9);
  noise.connect(f);
  f.connect(g);
  g.connect(master);
  noise.start(t0);
}
