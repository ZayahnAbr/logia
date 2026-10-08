"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Lightbulb, PartyPopper, Link2, ThumbsUp, Loader2, Sparkles, Volume2 } from "lucide-react";
import { speak } from "@/lib/languages";
import { rateCard, findRelatedNotes, voteCard, explainSimply } from "@/app/actions";
import type { Card, Rating } from "@/lib/types";
import { RecallAnswer } from "@/components/RecallAnswer";
import type { RecallResult } from "@/app/flashcard-actions";

const RATING_BUTTONS: { rating: Rating; label: string; style: string }[] = [
  { rating: "missed", label: "Missed it", style: "var(--destructive)" },
  { rating: "fuzzy", label: "Fuzzy", style: "var(--amber)" },
  { rating: "got", label: "Got it", style: "var(--emerald)" },
];

type RelatedNote = { spaceId: string; spaceName: string; sourceTitle: string; sourceType: string; snippet: string };

export function ReviewQueue({ spaceId, deckId, initialCards, frontLanguage, backLanguage }: { spaceId: string; deckId: string; initialCards: Card[]; frontLanguage?: string; backLanguage?: string }) {
  const [queue, setQueue] = useState(initialCards);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(0);
  const [related, setRelated] = useState<RelatedNote[] | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [votes, setVotes] = useState(0);
  const [eli5, setEli5] = useState<string | null>(null);
  const [eli5Loading, setEli5Loading] = useState(false);
  const [recall, setRecall] = useState<RecallResult | null>(null);
  const [checked, setChecked] = useState<{ q: string; score: number }[]>([]);
  const [, start] = useTransition();

  if (initialCards.length === 0) {
    return (
      <div className="empty card" style={{ textAlign: "center", padding: 40 }}>
        <PartyPopper size={24} style={{ margin: "0 auto 10px", display: "block", color: "var(--accent-text)" }} />
        Nothing due right now. You're on top of this deck.
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <SessionSummary spaceId={spaceId} deckId={deckId} done={done} checked={checked} />
    );
  }

  const card = queue[0];
  const suggested: Rating | null = recall ? (recall.score >= 80 ? "got" : recall.score >= 50 ? "fuzzy" : "missed") : null;

  const rate = (rating: Rating) => {
    start(async () => {
      await rateCard(spaceId, deckId, card.id, rating);
      setQueue((q) => q.slice(1));
      setShowHint(false);
      setRelated(null);
      setVotes(0);
      setEli5(null);
      if (recall) setChecked((c) => [...c, { q: card.question, score: recall.score }]);
      setRecall(null);
      setDone((d) => d + 1);
    });
  };

  const explain = async () => {
    setEli5Loading(true);
    const res = await explainSimply(`${card.concept}: ${card.question}`);
    setEli5Loading(false);
    setEli5("error" in res && res.error ? res.error : res.explanation ?? null);
  };

  const findRelated = async () => {
    setRelatedLoading(true);
    const res = await findRelatedNotes(card.concept, spaceId);
    setRelatedLoading(false);
    setRelated(res.results ?? []);
  };

  const upvote = async () => {
    const res = await voteCard(deckId, card.id);
    if ("votes" in res && typeof res.votes === "number") setVotes(res.votes);
  };

  return (
    <div className="pr-stage">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="pr-bar" style={{ flex: 1 }} role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={done + queue.length} aria-valuenow={done}>
          <i style={{ width: `${Math.round((done / (done + queue.length)) * 100)}%` }} />
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {queue.length} card{queue.length === 1 ? "" : "s"} left
        </div>
      </div>
      <div className="pr-stage-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <div className="card pr-bigcard">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 12, color: "var(--faint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
            {card.concept}
          </div>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 12, padding: "0 8px" }} onClick={upvote}>
            <ThumbsUp size={11} /> {votes > 0 ? votes : ""}
          </button>
        </div>
        <div className="pr-q">{card.question}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => speak(card.question, frontLanguage)}><Volume2 size={12} /> Listen</button>
          {card.answer && <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => speak(card.answer!, backLanguage)}><Volume2 size={12} /> Listen to answer</button>}
        </div>

        {card.hint && (
          showHint ? (
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)", fontSize: 13, color: "var(--muted)", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {card.hint}
            </div>
          ) : (
            <button className="btn btn-ghost" style={{ marginTop: 16, alignSelf: "flex-start", fontSize: 12.5 }} onClick={() => setShowHint(true)}>
              <Lightbulb size={13} /> Show hint
            </button>
          )
        )}
      </div>

      <div>
        <div id="rate-label" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          {recall ? "How well did you know it? We've suggested a rating from your answer." : "Or skip the check and rate yourself:"}
        </div>
        <div role="group" aria-labelledby="rate-label" style={{ display: "flex", gap: 10 }}>
          {RATING_BUTTONS.map((b) => {
            const isSuggested = suggested === b.rating;
            return (
              <button key={b.rating} type="button" className={isSuggested ? "btn btn-primary" : "btn"}
                style={{ flex: 1, justifyContent: "center", flexDirection: "column", gap: 2, minHeight: 48, ...(isSuggested ? {} : { color: b.style }) }}
                onClick={() => rate(b.rating)} aria-describedby={isSuggested ? "suggested-note" : undefined}>
                {b.label}
                {isSuggested && <span id="suggested-note" style={{ fontSize: 12, fontWeight: 500, opacity: .9 }}>Suggested</span>}
              </button>
            );
          })}
        </div>
      </div>

      </div>
      <div style={{ minWidth: 0 }}>
      <RecallAnswer key={card.id} spaceId={spaceId} deckId={deckId} card={card} onResult={setRecall} />

      <div style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={explain} disabled={eli5Loading}>
          {eli5Loading ? <><Loader2 size={13} className="spin" /> Simplifying…</> : <><Sparkles size={13} /> Explain like I&apos;m 5</>}
        </button>
        {eli5 && (
          <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)", fontSize: 13, color: "var(--muted)" }}>
            {eli5}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {related === null ? (
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={findRelated} disabled={relatedLoading}>
            {relatedLoading ? <><Loader2 size={13} className="spin" /> Searching your other spaces…</> : <><Link2 size={13} /> Find related notes</>}
          </button>
        ) : related.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--faint)" }}>No related notes found in your other spaces.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {related.map((r, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)" }}>
                <span style={{ fontWeight: 600 }}>{r.spaceName}</span> · {r.sourceTitle}
                <div style={{ color: "var(--muted)", marginTop: 2 }}>{r.snippet}…</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10, textAlign: "center" }}>
        Explain it without looking. If you can, you probably understand it.
      </div>
      </div>
      </div>
    </div>
  );
}

