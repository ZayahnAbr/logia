"use client";

import { Fragment, useMemo, useState } from "react";
import { Check, X as XIcon } from "lucide-react";
import type { PaperQuestion, QuestionAttempt } from "@/lib/types";

// Marked paper, question by question: your answer and the memo side by side, with the
// marker's issues as numbered pins next to the question. Pins and highlights are linked.
type Issue = { n: number; text: string; quote: string | null };

function issuesFrom(feedback: string, answer: string): Issue[] {
  const sentences = feedback.split(/(?<=[.!?])\s+(?=[A-Z"“'(])/).map((s) => s.trim()).filter(Boolean);
  return sentences.map((text, i) => {
    // A quoted fragment that also appears in the answer can be highlighted in place.
    const quotes = [...text.matchAll(/[“"']([^“”"']{3,80})[”"']/g)].map((m) => m[1]);
    const quote = quotes.find((qt) => answer.toLowerCase().includes(qt.toLowerCase())) ?? null;
    return { n: i + 1, text, quote };
  });
}

function Highlighted({ text, issues, active, onPick }: { text: string; issues: Issue[]; active: number | null; onPick: (n: number) => void }) {
  const marks = issues.filter((i) => i.quote);
  if (!marks.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const spans: { start: number; end: number; n: number }[] = [];
  for (const m of marks) {
    const at = lower.indexOf(m.quote!.toLowerCase());
    if (at >= 0 && !spans.some((s) => at < s.end && at + m.quote!.length > s.start)) spans.push({ start: at, end: at + m.quote!.length, n: m.n });
  }
  spans.sort((x, y) => x.start - y.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const s of spans) {
    out.push(<Fragment key={`t${pos}`}>{text.slice(pos, s.start)}</Fragment>);
    out.push(
      <button key={`m${s.n}`} type="button" className={`cmp-hl${active === s.n ? " on" : ""}`} onClick={() => onPick(s.n)} aria-label={`Issue ${s.n}`}>
        {text.slice(s.start, s.end)}<sup>{s.n}</sup>
      </button>,
    );
    pos = s.end;
  }
  out.push(<Fragment key="end">{text.slice(pos)}</Fragment>);
  return <>{out}</>;
}

function QuestionCompare({ index, q, a }: { index: number; q: PaperQuestion; a: QuestionAttempt }) {
  const issues = useMemo(() => issuesFrom(a.feedback || "", a.student_answer || ""), [a]);
  const [active, setActive] = useState<number | null>(a.is_correct ? null : issues[0]?.n ?? null);
  const current = issues.find((i) => i.n === active);
  return (
    <article id={`q-${q.id}`} className={`cmp-q${a.is_correct ? " ok" : " bad"}`} aria-labelledby={`qh-${q.id}`}>
      <header className="cmp-qhead">
        <span className="cmp-num" aria-hidden="true">{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id={`qh-${q.id}`}>{q.question_text}</h3>
          {q.topic && <span className="cmp-topic">{q.topic}</span>}
        </div>
        <span className={`cmp-status${a.is_correct ? " ok" : " bad"}`}>{a.is_correct ? <><Check size={14} aria-hidden="true" /> Correct</> : <><XIcon size={14} aria-hidden="true" /> Needs work</>}</span>
      </header>

      <div className="cmp-body">
        <div className="cmp-cols">
          <section className="cmp-col you" aria-label="Your answer">
            <h4>Your answer</h4>
            <p><Highlighted text={a.student_answer || "No answer given."} issues={issues} active={active} onPick={setActive} /></p>
          </section>
          <section className="cmp-col memo" aria-label="Memo answer">
            <h4>Memo</h4>
            <p>{q.memo_answer || "No memo answer was found for this question."}</p>
          </section>
        </div>

        {issues.length > 0 && (
          <aside className="cmp-issues" aria-label={a.is_correct ? "Marker's notes" : "Issues found"}>
            <div className="cmp-pins" role="tablist" aria-label="Issues">
              {issues.map((i) => (
                <button key={i.n} type="button" role="tab" aria-selected={active === i.n} className={`cmp-pin${active === i.n ? " on" : ""}${a.is_correct ? " note" : ""}`}
                  onClick={() => setActive((c) => (c === i.n ? null : i.n))} aria-label={`${a.is_correct ? "Note" : "Issue"} ${i.n}`}>{i.n}</button>
              ))}
            </div>
            {current && <p className="cmp-callout" role="tabpanel">{current.text}</p>}
            {!current && <p className="cmp-hint">{a.is_correct ? "Tap a number to see the marker's note." : "Tap a number to see what went wrong."}</p>}
          </aside>
        )}
      </div>
    </article>
  );
}

export function CompareView({ questions, latest }: { questions: PaperQuestion[]; latest: Map<string, QuestionAttempt> }) {
  return (
    <section className="cmp" aria-labelledby="cmp-h">
      <div className="cmp-top">
        <h2 id="cmp-h">Your paper vs the memo</h2>
        <nav className="cmp-map" aria-label="Jump to question">
          {questions.map((q, i) => {
            const ok = latest.get(q.id)?.is_correct;
            return <a key={q.id} href={`#q-${q.id}`} className={ok ? "ok" : "bad"} aria-label={`Question ${i + 1}, ${ok ? "correct" : "needs work"}`}>{i + 1}</a>;
          })}
        </nav>
      </div>
      {questions.map((q, i) => <QuestionCompare key={q.id} index={i} q={q} a={latest.get(q.id)!} />)}
    </section>
  );
}
