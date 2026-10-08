"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown, Calculator } from "lucide-react";
import { attemptQuestion } from "@/app/actions";
import { MathKeypad } from "@/components/MathKeypad";
import type { PaperQuestion, QuestionAttempt } from "@/lib/types";

type Result = { is_correct: boolean; feedback: string; student_answer?: string };

function StatusPill({ correct }: { correct: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
      padding: "4px 10px", borderRadius: 999,
      color: correct ? "var(--emerald)" : "var(--destructive)",
      background: correct ? "var(--emerald-soft)" : "var(--destructive-soft)",
    }}>
      {correct ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {correct ? "Correct" : "Incorrect"}
    </span>
  );
}

function Breakdown({ q, r }: { q: PaperQuestion; r: Result }) {
  const block = (label: string, text: string, tone?: "bad" | "good") => (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: tone === "bad" ? "var(--destructive)" : tone === "good" ? "var(--emerald)" : "var(--faint)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>{text}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 14, padding: 16, borderRadius: 12, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 14 }}>
      {r.student_answer !== undefined && block("Your answer", r.student_answer.trim() || "(left blank)")}
      {block("Memo answer", q.memo_answer, "good")}
      {block(r.is_correct ? "Why it's correct" : "Where you went wrong", r.feedback, r.is_correct ? "good" : "bad")}
    </div>
  );
}

function CardShell({ index, q, children }: { index: number; q: PaperQuestion; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--faint)" }}>Q{index + 1}</span>
        {q.topic && (
          <span style={{ fontSize: 12, fontWeight: 500, padding: "3px 8px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-text)" }}>
            {q.topic}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>{q.question_text}</div>
      {children}
    </div>
  );
}

// Marked question from the uploaded paper — read-only, with an expandable breakdown.
export function ReviewCard({ index, q, attempt }: { index: number; q: PaperQuestion; attempt: QuestionAttempt }) {
  const [open, setOpen] = useState(false);
  const r: Result = { is_correct: attempt.is_correct, feedback: attempt.feedback, student_answer: attempt.student_answer };
  return (
    <CardShell index={index} q={q}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
        <StatusPill correct={r.is_correct} />
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide breakdown" : r.is_correct ? "See breakdown" : "Where did I go wrong?"}
          <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>
      </div>
      {open && <Breakdown q={q} r={r} />}
    </CardShell>
  );
}

// Generated practice question — answer it here and get marked.
export function PracticeCard({ index, spaceId, q }: { index: number; spaceId: string; q: PaperQuestion }) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!answer.trim() || pending) return;
    setError(null);
    start(async () => {
      const res = await attemptQuestion(spaceId, q.id, answer);
      if ("error" in res && res.error) { setError(res.error); return; }
      setResult({ ...(res as Result), student_answer: answer });
      setOpen(true);
    });
  };

  return (
    <CardShell index={index} q={q}>
      {!result ? (
        <>
          <textarea ref={textRef} className="input" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)}
            onFocus={() => setShowKeypad(true)}
            placeholder="Type your answer…" style={{ resize: "vertical", marginTop: 14 }} />
          {showKeypad && <MathKeypad targetRef={textRef} value={answer} onChange={setAnswer} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <button className="btn btn-primary" onClick={submit} disabled={pending || !answer.trim()}>
              {pending ? <><Loader2 size={14} className="spin" /> Marking…</> : "Mark my answer"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowKeypad((s) => !s)} style={{ fontSize: 12.5 }}>
              <Calculator size={13} /> {showKeypad ? "Hide symbols" : "Show symbols"}
            </button>
          </div>
          {error && <div style={{ color: "var(--amber)", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
            <StatusPill correct={result.is_correct} />
            <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide breakdown" : "Where did I go wrong?"}
              <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
          </div>
          {open && <Breakdown q={q} r={result} />}
        </>
      )}
    </CardShell>
  );
}