// End of a session: what you did, how well you recalled, and where to go next.
function SessionSummary({ spaceId, deckId, done, checked }: { spaceId: string; deckId: string; done: number; checked: { q: string; score: number }[] }) {
  const avg = checked.length ? Math.round(checked.reduce((a, c) => a + c.score, 0) / checked.length) : null;
  const weak = checked.filter((c) => c.score < 70);
  return (
    <div className="card" style={{ padding: 28, maxWidth: 760, margin: "8vh auto 0" }} role="status">
      <CheckCircle2 size={28} aria-hidden="true" style={{ color: "var(--success)", marginBottom: 10 }} />
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Session complete</h2>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0" }}>
        You reviewed {done} card{done === 1 ? "" : "s"}{avg !== null ? ` and remembered ${avg}% on average when explaining them` : ""}.
      </p>

      {weak.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Worth another go</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "grid", gap: 4 }}>
            {weak.slice(0, 4).map((w) => <li key={w.q}>{w.q} <span style={{ color: "var(--muted)" }}>· {w.score}%</span></li>)}
          </ul>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "8px 0 0" }}>They&apos;ll come back sooner in your schedule.</p>
        </div>
      )}
      {avg === null && (
        <p style={{ fontSize: 14, margin: "14px 0 0" }}>Next time, try answering out loud with <strong>Hold to answer</strong>. Logia shows exactly what you remembered and what you missed.</p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        <Link href={`/spaces/${spaceId}/decks/${deckId}/quiz`} className="btn btn-primary">Test yourself with a quiz</Link>
        <Link href={`/spaces/${spaceId}/decks`} className="btn">Back to flashcards</Link>
      </div>
    </div>
  );
}
