// Ambient sound and the phase chime, both synthesised with the Web Audio API (no audio files).
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

export type SceneId = "rain-cafe" | "night-library" | "forest-cabin" | "lofi-desk";

// Rain for the café, soft room tone for the rest. Returns a handle to set volume (0..1) or stop.
export function startAmbient(scene: SceneId, volume: number) {
  const c = audioCtx();
  if (!c) return null;
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);
  const sources: AudioBufferSourceNode[] = [];
  const layer = (kind: "white" | "brown", filters: BiquadFilterNode[], gain: number) => {
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
  };
  const filt = (type: BiquadFilterType, freq: number, q = 0.7) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };

  if (scene === "rain-cafe") {
    layer("white", [filt("highpass", 900), filt("lowpass", 7000)], 0.35);
    layer("brown", [filt("lowpass", 500)], 0.5);
  } else if (scene === "forest-cabin") {
    layer("brown", [filt("lowpass", 700)], 0.45);
    layer("white", [filt("bandpass", 1800, 0.5)], 0.06);
  } else {
    layer("brown", [filt("lowpass", scene === "night-library" ? 300 : 420)], 0.55);
  }
  master.gain.linearRampToValueAtTime(volume, c.currentTime + 1.2);
  return {
    setVolume: (v: number) => master.gain.setTargetAtTime(v, c.currentTime, 0.1),
    stop: () => {
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
