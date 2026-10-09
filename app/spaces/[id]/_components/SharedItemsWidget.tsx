"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Copy, Layers, Loader2, Share2, ChevronLeft, ChevronRight, Check, BookOpen, Pencil } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { CoverArt } from "@/components/NotebookCover";
import { createSpace } from "@/app/actions";
import {
  listShareablePicks, saveSharePicks, previewShare, myOtherSpaces, copySharedItem, setShareDescription,
  type SharedItem, type SharePreview, type CopyResult,
} from "@/app/shared-items-actions";

const RULE = "Only notes and flashcards you made in Logia can be shared. Uploaded files stay private.";

export function SharedItemsWidget({ spaceId, items }: { spaceId: string; items: SharedItem[] }) {
  const router = useRouter();
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<SharedItem | null>(null);
  const [adding, setAdding] = useState<SharedItem | null>(null);
  const [detail, setDetail] = useState<SharedItem | null>(null);
  const hasMine = true; // anyone in the space may share their own items; the picker lists only theirs

  return (
    <div className="shr">
      <div className="shr-top">
        <p className="shr-note">{RULE}</p>
        {hasMine && (
          <button type="button" className="btn btn-sm" onClick={() => setPicker(true)} aria-haspopup="dialog">
            <Share2 size={14} aria-hidden="true" /> Choose what to share
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty card" style={{ padding: "24px 20px" }}>Nothing is shared here yet. Choose a notebook or a deck of yours to show it to this space.</div>
      ) : (
        <ul className="shr-grid">
          {items.map((it) => {
            const count = `${it.item_count} ${it.kind === "notebook" ? (it.item_count === 1 ? "note" : "notes") : (it.item_count === 1 ? "card" : "cards")}`;
            return (
              <li key={it.share_id}>
                <button type="button" className={`shr-tile shr-${it.kind}`} onClick={() => setDetail(it)} aria-haspopup="dialog"
                  aria-label={`${it.title}, ${it.kind === "notebook" ? "notebook" : "flashcard deck"}, ${count}, shared by ${it.is_mine ? "you" : it.owner_name}`}>
                  {it.kind === "notebook" ? (
                    <span className="shr-book" aria-hidden="true">
                      <span className="shr-book-cover"><CoverArt cover={{ kind: it.cover_kind, value: it.cover_value }} /></span>
                      <span className="shr-book-spine" />
                      <span className="shr-book-label">{it.title}</span>
                    </span>
                  ) : (
                    <span className="shr-deck" aria-hidden="true">
                      <i /><i />
                      <span className="shr-deck-top"><Layers size={16} /><b>{it.title}</b><em>{count}</em></span>
                    </span>
                  )}
                  <span className="shr-tile-body">
                    <span className="shr-title truncate">{it.title}</span>
                    <span className="shr-meta">{count} · {it.is_mine ? "Shared by you" : `by ${it.owner_name}`}</span>
                    {it.description ? <span className="shr-desc">{it.description}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picker && <PickerDialog spaceId={spaceId} onClose={() => setPicker(false)} onSaved={() => { setPicker(false); router.refresh(); }} />}
      {detail && <DetailDialog item={detail} onClose={() => setDetail(null)}
        onPreview={() => { setPreview(detail); setDetail(null); }} onAdd={() => { setAdding(detail); setDetail(null); }} onSaved={() => router.refresh()} />}
      {preview && <PreviewDialog item={preview} onClose={() => setPreview(null)} />}
      {adding && <AddDialog item={adding} currentSpace={spaceId} onClose={() => setAdding(null)} />}
    </div>
  );
}

function PickerDialog({ spaceId, onClose, onSaved }: { spaceId: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listShareablePicks>> | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    listShareablePicks(spaceId).then((r) => { if (!alive) return; setData(r); if (!("error" in r)) setSel(new Set(r.picked)); });
    return () => { alive = false; };
  }, [spaceId]);

  const toggle = (id: string) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    if (!data || "error" in data) return;
    setBusy(true); setErr("");
    const res = await saveSharePicks(spaceId, data.notebooks.filter((n) => sel.has(n.id)).map((n) => n.id), data.decks.filter((d) => sel.has(d.id)).map((d) => d.id));
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onSaved();
  };

  return (
    <Dialog title="Choose what to share" onClose={onClose} width={480}>
      <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>{RULE} Other people can read what you pick and copy it into their own spaces.</p>
      {!data && <p role="status" style={{ color: "var(--muted)" }}>Loading your notebooks and decks…</p>}
      {data && "error" in data && <div className="notice notice-error" role="alert">{data.error}</div>}
      {data && !("error" in data) && (
        <>
          <fieldset className="shr-fs">
            <legend>Notebooks you made in this space</legend>
            {data.notebooks.length === 0 && <p className="shr-meta">You have no notebooks here yet.</p>}
            {data.notebooks.map((n) => (
              <label key={n.id} className="shr-check">
                <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} />
                <span className="truncate">{n.name}</span>
                <span className="shr-meta">{n.count} {n.count === 1 ? "note" : "notes"}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="shr-fs">
            <legend>Flashcard decks you made in this space</legend>
            {data.decks.length === 0 && <p className="shr-meta">You have no decks here yet.</p>}
            {data.decks.map((d) => (
              <label key={d.id} className="shr-check">
                <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="truncate">{d.title}</span>
                <span className="shr-meta">{d.count} {d.count === 1 ? "card" : "cards"}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {err && <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !data || "error" in data} aria-busy={busy}>
          {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</> : "Save"}
        </button>
      </div>
    </Dialog>
  );
}

export function PreviewDialog({ item, onClose, load = previewShare }: { item: SharedItem; onClose: () => void; load?: (shareId: string, kind: "notebook" | "deck") => Promise<SharePreview | { error: string }> }) {
  const [data, setData] = useState<SharePreview | { error: string } | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    load(item.share_id, item.kind).then((r) => { if (alive) setData(r); });
    return () => { alive = false; };
  }, [item.share_id, item.kind, load]);

  const list = data && !("error" in data) ? (data.kind === "notebook" ? data.notes : data.cards) : [];
  const n = list.length;
  const at = Math.min(i, Math.max(0, n - 1));
  const note = data && !("error" in data) && data.kind === "notebook" ? data.notes[at] : null;
  const card = data && !("error" in data) && data.kind === "deck" ? data.cards[at] : null;

  return (
    <Dialog title={`Preview: ${item.title}`} onClose={onClose} width={620}>
      <p className="shr-meta" style={{ margin: "0 0 12px" }}>Read only. Shared by {item.is_mine ? "you" : item.owner_name}. Pictures inside notes are not shown.</p>
      {!data && <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>}
      {data && "error" in data && <div className="notice notice-error" role="alert">{data.error}</div>}
      {data && !("error" in data) && n === 0 && <p style={{ color: "var(--muted)" }}>{item.kind === "notebook" ? "This notebook has no notes yet." : "This deck has no cards yet."}</p>}
      {n > 0 && (
        <>
          <div className="shr-pager">
            <button type="button" className="btn btn-sm" onClick={() => setI(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous"><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
            <span role="status" aria-live="polite" className="shr-meta">{item.kind === "notebook" ? "Note" : "Card"} {at + 1} of {n}</span>
            <button type="button" className="btn btn-sm" onClick={() => setI(Math.min(n - 1, at + 1))} disabled={at >= n - 1} aria-label="Next">Next <ChevronRight size={14} aria-hidden="true" /></button>
          </div>
          <div className="shr-page" tabIndex={0} aria-label={item.kind === "notebook" ? "Note text" : "Card"}>
            {note && (<><h3>{note.title}</h3><p className="shr-text">{note.text || "This note is empty."}</p></>)}
            {card && (
              <>
                {card.concept && <p className="shr-meta">{card.concept}</p>}
                <h3>{card.question}</h3>
                {card.hint && <p className="shr-text"><strong>Hint:</strong> {card.hint}</p>}
                {card.answer && <p className="shr-text"><strong>Answer:</strong> {card.answer}</p>}
              </>
            )}
          </div>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function AddDialog({ item, currentSpace, onClose, copy = copySharedItem }: { item: SharedItem; currentSpace: string; onClose: () => void; copy?: (shareId: string, target: string) => Promise<CopyResult | { error: string }> }) {
  const [spaces, setSpaces] = useState<{ id: string; name: string }[] | null>(null);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<CopyResult | null>(null);

  useEffect(() => {
    let alive = true;
    myOtherSpaces().then((s) => { if (!alive) return; setSpaces(s); setTarget(s.find((x) => x.id !== currentSpace)?.id ?? s[0]?.id ?? ""); });
    return () => { alive = false; };
  }, [currentSpace]);

  const go = async () => {
    setBusy(true); setErr("");
    let dest = target;
    if (!spaces?.length) {
      const made = await createSpace(name.trim() || "My space", "", "peer");
      if ("error" in made && made.error) { setBusy(false); setErr(made.error); return; }
      dest = (made as { id: string }).id;
    }
    const res = await copy(item.share_id, dest);
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    setDone(res);
  };

  const link = done ? (done.kind === "notebook" ? `/spaces/${done.space_id}/notes` : `/spaces/${done.space_id}/decks/${done.new_id}`) : "";

  return (
    <Dialog title={`Add "${item.title}" to mine`} onClose={onClose} width={460}>
      {done ? (
        <div role="status">
          <p style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}><Check size={16} aria-hidden="true" /> Added as &ldquo;{done.name}&rdquo;.</p>
          <p className="shr-meta" style={{ margin: "0 0 12px" }}>
            Copied {done.copied} {done.kind === "notebook" ? (done.copied === 1 ? "note" : "notes") : (done.copied === 1 ? "card" : "cards")}.
            {done.truncated && ` The original has ${done.total}, so only the first ${done.copied} were copied (the limit is ${done.kind === "notebook" ? "200 notes" : "1000 cards"}).`}
            {done.images_removed > 0 && ` Pictures inside ${done.images_removed === 1 ? "1 note were" : `${done.images_removed} notes were`} not copied.`}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={onClose}>Close</button>
            <Link href={link} className="btn btn-primary">Open my copy</Link>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}>
            This makes your own copy. {item.kind === "deck" ? "Cards are copied with no review history." : "Pictures inside notes are not copied."} The original stays as it is.
          </p>
          {!spaces && <p role="status" style={{ color: "var(--muted)" }}>Loading your spaces…</p>}
          {spaces && spaces.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor="shr-target">Which of your spaces?</label>
              <select id="shr-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {spaces && spaces.length === 0 && (
            <div className="field">
              <label className="field-label" htmlFor="shr-new">You have no spaces yet. Name one to create it</label>
              <input id="shr-new" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="My study space" />
            </div>
          )}
          {err && <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={busy || !spaces} aria-busy={busy}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Copying…</> : spaces?.length === 0 ? "Create space and add" : "Add to this space"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

// What you see when you click a shared notebook or deck: the owner's description, then preview or copy.
function DetailDialog({ item, onClose, onPreview, onAdd, onSaved }: { item: SharedItem; onClose: () => void; onPreview: () => void; onAdd: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.description ?? "");
  const [shown, setShown] = useState(item.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const count = `${item.item_count} ${item.kind === "notebook" ? (item.item_count === 1 ? "note" : "notes") : (item.item_count === 1 ? "card" : "cards")}`;

  const save = async () => {
    setBusy(true); setErr("");
    const r = await setShareDescription(item.share_id, text);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setShown(text.trim()); setEditing(false); onSaved();
  };

  return (
    <Dialog title={item.title} onClose={onClose} width={520}>
      <div className="shr-detail">
        <p className="shr-meta" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {item.kind === "notebook" ? <BookOpen size={14} aria-hidden="true" /> : <Layers size={14} aria-hidden="true" />}
          {item.kind === "notebook" ? "Notebook" : "Flashcard deck"} · {count} · {item.is_mine ? "Shared by you" : `Shared by ${item.owner_name}`}
        </p>

        {editing ? (
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label" htmlFor="shr-desc">Description</label>
            <textarea id="shr-desc" className="input" rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="What is in it, who it is for, and how you use it" />
            <div className="field-hint">{text.length}/500 · Everyone in this space can read it.</div>
          </div>
        ) : (
          <div className="shr-detail-desc">
            {shown ? <p>{shown}</p> : <p className="shr-meta">{item.is_mine ? "Add a short description so classmates know what this is." : "No description yet."}</p>}
          </div>
        )}
        {err && <div className="notice notice-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}

        <div className="shr-detail-actions">
          {item.is_mine && !editing && <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" /> {shown ? "Edit description" : "Add a description"}</button>}
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setText(shown); }}>Cancel</button>}
          {editing && <button type="button" className="btn btn-primary" onClick={save} disabled={busy} aria-busy={busy}>{busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</> : "Save"}</button>}
          {!editing && <span style={{ flex: 1 }} />}
          {!editing && <button type="button" className="btn" onClick={onPreview}><Eye size={14} aria-hidden="true" /> Preview</button>}
          {!editing && !item.is_mine && <button type="button" className="btn btn-primary" onClick={onAdd}><Copy size={14} aria-hidden="true" /> Add to mine</button>}
        </div>
      </div>
    </Dialog>
  );
}
