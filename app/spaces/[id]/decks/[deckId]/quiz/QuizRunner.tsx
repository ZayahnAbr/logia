"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle, RotateCcw, ArrowLeft, ListChecks } from "lucide-react";
import { generateQuiz, saveQuizAttempt, type QuizQuestion } from "@/app/actions";

export function QuizRunner({ spaceId, deckId, deckTitle }: { spaceId: string; deckId: string; deckTitle: string }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);

  const start = async () => {
    setLoading(true); setError(null);
    const res = await generateQuiz(deckId);
    setLoading(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    if ("questions" in res && res.questions) {
      setQuestions(res.questions); setIndex(0); setPicked(null); setAnswers([]);
    }
  };

  const next = () => {
    if (picked === null || !questions) return;
    const all = [...answers, picked];
    setAnswers(all);
    setPicked(null);
    if (index + 1 < questions.length) setIndex(index + 1);
    else saveQuizAttempt(spaceId, deckId, all.filter((a, i) => a === questions[i].answerIndex).length, questions.length);
  };

  const back = (
    <Link href={`/spaces/${spaceId}/decks/${deckId}`} className="btn btn-ghost" style={{ alignSelf: "flex-start" }}>
      <ArrowLeft size={14} /> Back to deck
    </Link>
  );

  if (!questions) {
    return (
      <div className="pr-stage" style={{ maxWidth: 960 }}>
        {back}
        <div className="card" style={{ padding: "clamp(28px,6vw,64px)", textAlign: "center", margin: "auto 0" }}>
          <ListChecks size={26} style={{ color: "var(--accent-text)", margin: "0 auto 12px", display: "block" }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Practice quiz · {deckTitle}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
            Multiple-choice questions built from this deck, with tricky wrong answers to test you properly.
          </div>
          <button className="btn btn-primary btn-lg" onClick={start} disabled={loading}>
            {loading ? <><Loader2 size={15} className="spin" /> Writing your quiz…</> : "Start quiz"}
          </button>
          {error && <div style={{ color: "var(--destructive)", fontSize: 12.5, marginTop: 14 }}>{error}</div>}
        </div>
      </div>
    );
  }

  const done = answers.length === questions.length;

  if (done) {
    const score = answers.filter((a, i) => a === questions[i].answerIndex).length;
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="pr-stage" style={{ maxWidth: 960 }}>
        {back}
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 700, color: pct >= 75 ? "var(--emerald)" : pct >= 50 ? "var(--amber)" : "var(--destructive)" }}>{pct}%</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>{score} of {questions.length} correct</div>
          <button className="btn btn-primary" onClick={start} disabled={loading} style={{ marginTop: 18 }}>
            {loading ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} New quiz
          </button>
        </div>
        <div className="pr-results">
        {questions.map((q, i) => {
          const ok = answers[i] === q.answerIndex;
          return (
            <div key={i} className="card" style={{ padding: 18 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {ok ? <CheckCircle2 size={16} style={{ color: "var(--emerald)", flexShrink: 0, marginTop: 2 }} /> : <XCircle size={16} style={{ color: "var(--destructive)", flexShrink: 0, marginTop: 2 }} />}
                <div style={{ fontSize: 14, fontWeight: 500 }}>{q.question}</div>
              </div>
              {!ok && <div style={{ fontSize: 13, marginTop: 8, color: "var(--muted)" }}>You picked: {q.options[answers[i]]}</div>}
              <div style={{ fontSize: 13, marginTop: 4 }}><strong>Answer:</strong> {q.options[q.answerIndex]}</div>
              <div style={{ fontSize: 12.5, marginTop: 6, color: "var(--muted)" }}>{q.explanation}</div>
            </div>
          );
        })}
        </div>
      </div>
    );
  }

  const q = questions[index];
  const revealed = picked !== null;
  return (
    <div className="pr-stage" style={{ maxWidth: 960 }}>
      {back}
      <div className="pr-bar" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index}>
        <i style={{ width: `${(index / questions.length) * 100}%` }} />
      </div>
      <div className="card pr-bigcard" style={{ justifyContent: "flex-start", margin: "auto 0" }}>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 8 }}>Question {index + 1} of {questions.length}</div>
        <div style={{ fontSize: "clamp(1.15rem,2.2vw,1.6rem)", fontWeight: 600, lineHeight: 1.45, marginBottom: 24 }}>{q.question}</div>
        <div className="pr-quiz-opts">
          {q.options.map((opt, i) => {
            const isAnswer = i === q.answerIndex;
            const isPicked = i === picked;
            const bg = !revealed ? "var(--surface-2)" : isAnswer ? "var(--emerald-soft)" : isPicked ? "var(--destructive-soft)" : "var(--surface-2)";
            return (
              <button key={i} disabled={revealed} onClick={() => setPicked(i)}
                style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: "none", background: bg, cursor: revealed ? "default" : "pointer", fontSize: 14, fontFamily: "inherit", color: "var(--text)", display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: "var(--surface)" }}>
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
        {revealed && (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 14, lineHeight: 1.5 }}>{q.explanation}</div>
            <button className="btn btn-primary" onClick={next} style={{ marginTop: 16 }}>
              {index + 1 < questions.length ? "Next question" : "See results"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
