"use client";
import { toast } from "@/components/Toaster";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { saveCard, removeCard, type CardInput } from "@/app/flashcard-actions";
import type { Card } from "@/lib/types";

const EMPTY: CardInput = { concept: "", question: "", answer: "", hint: "" };

function CardForm({ initial, onSave, onCancel, saving, error, submitLabel }: {
  initial: CardInput; onSave: (c: CardInput) => void; onCancel: () => void; saving: boolean; error: string | null; submitLabel: string;
}) {
  const [c, setC] = useState(initial);
  const id = initial.id ?? "new";
  const set = (k: keyof CardInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setC({ ...c, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(c); }} style={{ display: "grid", gap: 12 }}>
      <div className="field">
        <label htmlFor={`q-${id}`} className="field-label">Question <span className="field-req" aria-hidden="true">*</span></label>
        <textarea id={`q-${id}`} className="input" rows={2} value={c.question} onChange={set("question")} required aria-invalid={!!error && !c.question.trim()} autoFocus />
      </div>
      <div className="field">
        <label htmlFor={`a-${id}`} className="field-label">Answer <span style={{ fontWeight: 400, color: "var(--muted)" }}>(recommended)</span></label>
        <textarea id={`a-${id}`} className="input" rows={3} value={c.answer} onChange={set("answer")} />
        <span className="field-hint">Your spoken, typed or written answers are checked against this. Leave it empty and one is written for you the first time you answer.</span>
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        <div className="field">
          <label htmlFor={`c-${id}`} className="field-label">Topic <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
          <input id={`c-${id}`} className="input" value={c.concept} onChange={set("concept")} />
        </div>
        <div className="field">
          <label htmlFor={`h-${id}`} className="field-label">Hint <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
          <input id={`h-${id}`} className="input" value={c.hint} onChange={set("hint")} />
        </div>
      </div>
      {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{saving ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</> : submitLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

export function CardEditor({ spaceId, deckId, cards }: { spaceId: string; deckId: string; cards: Card[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (c: CardInput) => {
    if (!c.question.trim()) { setError("A card needs a question."); return; }
    setSaving(true); setError(null);
    const res = await saveCard(spaceId, deckId, c);
    setSaving(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setEditing(null); router.refresh();
  };
  const remove = async (card: Card) => {
    if (!window.confirm("Delete this card? Its review history is removed too. This can't be undone.")) return;
    const res = await removeCard(spaceId, deckId, card.id);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    router.refresh();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>{cards.length} card{cards.length === 1 ? "" : "s"}</span>
        {editing !== "new" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setEditing("new"); setError(null); }}>
            <Plus size={14} aria-hidden="true" /> Add card
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>New card</h3>
          <CardForm initial={EMPTY} onSave={save} onCancel={() => setEditing(null)} saving={saving} error={error} submitLabel="Add card" />
        </div>
      )}

      {cards.length === 0 && editing !== "new" ? (
        <div className="empty card">This deck has no cards yet. Add your first one.</div>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))", gap: 10, alignItems: "start" }}>
          {cards.map((card, i) => (
            <li key={card.id} className="card" style={{ padding: 16 }}>
              {editing === card.id ? (
                <CardForm initial={{ id: card.id, concept: card.concept ?? "", question: card.question, answer: card.answer ?? "", hint: card.hint ?? "" }}
                  onSave={save} onCancel={() => setEditing(null)} saving={saving} error={error} submitLabel="Save card" />
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span aria-hidden="true" style={{ fontSize: 13, color: "var(--faint)", minWidth: 22, paddingTop: 2 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {card.concept && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 2 }}>{card.concept}</div>}
                    <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45 }}>{card.question}</div>
                    <div style={{ fontSize: 14, color: card.answer ? "var(--text)" : "var(--faint)", marginTop: 6, lineHeight: 1.5 }}>
                      {card.answer || "No answer yet. Logia writes one the first time you answer this card."}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Edit card ${i + 1}`} onClick={() => { setEditing(card.id); setError(null); }}><Pencil size={15} /></button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete card ${i + 1}`} onClick={() => remove(card)}><Trash2 size={15} /></button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
