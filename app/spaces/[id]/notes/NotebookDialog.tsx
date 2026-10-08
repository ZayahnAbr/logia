"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { CoverPicker } from "./CoverPicker";
import { createNotebook, updateNotebook, setNoteCover } from "@/app/notebook-actions";
import { COVER_EMOJIS, DEFAULT_COVER_COLOR, type Cover } from "@/lib/notebookCovers";

export type NotebookRow = { id: string; name: string; cover_kind: string; cover_value: string; icon: string | null; sort: number };

type Common = { spaceId: string; userId: string; urls: Record<string, string>; onUploaded: (path: string, url: string) => void; onClose: () => void; onSaved: (c?: Cover | null) => void };

// Create or edit a notebook: name, cover and small icon.
export function NotebookDialog({ spaceId, userId, urls, onUploaded, onClose, onSaved, notebook, onDelete }: Common & {
  notebook?: NotebookRow; onDelete?: () => void;
}) {
  const [name, setName] = useState(notebook?.name ?? "");
  const [icon, setIcon] = useState<string | null>(notebook?.icon ?? null);
  const [cover, setCover] = useState<Cover>(notebook ? { kind: notebook.cover_kind as Cover["kind"], value: notebook.cover_value } : { kind: "color", value: DEFAULT_COVER_COLOR });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Give the notebook a name."); return; }
    setBusy(true); setErr(null);
    const res = notebook ? await updateNotebook(spaceId, notebook.id, name, cover, icon) : await createNotebook(spaceId, name, cover, icon);
    setBusy(false);
    if ("error" in res && res.error) { setErr(res.error); return; }
    onSaved();
  };

  return (
    <Dialog title={notebook ? "Edit notebook" : "New notebook"} onClose={onClose} width={560}>
      <form onSubmit={save} className="nbk-form">
        <div>
          <label htmlFor="nbk-name" className="field-label">Name</label>
          <input id="nbk-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <fieldset className="nbk-fs">
          <legend className="field-label">Icon <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional, shown beside the name)</span></legend>
          <div className="nbk-emojis">
            <button type="button" className="nbk-emoji nbk-emoji-none" aria-pressed={icon === null} onClick={() => setIcon(null)}>None</button>
            {COVER_EMOJIS.map((e) => (
              <button key={e} type="button" className="nbk-emoji" aria-pressed={icon === e} aria-label={`Icon ${e}`} onClick={() => setIcon(e)}><span aria-hidden="true">{e}</span></button>
            ))}
          </div>
        </fieldset>
        <fieldset className="nbk-fs">
          <legend className="field-label">Cover</legend>
          <CoverPicker spaceId={spaceId} userId={userId} value={cover} urls={urls} onChange={setCover} onUploaded={onUploaded} />
        </fieldset>
        {err && <p role="alert" className="nbk-err">{err}</p>}
        <div className="nbk-actions">
          {notebook && onDelete && <button type="button" className="btn btn-ghost nbk-danger" onClick={onDelete} disabled={busy}>Delete notebook</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" aria-hidden="true" />} {notebook ? "Save" : "Create notebook"}</button>
        </div>
      </form>
    </Dialog>
  );
}

// Optional banner cover for a single note.
export function NoteCoverDialog({ spaceId, userId, urls, onUploaded, onClose, onSaved, noteId, current }: Common & {
  noteId: string; current: Cover | null;
}) {
  const [cover, setCover] = useState<Cover | null>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const apply = async (c: Cover | null) => {
    setBusy(true); setErr(null);
    const res = await setNoteCover(spaceId, noteId, c);
    setBusy(false);
    if ("error" in res && res.error) { setErr(res.error); return; }
    onSaved(c);
  };
  return (
    <Dialog title="Note cover" onClose={onClose} width={560}>
      <div className="nbk-form">
        <CoverPicker spaceId={spaceId} userId={userId} value={cover ?? { kind: "color", value: DEFAULT_COVER_COLOR }} urls={urls} onChange={setCover} onUploaded={onUploaded} />
        {err && <p role="alert" className="nbk-err">{err}</p>}
        <div className="nbk-actions">
          {current && <button type="button" className="btn btn-ghost nbk-danger" onClick={() => apply(null)} disabled={busy}>Remove cover</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !cover} onClick={() => cover && apply(cover)}>{busy && <Loader2 size={14} className="spin" aria-hidden="true" />} Save cover</button>
        </div>
      </div>
    </Dialog>
  );
}
