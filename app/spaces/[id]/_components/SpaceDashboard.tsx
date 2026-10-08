"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDeck } from "@/app/actions";
import { renameDeck, setDeckFolder, deleteDeck } from "@/app/flashcard-actions";
import { RenameableTitle } from "@/components/RenameableTitle";
import {Loader2, Plus, Layers, FolderInput, Trash2, Folder, Search } from "lucide-react";

interface DeckInfo {
  preview?: string | null;
  deckId: string;
  title: string;
  subject: string | null;
  total?: number;
  due?: number;
  mastery?: number;
}

const UNFILED = "Unfiled";

function DeckRow({ spaceId, d, folders, onChanged }: { spaceId: string; d: DeckInfo; folders: string[]; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [folder, setFolder] = useState(d.subject ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async () => {
    setBusy(true); setError(null);
    const res = await setDeckFolder(spaceId, d.deckId, folder);
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setMoving(false); onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`Delete the deck "${d.title}" and its ${d.total ?? 0} card${d.total === 1 ? "" : "s"}? Your review history for it is removed too. This can't be undone.`)) return;
    setBusy(true);
    const res = await deleteDeck(spaceId, d.deckId);
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    onChanged();
  };

  const total = d.total ?? 0, dueN = d.due ?? 0;
  const layers = total >= 20 ? 3 : total >= 6 ? 2 : total >= 1 ? 1 : 0;
  const hue = [...d.title].reduce((h, c) => h + c.charCodeAt(0), 0) % 5;

  return (
    <li className="deck" style={{ ["--deck-tone" as string]: ["#f2836b", "#9cc3e6", "#a9c6a2", "#c6b8ea", "#f2b84b"][hue] }}>
      <div className="deck-stack" aria-hidden="true">{Array.from({ length: layers }, (_, k) => <span key={k} className={`deck-layer l${k + 1}`} />)}</div>
      <div className="deck-face">
        <Link href={`/spaces/${spaceId}/decks/${d.deckId}`} className="stretched" aria-label={`Study ${d.title}`} />
        <span className="deck-stripe" aria-hidden="true" />
        <div className="deck-top">
          {dueN > 0 ? <span className="deck-due">{dueN} due</span> : <span className="deck-ok">Up to date</span>}
          <div className="deck-actions">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${d.title} to a folder`} aria-expanded={moving} onClick={() => setMoving((m) => !m)}>
              <FolderInput size={15} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete ${d.title}`} onClick={remove} disabled={busy}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <p className="deck-q">{d.preview || "No cards yet. Add some, or generate them from a note."}</p>
        <div className="deck-foot">
          <RenameableTitle value={d.title} label="deck" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}
            onRename={async (n) => { const r = await renameDeck(spaceId, d.deckId, n); if (!r.error) onChanged(); return r; }} />
          <span className="deck-count"><Layers size={13} aria-hidden="true" /> {total} card{total === 1 ? "" : "s"}</span>
        </div>
      </div>

      {moving && (
        <div style={{ position: "relative", zIndex: 3, display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor={`folder-${d.deckId}`} className="field-label">Folder</label>
            <input id={`folder-${d.deckId}`} className="input" list={`folders-${d.deckId}`} value={folder}
              onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") move(); if (e.key === "Escape") setMoving(false); }}
              placeholder="Type a new folder or pick one" autoFocus />
            <datalist id={`folders-${d.deckId}`}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
            <span className="field-hint">Leave empty to move it to Unfiled.</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={move} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : "Move"}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoving(false)}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="field-error" style={{ position: "relative", zIndex: 3, margin: "8px 0 0" }}>{error}</p>}
    </li>
  );
}

export function SpaceDashboard({ spaceId, decks }: { spaceId: string; due: number; decks: DeckInfo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const folders = useMemo(() => [...new Set(decks.map((d) => d.subject?.trim()).filter(Boolean) as string[])].sort(), [decks]);
  const groups = useMemo(() => {
    const m = new Map<string, DeckInfo[]>();
    const n = q.trim().toLowerCase();
    for (const d of decks.filter((x) => !n || x.title.toLowerCase().includes(n) || (x.preview ?? "").toLowerCase().includes(n) || (x.subject ?? "").toLowerCase().includes(n))) { const k = d.subject?.trim() || UNFILED; m.set(k, [...(m.get(k) ?? []), d]); }
    return [...m.entries()].sort(([a], [b]) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)));
  }, [decks, q]);

  const create = () => start(async () => {
    if (!title.trim()) { setError("Give the deck a name."); return; }
    setError(null);
    const res = await createDeck(spaceId, title.trim(), folder.trim());
    if (res && "error" in res && res.error) { setError(res.error); return; }
    setTitle(""); setFolder(""); setShowForm(false);
    router.refresh();
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button type="button" className="btn btn-sm" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
          <Plus size={14} aria-hidden="true" /> New deck
        </button>
      </div>

      {showForm && (
        <form className="card" style={{ padding: 18, marginBottom: 16, display: "grid", gap: 12 }} onSubmit={(e) => { e.preventDefault(); create(); }}>
          <div className="field">
            <label htmlFor="new-deck-name" className="field-label">Deck name <span className="field-req" aria-hidden="true">*</span></label>
            <input id="new-deck-name" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required aria-invalid={!!error} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="new-deck-folder" className="field-label">Folder <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
            <input id="new-deck-folder" className="input" list="new-deck-folders" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <datalist id="new-deck-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </div>
          {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? <Loader2 size={14} className="spin" /> : "Create deck"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {decks.length > 1 && (
        <div className="nb-search" style={{ marginBottom: 16, maxWidth: 420 }}>
          <Search size={15} aria-hidden="true" />
          <label htmlFor="deck-q" className="sr-only">Search flashcard sets</label>
          <input id="deck-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flashcard sets" />
        </div>
      )}
      {decks.length > 0 && groups.length === 0 ? (
        <div className="empty card"><strong>No sets match “{q}”.</strong> Try the deck name or a word from its first question.</div>
      ) : decks.length === 0 ? (
        <div className="empty card">No decks yet. Create one, or generate cards from a note or lecture.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map(([name, list]) => (
            <div key={name}>
              {(groups.length > 1 || name !== UNFILED) && (
                <h3 style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", margin: "0 0 8px" }}>
                  <Folder size={14} aria-hidden="true" /> {name} <span style={{ fontWeight: 400 }}>· {list.length}</span>
                </h3>
              )}
              <ul className="decks">
                {list.map((d) => <DeckRow key={d.deckId} spaceId={spaceId} d={d} folders={folders} onChanged={() => router.refresh()} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
