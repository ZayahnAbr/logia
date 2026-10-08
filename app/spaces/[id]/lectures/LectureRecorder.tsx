"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, X } from "lucide-react";
import { toast } from "@/components/Toaster";

// Records a lecture in the browser. Keeps the screen awake, shows a live level meter,
// supports pause/resume, and warns before leaving mid-recording. Hands back a File.
const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

export function LectureRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const raf = useRef(0);
  const tick = useRef<number | undefined>(undefined);
  const discard = useRef(false);

  const cleanup = () => {
    cancelAnimationFrame(raf.current);
    window.clearInterval(tick.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    wake.current?.release().catch(() => {});
    wake.current = null;
    setLevel(0);
  };
  useEffect(() => () => cleanup(), []);

  // Leaving the page would lose the recording.
  useEffect(() => {
    if (state === "idle") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast("Recording isn't supported in this browser. Upload a recording instead.", "error"); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      toast("Microphone access was blocked. Allow it in your browser's site settings, then try again.", "error");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 48000 });
    chunks.current = [];
    discard.current = false;
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const mime = r.mimeType || type || "audio/webm";
      const blob = new Blob(chunks.current, { type: mime });
      cleanup();
      setState("idle");
      if (discard.current || blob.size < 2000) return;
      const ext = mime.includes("mp4") ? "m4a" : "webm";
      const stamp = new Date().toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      onRecorded(new File([blob], `Lecture ${stamp}.${ext}`, { type: mime }));
    };
    r.start(10_000); // flush every 10s so a long recording isn't held in one buffer
    rec.current = r;
    setSecs(0);
    setState("recording");
    tick.current = window.setInterval(() => setSecs((s) => (rec.current?.state === "recording" ? s + 1 : s)), 1000);

    // Live input level, so it's obvious the mic is picking up sound.
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream.current).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf.current = requestAnimationFrame(loop);
    };
    loop();

    try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not supported */ }
  };

  const pause = () => { rec.current?.pause(); setState("paused"); };
  const resume = () => { rec.current?.resume(); setState("recording"); };
  const stop = () => rec.current?.stop();
  const cancel = () => {
    if (secs > 30 && !window.confirm("Discard this recording? It hasn't been saved.")) return;
    discard.current = true;
    rec.current?.stop();
  };

  if (state === "idle") {
    return (
      <button type="button" className="btn" onClick={start} disabled={disabled} style={{ height: 42 }}>
        <span className="rec-dot" aria-hidden="true" /> Record
      </button>
    );
  }

  return (
    <div className="rec-bar" role="group" aria-label="Recording">
      <span className={`rec-dot${state === "recording" ? " live" : ""}`} aria-hidden="true" />
      <span className="rec-time" aria-live="off">{fmt(secs)}</span>
      <span className="rec-meter" aria-hidden="true"><i style={{ transform: `scaleX(${state === "recording" ? Math.max(0.04, level) : 0.04})` }} /></span>
      <span className="sr-only" role="status">{state === "recording" ? "Recording" : "Paused"}</span>
      {state === "recording"
        ? <button type="button" className="btn btn-sm" onClick={pause}><Pause size={14} aria-hidden="true" /> Pause</button>
        : <button type="button" className="btn btn-sm" onClick={resume}><Play size={14} aria-hidden="true" /> Resume</button>}
      <button type="button" className="btn btn-sm btn-primary" onClick={stop}><Square size={13} aria-hidden="true" /> Stop &amp; save</button>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={cancel} aria-label="Discard recording"><X size={14} /></button>
      <span className="rec-hint"><Mic size={12} aria-hidden="true" /> Keep this tab open while recording</span>
    </div>
  );
}
