"use client";
import { toast } from "@/components/Toaster";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, GraduationCap, Pencil, Maximize2 } from "lucide-react";
import { RenameableTitle } from "@/components/RenameableTitle";
import { renameDeck, deleteDeck } from "@/app/flashcard-actions";
import { ReviewQueue } from "./ReviewQueue";
import { FlipDeck } from "./FlipDeck";
import { CardEditor } from "./CardEditor";
import type { Card } from "@/lib/types";

export function DeckTabs({ spaceId, deckId, title, folder, dueCards, allCards, frontLanguage, backLanguage, toolbar }: {
  spaceId: string; deckId: string; title: string; folder: string | null; dueCards: Card[]; allCards: Card[];
  frontLanguage?: string; backLanguage?: string; toolbar: React.ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"study" | "edit">(allCards.length === 0 ? "edit" : "study");
  const [practiseAll, setPractiseAll] = useState(false);
  const [flip, setFlip] = useState(false);

  const remove = async () => {
    if (!window.confirm(`Delete the deck "${title}" and all ${allCards.length} card${allCards.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    const res = await deleteDeck(spaceId, deckId);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    router.push(`/spaces/${spaceId}`);
  };

  const queue = practiseAll ? allCards : dueCards;

  return (
    <>
      <header style={{ marginBottom: 20 }} className="pr-deckhead">
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Flashcards{folder ? ` · ${folder}` : ""}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem,3vw,2rem)", fontWeight: 700, letterSpacing: "-.02em", flex: 1, minWidth: 0, display: "flex" }}>
            <RenameableTitle value={title} label="deck" onRename={(n) => renameDeck(spaceId, deckId, n)} />
          </h1>
          <button type="button" className="btn btn-ghost btn-sm" onClick={remove} style={{ color: "var(--danger)" }}>
            <Trash2 size={14} aria-hidden="true" /> Delete deck
          </button>
        </div>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0" }}>
          {allCards.length} card{allCards.length === 1 ? "" : "s"} · {dueCards.length > 0 ? `${dueCards.length} due for review` : "nothing due right now"}
        </p>
      </header>

      <div className="pr-split">
        <aside className="pr-side" aria-label="Study modes">
          <div className="pr-panel">
            <h2>Study</h2>
            {allCards.length > 0 && (
              <button type="button" className="flip-launch" style={{ maxWidth: "none", marginBottom: 12 }} onClick={() => setFlip(true)}>
                <span className="flip-launch-art" aria-hidden="true"><i /><i /><i /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>Flip-card practice</strong>
                  <span>Full screen. Tap to flip, swipe right if you knew it.</span>
                </span>
                <Maximize2 size={18} aria-hidden="true" />
              </button>
            )}
            {toolbar}
          </div>
          <div className="pr-panel">
            <h2>Progress</h2>
            <div className="pr-bar" role="img" aria-label={`${allCards.length - dueCards.length} of ${allCards.length} cards up to date`}>
              <i style={{ width: `${allCards.length ? Math.round(((allCards.length - dueCards.length) / allCards.length) * 100) : 0}%` }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>{allCards.length - dueCards.length} of {allCards.length} up to date</p>
          </div>
        </aside>

        <div className="pr-main">
          <div role="tablist" aria-label="Deck" className="mm-seg" style={{ display: "inline-flex", marginBottom: 16 }}>
            <button role="tab" aria-selected={tab === "study"} className={tab === "study" ? "on" : ""} onClick={() => setTab("study")}><GraduationCap size={14} aria-hidden="true" /> Study</button>
            <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}><Pencil size={14} aria-hidden="true" /> Edit cards</button>
          </div>

          {tab === "study" ? (
            <>
              {flip && <FlipDeck spaceId={spaceId} deckId={deckId} cards={dueCards.length ? dueCards : allCards} onClose={() => { setFlip(false); router.refresh(); }} />}
              {dueCards.length === 0 && !practiseAll && allCards.length > 0 ? (
                <div className="card" style={{ padding: 28, textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Nothing due right now</div>
                  <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 16px" }}>You&apos;re up to date. You can still practise the whole deck. Your ratings will update each card&apos;s review schedule.</p>
                  <button type="button" className="btn btn-primary" onClick={() => setPractiseAll(true)}>Practise all {allCards.length} cards</button>
                </div>
              ) : allCards.length === 0 ? (
                <div className="empty card">This deck is empty. Switch to <strong>Edit cards</strong> to add some.</div>
              ) : (
                <ReviewQueue key={practiseAll ? "all" : "due"} spaceId={spaceId} deckId={deckId} initialCards={queue} frontLanguage={frontLanguage} backLanguage={backLanguage} />
              )}
            </>
          ) : (
            <CardEditor spaceId={spaceId} deckId={deckId} cards={allCards} />
          )}
        </div>
      </div>
    </>
  );
}
