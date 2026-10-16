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
  { rating: "missed", label: "Missed it", style: "" },
  { rating: "fuzzy", label: "Fuzzy", style: "" },
  { rating: "got", label: "Got it", style: "" },
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

  const total = done + queue.length;
  return (
    <div className="fcs">
      <div className="fcs-progress">
        <div className="fcs-bar" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <i style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        <span className="fcs-count">{done + 1} of {total}</span>
      </div>

      <div className="fcs-card">
        <div className="fcs-topic">{card.concept}</div>
        <p className="fcs-q">{card.question}</p>
        <div className="fcs-tools">
          <button type="button" className="fcs-link" onClick={() => speak(card.question, frontLanguage)}><Volume2 size={14} aria-hidden="true" /> Listen</button>
          {card.answer && <button type="button" className="fcs-link" onClick={() => speak(card.answer!, backLanguage)}><Volume2 size={14} aria-hidden="true" /> Listen to answer</button>}
          {card.hint && !showHint && <button type="button" className="fcs-link" onClick={() => setShowHint(true)}><Lightbulb size={14} aria-hidden="true" /> Show hint</button>}
          <button type="button" className="fcs-link" onClick={upvote} aria-label="Mark this card as useful"><ThumbsUp size={14} aria-hidden="true" />{votes > 0 ? ` ${votes}` : ""}</button>
        </div>
        {card.hint && showHint && <div className="fcs-hint"><Lightbulb size={14} aria-hidden="true" /> {card.hint}</div>}
      </div>

      <RecallAnswer key={card.id} spaceId={spaceId} deckId={deckId} card={card} onResult={setRecall} />

      <div className="fcs-section">
        <div id="rate-label" className="fcs-label">
          {recall ? "How well did you know it? A rating is suggested from your answer." : "Or skip the check and rate yourself"}
        </div>
        <div role="group" aria-labelledby="rate-label" className="fcs-rate">
          {RATING_BUTTONS.map((b) => {
            const isSuggested = suggested === b.rating;
            return (
              <button key={b.rating} type="button" className={isSuggested ? "btn btn-primary" : "btn"} onClick={() => rate(b.rating)}>
                {b.label}
                {isSuggested && <small>Suggested</small>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="fcs-more">
        <button type="button" className="fcs-link" onClick={explain} disabled={eli5Loading}>
          {eli5Loading ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Simplifying…</> : <><Sparkles size={14} aria-hidden="true" /> Explain simply</>}
        </button>
        {related === null && (
          <button type="button" className="fcs-link" onClick={findRelated} disabled={relatedLoading}>
            {relatedLoading ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Searching…</> : <><Link2 size={14} aria-hidden="true" /> Find related notes</>}
          </button>
        )}
      </div>
      {eli5 && <div className="fcs-note">{eli5}</div>}
      {related !== null && (related.length === 0
        ? <div className="fcs-note">No related notes found in your other spaces.</div>
        : related.map((r, i) => <div key={i} className="fcs-note"><b>{r.spaceName}</b> · {r.sourceTitle}<br />{r.snippet}…</div>))}
    </div>
  );
}

// End of a session: what you did, how well you recalled, and where to go next.
function SessionSummary({ spaceId, deckId, done, checked }: { spaceId: string; deckId: string; done: number; checked: { q: string; score: number }[] }) {
  const avg = checked.length ? Math.round(checked.reduce((a, c) => a + c.score, 0) / checked.length) : null;
  const weak = checked.filter((c) => c.score < 70);
  return (
    <div className="fcs-done" role="status">
      <CheckCircle2 size={24} aria-hidden="true" style={{ color: "var(--success)" }} />
      <h2>Session complete</h2>
      <p>You reviewed {done} card{done === 1 ? "" : "s"}{avg !== null ? ` and recalled ${avg}% on average` : ""}.</p>

      {weak.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="fcs-label">Worth another go</div>
          <ul>
            {weak.slice(0, 4).map((w) => <li key={w.q}>{w.q} <span style={{ color: "var(--muted)" }}>· {w.score}%</span></li>)}
          </ul>
          <p>These will come back sooner in your schedule.</p>
        </div>
      )}
      {avg === null && (
        <p>Next time, try answering out loud with <strong>Hold to answer</strong> to see what you remembered and what you missed.</p>
      )}

      <div className="rc-actions">
        <Link href={`/spaces/${spaceId}/decks/${deckId}/quiz`} className="btn btn-primary">Take a quiz</Link>
        <Link href={`/spaces/${spaceId}/decks`} className="btn">Back to flashcards</Link>
      </div>
    </div>
  );
}
