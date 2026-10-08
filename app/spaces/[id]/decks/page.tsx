import { redirect } from "next/navigation";
import Link from "next/link";
import { Mic, Keyboard, PenLine, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getSpaceStudyData } from "@/lib/queries";
import { DeckLibrary } from "./DeckLibrary";
import "../practise-layout.css";

export default async function FlashcardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [space, { decks, due, perDeck }] = await Promise.all([getSpace(id), getSpaceStudyData(id)]);

  const totalCards = decks.reduce((n, d) => n + (perDeck[d.deck_id]?.total ?? 0), 0);
  const firstDue = decks.find((d) => (perDeck[d.deck_id]?.due ?? 0) > 0);

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Flashcards</h1>
        <div className="sub">
          {due.length > 0 ? `${due.length} card${due.length === 1 ? "" : "s"} due for review. ` : ""}
          Answer out loud, by typing or by hand. Logia checks what you remembered and what you missed.
        </div>
      </div>

      {decks.length === 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px" }}>How flashcards work here</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 8, fontSize: 14 }}>
            <li style={{ display: "flex", gap: 8 }}><Mic size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0, marginTop: 2 }} /> Hold to answer out loud. If you can explain it without looking, you understand it.</li>
            <li style={{ display: "flex", gap: 8 }}><Keyboard size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0, marginTop: 2 }} /> Or type it, or <PenLine size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0, marginTop: 2 }} /> write it by hand.</li>
            <li style={{ display: "flex", gap: 8 }}><FileText size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0, marginTop: 2 }} /> Fastest start: open a note and choose <strong>Make flashcards</strong>.</li>
          </ul>
          <Link href={`/spaces/${id}/notes`} className="btn btn-sm">Go to notes</Link>
        </div>
      )}

      {firstDue && (
        <p style={{ margin: "0 0 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 14, color: "var(--muted)" }}>
          {totalCards} cards across {decks.length} deck{decks.length === 1 ? "" : "s"}.
          <Link href={`/spaces/${id}/decks/${firstDue.deck_id}`} className="btn btn-sm">Study {due.length} due card{due.length === 1 ? "" : "s"}</Link>
        </p>
      )}

      <div className="pr-decks">
      <DeckLibrary spaceId={id}
        decks={decks.map((d) => ({ deckId: d.deck_id, title: d.title, subject: d.subject, preview: ((d.cards_json as { question?: string }[] | null)?.[0]?.question) ?? null, ...perDeck[d.deck_id] }))} />
      </div>
    </>
  );
}
