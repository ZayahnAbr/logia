"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Flag, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import type { Stream } from "@/app/discover-actions";
import { formatClock } from "@/lib/cafeClock";
import { ReportDialog } from "./ReportDialog";

const PRESETS = [{ f: 25, b: 5 }, { f: 50, b: 10 }];

// Personal pomodoro to run beside a video. Announces only when a phase ends, not every second.
function MiniTimer() {
  const [preset, setPreset] = useState(0);
  const [phase, setPhase] = useState<"focus" | "break">("focus");
  const [left, setLeft] = useState(PRESETS[0].f * 60);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (left > 0) return;
    const next = phaseRef.current === "focus" ? "break" : "focus";
    setPhase(next);
    setLeft((next === "focus" ? PRESETS[preset].f : PRESETS[preset].b) * 60);
    setMsg(next === "break" ? "Focus finished. Take a break." : "Break finished. Back to focus.");
  }, [left, preset]);

  const reset = (p = preset) => { setRunning(false); setPhase("focus"); setLeft(PRESETS[p].f * 60); setMsg(""); };

  return (
    <div className="card dc-timer">
      <div className="eyebrow">{phase === "focus" ? "Focus" : "Break"}</div>
      <div className="dc-timer-num" role="timer" aria-label={`${formatClock(left)} left`}>{formatClock(left)}</div>
      <div className="dc-timer-btns">
        <button type="button" className="btn btn-primary" onClick={() => setRunning((r) => !r)}>
          {running ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {running ? "Pause" : "Start"}
        </button>
        <button type="button" className="btn btn-icon" onClick={() => reset()} aria-label="Reset timer"><RotateCcw size={15} aria-hidden="true" /></button>
      </div>
      <fieldset className="dc-presets">
        <legend className="field-label">Length</legend>
        {PRESETS.map((p, i) => (
          <label key={i} className={preset === i ? "on" : ""}>
            <input type="radio" name="preset" className="sr-only" checked={preset === i} onChange={() => { setPreset(i); reset(i); }} />
            {p.f} / {p.b}
          </label>
        ))}
      </fieldset>
      <p className="sr-only" role="status">{msg}</p>
    </div>
  );
}

export function StreamsTab({ streams }: { streams: Stream[] }) {
  const [open, setOpen] = useState<Stream | null>(null);
  const [reporting, setReporting] = useState(false);

  if (open) {
    return (
      <div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(null)}><ArrowLeft size={14} aria-hidden="true" /> All streams</button>
        <div className="dc-player-wrap">
          <div>
            <div className="dc-player">
              <iframe title={open.title} src={`https://www.youtube-nocookie.com/embed/${open.youtube_id}?rel=0&autoplay=1`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>
            <div className="card dc-about">
              <h2 className="dc-name">{open.title}</h2>
              <div className="dc-sub">{open.channel}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReporting(true)}><Flag size={14} aria-hidden="true" /> Report a problem</button>
            </div>
          </div>
          <MiniTimer />
        </div>
        {reporting && <ReportDialog kind="stream" targetId={open.id} onClose={() => setReporting(false)} />}
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="empty card" style={{ padding: "32px 20px" }}>
        <ShieldCheck size={28} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
        <p style={{ margin: "10px auto 0", maxWidth: 440 }}>
          No streams yet. Study-with-me videos on Logia are hand-picked by our team, so what you see here is safe and on topic.
          There are no webcams and no uploads.
        </p>
      </div>
    );
  }

  return (
    <ul className="dc-grid dc-streams" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {streams.map((s) => (
        <li key={s.id}>
          <button type="button" className="card dc-card dc-stream" onClick={() => setOpen(s)} aria-label={`Watch ${s.title}${s.kind === "live" ? " (live)" : ""}`}>
            <span className="dc-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${s.youtube_id}/hqdefault.jpg`} alt="" loading="lazy" />
              {s.kind === "live" && <span className="dc-live"><span className="live-dot" aria-hidden="true" /> LIVE</span>}
            </span>
            <span className="dc-body">
              <span className="dc-name">{s.title}</span>
              <span className="dc-sub">{s.channel}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
