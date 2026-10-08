"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDeck } from "@/app/actions";
import { renameDeck, setDeckFolder, deleteDeck } from "@/app/flashcard-actions";
import { RenameableTitle } from "@/components/RenameableTitle";
import { Loader2, Plus, FolderInput, Trash2, Folder, Search, X, Layers } from "lucide-react";

interface DeckInfo { preview?: string | null; deckId: string; title: string; subject: string | null; total?: number; due?: number; mastery?: number }

const UNFILED = "Unfiled";

function DeckTile({ spaceId, d, folders, onChanged }: { spaceId: string; d: DeckInfo; folders: string[]; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [folder, setFolder] = useState(d.subject ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = d.total ?? 0, dueN = d.due ?? 0;
  const upToDate = total ? Math.round(((total - dueN) / total) * 100) : 0;

  const move = async () => {
    setBusy(true); setError(null);
    const res = await setDeckFolder(spaceId, d.deckId, folder);
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    setMoving(false); onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`Delete the deck "${d.title}" and its ${total} card${total === 1 ? "" : "s"}? Your review history for it is removed too. This can't be undone.`)) return;
    setBusy(true);
    const res = await deleteDeck(spaceId, d.deckId);
    setBusy(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    onChanged();
  };

  return (
    <li className="pr-deck">
      <div className="pr-deck-stack">
        {total > 1 && <span className="pr-deck-layer l2" aria-hidden="true" />}
        {total > 0 && <span className="pr-deck-layer l1" aria-hidden="true" />}
        <div className="pr-deck-face">
          <Link href={`/spaces/${spaceId}/decks/${d.deckId}`} className="pr-deck-link" aria-label={`Study ${d.title}`} />
          <div className="pr-deck-top">
            {dueN > 0 ? <span className="pr-badge due">{dueN} due</span> : <span className="pr-badge">{total ? "Up to date" : "Empty"}</span>}
            <div className="pr-deck-actions">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${d.title} to a folder`} aria-expanded={moving} onClick={() => setMoving((m) => !m)}><FolderInput size={15} /></button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete ${d.title}`} onClick={remove} disabled={busy}><Trash2 size={15} /></button>
            </div>
          </div>
          <p className="pr-deck-q">{d.preview || "No cards yet. Add some, or generate them from a note."}</p>
          <div className="pr-deck-foot">
            <RenameableTitle value={d.title} label="deck" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}
              onRename={async (n) => { const r = await renameDeck(spaceId, d.deckId, n); if (!r.error) onChanged(); return r; }} />
            <span className="pr-deck-meta"><Layers size={13} aria-hidden="true" /> {total} card{total === 1 ? "" : "s"}</span>
            {total > 0 && <div className="pr-bar" role="img" aria-label={`${upToDate}% of cards up to date`}><i style={{ width: `${upToDate}%` }} /></div>}
          </div>
        </div>
      </div>
      {moving && (
        <div className="pr-deck-move">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
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
      {error && <p role="alert" className="field-error" style={{ margin: "8px 0 0" }}>{error}</p>}
    </li>
  );
}

export function DeckLibrary({ spaceId, decks }: { spaceId: string; decks: DeckInfo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState("all");

  const folders = useMemo(() => [...new Set(decks.map((d) => d.subject?.trim()).filter(Boolean) as string[])].sort(), [decks]);
  const groups = useMemo(() => {
    const m = new Map<string, DeckInfo[]>();
    const n = q.trim().toLowerCase();
    for (const d of decks) {
      const k = d.subject?.trim() || UNFILED;
      if (active !== "all" && k !== active) continue;
      if (n && !(d.title.toLowerCase().includes(n) || (d.preview ?? "").toLowerCase().includes(n) || (d.subject ?? "").toLowerCase().includes(n))) continue;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)));
  }, [decks, q, active]);

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
      <div className="pr-bar-row">
        <div className="nb-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="deck-q" className="sr-only">Search flashcard sets</label>
          <input id="deck-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flashcard sets" />
          {q && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}
        </div>
        {folders.length > 0 && (
          <div className="pr-folders" role="group" aria-label="Filter by folder">
            {["all", ...folders, ...(decks.some((d) => !d.subject?.trim()) ? [UNFILED] : [])].map((f) => (
              <button key={f} type="button" className="pr-chip" aria-pressed={active === f} onClick={() => setActive(f)}>
                {f === "all" ? "All" : <><Folder size={13} aria-hidden="true" /> {f}</>}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-primary" style={{ height: 40 }} onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
          <Plus size={14} aria-hidden="true" /> New deck
        </button>
      </div>

      {showForm && (
        <form className="pr-panel pr-newdeck" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <div className="field">
            <label htmlFor="new-deck-name" className="field-label">Deck name <span className="field-req" aria-hidden="true">*</span></label>
            <input id="new-deck-name" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required aria-invalid={!!error} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="new-deck-folder" className="field-label">Folder <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
            <input id="new-deck-folder" className="input" list="new-deck-folders" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <datalist id="new-deck-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </div>
          {error && <p role="alert" className="field-error" style={{ margin: 0, gridColumn: "1 / -1" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}>
            <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? <Loader2 size={14} className="spin" /> : "Create deck"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {decks.length === 0 ? (
        <div className="empty card">No decks yet. Create one, or generate cards from a note or lecture.</div>
      ) : groups.length === 0 ? (
        <div className="empty card"><strong>No sets match.</strong> Try the deck name, a word from its first question, or clear the filters.</div>
      ) : (
        <div style={{ display: "grid", gap: 28 }}>
          {groups.map(([name, list]) => (
            <section key={name} aria-label={name}>
              {(groups.length > 1 || name !== UNFILED) && (
                <h2 className="pr-group"><Folder size={14} aria-hidden="true" /> {name} <span>{list.length}</span></h2>
              )}
              <ul className="pr-decklist">
                {list.map((d) => <DeckTile key={d.deckId} spaceId={spaceId} d={d} folders={folders} onChanged={() => router.refresh()} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
