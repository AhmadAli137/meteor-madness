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
const VOL_KEY = "mm-volume";
// headroom multiplier — the compressor below keeps loud moments from clipping
const MASTER_SCALE = 2.4;

export function soundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LS_KEY) === "on";
}

export function getVolume(): number {
  if (typeof window === "undefined") return 0.8;
  const v = Number(window.localStorage.getItem(VOL_KEY));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.8;
}

export function setVolume(v: number) {
  if (typeof window === "undefined") return;
  const vol = Math.max(0, Math.min(1, v));
  window.localStorage.setItem(VOL_KEY, String(vol));
  if (master && ctx) {
    master.gain.setTargetAtTime(vol * MASTER_SCALE, ctx.currentTime, 0.05);
  }
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
    master.gain.value = getVolume() * MASTER_SCALE;
    // soft-knee limiter so the boosted master never clips
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;
    master.connect(comp);
    comp.connect(ctx.destination);
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
    pulse?: { hz: number; depth: number }; // rhythmic gain throb (drama)
  }
> = {
  // warm, wide home pad — A minor feel
  home: { root: 55, intervals: [1, 1.5, 2, 2.4], filterHz: 420, lfoHz: 0.05, gain: 0.08 },
  // airy, bright observatory shimmer
  observatory: { root: 82.4, intervals: [1, 2, 3, 4.05], filterHz: 900, lfoHz: 0.08, gain: 0.06, noise: 0.01 },
  // impactor lab — dark minor tension with an ominous throb
  impact: {
    root: 46.2,
    intervals: [1, 1.189, 1.498, 2, 2.378],
    filterHz: 340,
    lfoHz: 0.07,
    gain: 0.115,
    pulse: { hz: 1.15, depth: 0.55 },
  },
  // impact site — tense low drone
  globe: { root: 41.2, intervals: [1, 1.189, 2, 2.378], filterHz: 260, lfoHz: 0.03, gain: 0.11 },
  // deflection — heroic open fifth with a marching pulse
  deflection: {
    root: 65.4,
    intervals: [0.5, 1, 1.5, 2, 2.52, 3],
    filterHz: 620,
    lfoHz: 0.06,
    gain: 0.1,
    pulse: { hz: 0.85, depth: 0.4 },
  },
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

  // rhythmic throb for the dramatic themes
  if (cfg.pulse) {
    const p = c.createOscillator();
    p.type = "sine";
    p.frequency.value = cfg.pulse.hz;
    const pg = c.createGain();
    pg.gain.value = (cfg.gain * cfg.pulse.depth) / 2;
    p.connect(pg);
    pg.connect(bus.gain);
    p.start();
    nodes.push(p);
  }

  // gentle fade in (to the pulse midpoint when throbbing)
  const target = cfg.pulse
    ? cfg.gain * (1 - cfg.pulse.depth / 2)
    : cfg.gain;
  bus.gain.linearRampToValueAtTime(target, c.currentTime + 2.5);

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
  sg.gain.setValueAtTime(1.1 * intensity, t0);
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
  ng.gain.setValueAtTime(0.75 * intensity, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 2.8);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(master);
  noise.start(t0);
}

/** Victory fanfare: rising major arpeggio with a shimmering tail. */
export function sfxFanfare() {
  if (!soundEnabled()) return;
  const c = ensureCtx();
  if (!c || !master || c.state === "suspended") return;
  const out = master;
  const t0 = c.currentTime;
  const NOTES = [261.63, 329.63, 392.0, 523.25]; // C E G C
  NOTES.forEach((f, i) => {
    const at = t0 + i * 0.16;
    const dur = i === NOTES.length - 1 ? 1.8 : 0.5;
    for (const mult of [1, 2]) {
      const o = c.createOscillator();
      o.type = mult === 1 ? "triangle" : "sine";
      o.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(mult === 1 ? 0.35 : 0.12, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g);
      g.connect(out);
      o.start(at);
      o.stop(at + dur + 0.1);
    }
  });
  // sparkle
  const noise = noiseBurst(c, 1.6);
  const hf = c.createBiquadFilter();
  hf.type = "highpass";
  hf.frequency.value = 6000;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t0 + 0.45);
  ng.gain.exponentialRampToValueAtTime(0.12, t0 + 0.6);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 2);
  noise.connect(hf);
  hf.connect(ng);
  ng.connect(master);
  noise.start(t0 + 0.45);
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
  g.gain.exponentialRampToValueAtTime(0.5, t0 + seconds * 0.75);
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
  g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.9);
  noise.connect(f);
  f.connect(g);
  g.connect(master);
  noise.start(t0);
}
