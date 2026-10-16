"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Keyboard, PenLine, Loader2, Check, Triangle, X, RotateCcw, Eye, EyeOff, Eraser, AlertCircle } from "lucide-react";
import { transcribeAnswer, readHandwriting, checkRecall, type RecallResult } from "@/app/flashcard-actions";
import type { Card } from "@/lib/types";

type Mode = "speak" | "type" | "write";
const VERDICT = {
  strong:  { label: "Strong recall",  color: "var(--success)", bg: "var(--success-soft)" },
  partial: { label: "Partial recall", color: "var(--warning)", bg: "var(--warning-soft)" },
  weak:    { label: "Weak recall",    color: "var(--danger)",  bg: "var(--danger-soft)" },
} as const;

// ── Handwriting pad ──────────────────────────────────────────────────────────
function DrawPad({ onRead, busy }: { onRead: (dataUrl: string) => void; busy: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = ref.current!; const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.5; ctx.strokeStyle = "#18181b";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  }, []);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); setHasInk(false); };

  return (
    <div>
      <canvas ref={ref} aria-label="Handwriting area. Draw your answer with a mouse, finger or stylus"
        style={{ width: "100%", height: 220, borderRadius: "var(--r-md)", background: "#fff", boxShadow: "inset 0 0 0 1px var(--border-input)", touchAction: "none", cursor: "crosshair", display: "block" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke(); setHasInk(true); }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerCancel={() => { drawing.current = false; }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={() => onRead(ref.current!.toDataURL("image/png"))} disabled={!hasInk || busy} aria-busy={busy}>
          {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Reading…</> : <><PenLine size={14} aria-hidden="true" /> Read my writing</>}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!hasInk || busy}><Eraser size={14} aria-hidden="true" /> Clear</button>
      </div>
    </div>
  );
}

// ── Hold-to-speak ────────────────────────────────────────────────────────────
function HoldToSpeak({ onAudio, busy }: { onAudio: (blob: Blob) => void; busy: boolean }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  const start = async () => {
    if (recording || busy) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2000) { setError("That was too short. Hold the button the whole time you speak."); return; }
        onAudio(blob);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError("Couldn't use the microphone. Allow microphone access in your browser, or type your answer instead.");
    }
  };
  const stop = () => { if (!recording) return; recorder.current?.stop(); recorder.current = null; setRecording(false); };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0" }}>
      <button type="button" aria-pressed={recording} disabled={busy}
        onPointerDown={(e) => { e.preventDefault(); start(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); stop(); } }}
        className="recall-mic" data-recording={recording || undefined}>
        {busy ? <Loader2 size={26} className="spin" aria-hidden="true" /> : <Mic size={26} aria-hidden="true" />}
        <span className="sr-only">Hold to answer</span>
      </button>
      <div aria-live="polite" style={{ fontSize: 14, fontWeight: 600, color: recording ? "var(--danger)" : "var(--muted)" }}>
        {busy ? "Transcribing…" : recording ? `Listening… ${seconds}s · release to finish` : "Hold to answer"}
      </div>
      {error && <p role="alert" className="field-error" style={{ margin: 0, textAlign: "center" }}>{error}</p>}
    </div>
  );
}

