// Ambient sound and the phase chime, both synthesised with the Web Audio API (no audio files).
import type { LoopSceneId } from "@/lib/loopScenes";

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, kind: "white" | "brown") {
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "white") d[i] = w;
    else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return buf;
}

export type SceneId = LoopSceneId;

// Synthesised ambience per scene (no audio files):
//   rain-roof: steady rain on a roof; rainforest: softer, wider rain with a low rumble
//   fireside: low fire hum plus random crackle pops
//   seaside: filtered noise that swells and fades like waves (a slow volume cycle, not recorded surf)
//   snowy-forest and morning-mist: quiet wind (slowly moving band of noise)
// Returns a handle to set volume (0..1) or stop.
export function startAmbient(scene: SceneId, volume: number) {
  const c = audioCtx();
  if (!c) return null;
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);
  const sources: AudioScheduledSourceNode[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  // lfo: slow volume cycle (Hz and depth as a fraction of the base gain)
  const layer = (kind: "white" | "brown", filters: BiquadFilterNode[], gain: number, lfo?: { hz: number; depth: number }) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, kind);
    src.loop = true;
    const g = c.createGain();
    g.gain.value = gain;
    let node: AudioNode = src;
    for (const f of filters) { node.connect(f); node = f; }
    node.connect(g);
    g.connect(master);
    src.start();
    sources.push(src);
    if (lfo) {
      const o = c.createOscillator();
      o.frequency.value = lfo.hz;
      const d = c.createGain();
      d.gain.value = gain * lfo.depth;
      o.connect(d); d.connect(g.gain);
      o.start();
      sources.push(o);
    }
  };
  const filt = (type: BiquadFilterType, freq: number, q = 0.7) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };

  if (scene === "rain-roof") {
    layer("white", [filt("highpass", 900), filt("lowpass", 7000)], 0.35);
    layer("brown", [filt("lowpass", 500)], 0.5);
  } else if (scene === "rainforest") {
    layer("white", [filt("highpass", 600), filt("lowpass", 5000)], 0.3, { hz: 0.07, depth: 0.25 });
    layer("brown", [filt("lowpass", 400)], 0.45);
  } else if (scene === "fireside") {
    layer("brown", [filt("lowpass", 260)], 0.5, { hz: 0.23, depth: 0.2 });
    const pops = noiseBuffer(c, "white");
    const crackle = () => {
      if (stopped) return;
      const s = c.createBufferSource();
      s.buffer = pops;
      const hp = filt("highpass", 1200 + Math.random() * 2500);
      const g = c.createGain();
      const t = c.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.2, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.06);
      s.connect(hp); hp.connect(g); g.connect(master);
      s.start(t, Math.random() * 2, 0.12);
      timers.push(setTimeout(crackle, 60 + Math.random() * 520));
    };
    crackle();
  } else if (scene === "seaside") {
    // Two swells at slightly different speeds so the pattern does not repeat exactly.
    layer("white", [filt("lowpass", 1400), filt("highpass", 120)], 0.3, { hz: 0.11, depth: 0.9 });
    layer("brown", [filt("lowpass", 500)], 0.3, { hz: 0.083, depth: 0.8 });
  } else if (scene === "forest-stream") {
    // Water over stones: bright, steady noise with a gentle low bed.
    layer("white", [filt("bandpass", 1800, 0.5), filt("highpass", 500)], 0.2, { hz: 0.13, depth: 0.25 });
    layer("brown", [filt("lowpass", 300)], 0.3);
  } else {
    // snowy-forest, morning-mist and conifer-forest: quiet wind
    layer("white", [filt("bandpass", scene === "snowy-forest" ? 450 : 650, 0.6)], 0.22, { hz: 0.06, depth: 0.5 });
    layer("brown", [filt("lowpass", 220)], 0.35);
  }
  master.gain.linearRampToValueAtTime(volume, c.currentTime + 1.2);
  return {
    setVolume: (v: number) => master.gain.setTargetAtTime(v, c.currentTime, 0.1),
    stop: () => {
      stopped = true;
      timers.forEach(clearTimeout);
      master.gain.setTargetAtTime(0, c.currentTime, 0.2);
      setTimeout(() => { sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); master.disconnect(); }, 800);
    },
  };
}

// Two soft bell notes; rises when focus starts, falls when the break starts.
export function chime(toBreak: boolean) {
  const c = audioCtx();
  if (!c) return;
  const notes = toBreak ? [784, 659] : [523, 659];
  notes.forEach((f, i) => {
    const t = c.currentTime + i * 0.28;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 1.5);
  });
}
