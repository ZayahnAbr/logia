"use client";

import { useEffect, useRef, useState } from "react";
import { Timer, Play, Pause, RotateCcw } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { logFocusSession } from "@/app/actions";

const PRESETS = [
  { label: "25 / 5", focusMin: 25, breakMin: 5 },
  { label: "50 / 10", focusMin: 50, breakMin: 10 },
];

export function FocusTimer({ spaceId, onClose }: { spaceId?: string; onClose: () => void }) {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [phase, setPhase] = useState<"focus" | "break">("focus");
  const [secondsLeft, setSecondsLeft] = useState(PRESETS[0].focusMin * 60);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          const finishedFocus = phase === "focus";
          if (finishedFocus && spaceId) logFocusSession(spaceId, preset.focusMin, null);
          const nextPhase = finishedFocus ? "break" : "focus";
          setPhase(nextPhase);
          setRunning(false);
          return (nextPhase === "break" ? preset.breakMin : preset.focusMin) * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, phase, preset, spaceId]);

  const applyPreset = (p: typeof PRESETS[number]) => {
    setPreset(p);
    setPhase("focus");
    setRunning(false);
    setSecondsLeft(p.focusMin * 60);
  };

  const reset = () => { setRunning(false); setPhase("focus"); setSecondsLeft(preset.focusMin * 60); };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const justFinishedFocus = !running && phase === "break" && secondsLeft === preset.breakMin * 60;

  return (
    <Dialog title="Focus timer" onClose={onClose} width={360}>
      <div style={{ textAlign: "center" }}>
        <Timer size={22} aria-hidden="true" style={{ color: "var(--accent-text)", margin: "8px auto 10px", display: "block" }} />
        <div aria-live="polite" style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
          {phase === "focus" ? "Focus session" : "Break"}
        </div>
        <div role="timer" aria-label={`${mm} minutes ${ss} seconds remaining`} style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 16, fontVariantNumeric: "tabular-nums" }}>{mm}:{ss}</div>

        <div role="group" aria-label="Session length" style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" aria-pressed={preset.label === p.label}
              className="btn btn-sm"
              style={{ background: preset.label === p.label ? "var(--accent-soft)" : "transparent", color: preset.label === p.label ? "var(--accent-text)" : "var(--muted)", boxShadow: "none" }}
              onClick={() => applyPreset(p)}>
              {p.label} min
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={() => setRunning((r) => !r)} style={{ minWidth: 104, justifyContent: "center" }}>
            {running ? <><Pause size={14} aria-hidden="true" /> Pause</> : <><Play size={14} aria-hidden="true" /> Start</>}
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={reset} aria-label="Reset timer"><RotateCcw size={16} /></button>
        </div>

        {justFinishedFocus && (
          <div role="status" className="notice notice-success" style={{ marginTop: 16, textAlign: "left" }}>
            Nice work. Take your break, then review the cards due in this space.
          </div>
        )}
        {!spaceId && (
          <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
            Open a space to log this session against it.
          </div>
        )}
      </div>
    </Dialog>
  );
}