// ── Answer + recall check ────────────────────────────────────────────────────
export function RecallAnswer({ spaceId, deckId, card, onResult }: {
  spaceId: string; deckId: string; card: Card; onResult: (r: RecallResult | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("speak");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<null | "transcribing" | "reading" | "checking">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecallResult | null>(null);
  const [showFull, setShowFull] = useState(false);

  const appendText = (t: string) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t));

  const onAudio = async (blob: Blob) => {
    setStage("transcribing"); setError(null);
    const form = new FormData(); form.append("audio", blob);
    const res = await transcribeAnswer(form);
    setStage(null);
    if ("error" in res && res.error) setError(res.error); else if (res.text) appendText(res.text);
  };
  const onWriting = async (dataUrl: string) => {
    setStage("reading"); setError(null);
    const res = await readHandwriting(dataUrl);
    setStage(null);
    if ("error" in res && res.error) setError(res.error); else if (res.text) appendText(res.text);
  };
  const check = async () => {
    setStage("checking"); setError(null);
    // Spoken answers come from a transcript, so spelling isn't held against them; typed and handwritten are.
    const res = await checkRecall(spaceId, deckId, card.id, text, mode === "speak" ? "spoken" : mode === "write" ? "handwritten" : "typed");
    setStage(null);
    if ("error" in res && res.error) { setError(res.error); return; }
    if (res.result) { setResult(res.result); onResult(res.result); }
  };
  const retry = () => { setResult(null); setText(""); setShowFull(false); setError(null); onResult(null); };

  if (result) {
    const v = VERDICT[result.verdict];
    return (
      <section className="recall-result" aria-labelledby="recall-heading" aria-live="polite" style={{ ["--v" as string]: v.color }}>
        <div className="rc-head">
          <h2 id="recall-heading" className="rc-verdict"><span className="rc-dot" aria-hidden="true" /> {v.label}</h2>
          <span className="rc-score"><b>{result.score}%</b> aligned</span>
        </div>
        <div className="rc-meter" role="meter" aria-label="Answer alignment" aria-valuenow={result.score} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${result.score}%` }} /></div>

        <div className="rc-groups">
          {result.included.length > 0 && (
            <div className="rc-group">
              <h3>Covered</h3>
              <ul>{result.included.map((x) => <li key={x}><Check size={15} aria-label="Included" style={{ color: "var(--success)" }} /> {x}</li>)}</ul>
            </div>
          )}
          {result.missed.length > 0 && (
            <div className="rc-group">
              <h3>Missed</h3>
              <ul>{result.missed.map((x) => <li key={x}><Triangle size={13} aria-label="Missed" style={{ color: "var(--warning)" }} /> {x}</li>)}</ul>
            </div>
          )}
          {result.incorrect.length > 0 && (
            <div className="rc-group">
              <h3>Not quite right</h3>
              <ul>{result.incorrect.map((x) => <li key={x}><X size={15} aria-label="Incorrect" style={{ color: "var(--danger)" }} /> {x}</li>)}</ul>
            </div>
          )}
        </div>
        {result.tip && <p className="rc-tip">{result.tip}</p>}

        <div className="rc-actions">
          <button type="button" className="btn" onClick={retry}><RotateCcw size={14} aria-hidden="true" /> Try again</button>
          <button type="button" className="btn" onClick={() => setShowFull((s) => !s)} aria-expanded={showFull}>
            {showFull ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {showFull ? "Hide full answer" : "See full answer"}
          </button>
        </div>
        {showFull && (
          <div className="rc-full">
            <h3>Full answer</h3>
            <p>{result.modelAnswer}</p>
            <details>
              <summary>What you answered</summary>
              <p style={{ marginTop: 6, color: "var(--muted)" }}>{text}</p>
            </details>
          </div>
        )}
      </section>
    );
  }

  const busy = stage !== null;
  return (
    <section aria-label="Your answer" className="recall-input">
      <div role="tablist" aria-label="How do you want to answer?" className="recall-modes">
        {([["speak", "Speak", Mic], ["type", "Type", Keyboard], ["write", "Write", PenLine]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {mode === "speak" && <HoldToSpeak onAudio={onAudio} busy={stage === "transcribing"} />}
      {mode === "write" && <DrawPad onRead={onWriting} busy={stage === "reading"} />}

      {(mode === "type" || text) && (
        <div className="field" style={{ marginTop: mode === "type" ? 0 : 12 }}>
          <label htmlFor={`answer-${card.id}`} className="field-label">
            {mode === "type" ? "Type your answer" : "Your answer (fix anything we misheard)"}
          </label>
          <textarea id={`answer-${card.id}`} className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) check(); }}
            placeholder={mode === "type" ? "Explain it in your own words…" : undefined} style={{ resize: "vertical" }} />
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>
          <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      <button type="button" className="btn btn-primary" onClick={check} disabled={!text.trim() || busy} aria-busy={stage === "checking"} style={{ marginTop: 12 }}>
        {stage === "checking" ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Checking your recall…</> : "Check my answer"}
      </button>
    </section>
  );
}
