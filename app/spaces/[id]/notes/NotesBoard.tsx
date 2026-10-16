"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createNote, updateNote, deleteNote, generateCardsFromNote, generateCardFromSelection, generateRecallPrompts } from "@/app/actions";
import { RichEditor } from "./RichEditor";
import { InkCanvas, isInk, parseInk, blankInk } from "./InkCanvas";
import { ExportButtons } from "@/components/ExportButtons";
import { ShareButton } from "@/components/ShareSheet";

// Minimal Tiptap-HTML → Markdown for downloads/backups.
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

function htmlToMarkdown(title: string, html: string) {
  const md = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<(strong|b)>(.*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)>(.*?)<\/\1>/gi, "*$2*")
    .replace(/<s>(.*?)<\/s>/gi, "~~$1~~")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, "![]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `# ${title || "Untitled note"}\n\n${md}\n`;
}
import { NoteChat } from "./NoteChat";
import { Plus, Trash2, X, Loader2, MessageCircle, Layers, Brain, PenTool, Maximize2, Minimize2, Search, BookOpen, ArrowLeft, ChevronLeft, ChevronRight, Pencil, ImagePlus, ZoomIn, ZoomOut } from "lucide-react";
import { moveNoteToNotebook, deleteNotebook, reorderNotebooks } from "@/app/notebook-actions";
import { CoverArt } from "@/components/NotebookCover";
import { NotebookDialog, NoteCoverDialog, type NotebookRow } from "./NotebookDialog";
import { parseCover, type Cover } from "@/lib/notebookCovers";

type Note = { id: string; title: string; body: string; folder: string; updated_at: string; notebook_id: string | null; cover_kind: string | null; cover_value: string | null };

export function NotesBoard({ spaceId, userId, notes, notebooks, notebooksReady, coverUrls }: {
  spaceId: string; userId: string; notes: Note[]; notebooks: NotebookRow[]; notebooksReady: boolean; coverUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [active, setActive] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [genDeck, setGenDeck] = useState<string | null>(null);
  const [makingFlashcard, setMakingFlashcard] = useState(false);
  const [recallPrompts, setRecallPrompts] = useState<string[] | null>(null);
  const [recallLoading, setRecallLoading] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const ink = isInk(body);
  const textBody = ink ? (parseInk(body).text ? `<p>${parseInk(body).text}</p>` : "") : body;

  const makeFlashcards = async () => {
    if (ink && !textBody) { setGenMsg("Use Convert to text first, so Logia can read your handwriting."); setGenDeck(null); return; }
    setGenerating(true);
    setGenMsg(null); setGenDeck(null);
    const res = await generateCardsFromNote(spaceId, title, textBody);
    setGenerating(false);
    if ("error" in res && res.error) { setGenMsg(res.error); return; }
    setGenMsg(`Created ${res.count} flashcards from this note.`);
    setGenDeck(res.deckId ?? null);
  };

  const makeFlashcardFromSelection = async (selectedText: string) => {
    if (!active || !selectedText.trim()) return;
    setMakingFlashcard(true);
    setGenMsg(null);
    const res = await generateCardFromSelection(spaceId, active.id, title, selectedText);
    setMakingFlashcard(false);
    setGenMsg("error" in res && res.error ? res.error : `Flashcard created. Find it in "${title || "Untitled note"} · highlights".`);
  };

  const testYourself = async () => {
    setRecallLoading(true);
    setRecallError(null);
    setRecallPrompts(null);
    const res = await generateRecallPrompts(textBody);
    setRecallLoading(false);
    if ("error" in res && res.error) setRecallError(res.error);
    else setRecallPrompts(res.questions ?? []);
  };

  // Notebooks: "shelf" is the top level, "loose" is notes without a notebook, otherwise a notebook id.
  const [view, setView] = useState<string>("shelf");
  const [books, setBooks] = useState<NotebookRow[]>(notebooks);
  useEffect(() => setBooks(notebooks), [notebooks]);
  const [urls, setUrls] = useState<Record<string, string>>(coverUrls);
  useEffect(() => setUrls((u) => ({ ...u, ...coverUrls })), [coverUrls]);
  const addUrl = (path: string, url: string) => setUrls((u) => ({ ...u, [path]: url }));
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // polite status line
  const [dropOn, setDropOn] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [moved, setMoved] = useState<Record<string, string | null>>({}); // optimistic notebook moves
  const [coverOv, setCoverOv] = useState<Record<string, Cover | null>>({}); // optimistic note covers
  const nbOf = (n: Note) => (n.id in moved ? moved[n.id] : n.notebook_id);
  const bookById = (id: string | null) => books.find((b) => b.id === id) ?? null;
  const coverOf = (n: Note): Cover | null => (n.id in coverOv ? coverOv[n.id] : n.cover_kind && n.cover_value ? { kind: n.cover_kind as Cover["kind"], value: n.cover_value } : null);
  const countIn = (id: string | null) => notes.filter((n) => nbOf(n) === id).length;
  const textOf = (n: Note) => {
    const raw = isInk(n.body) ? (parseInk(n.body).text ?? "") : n.body;
    return raw.replace(/<\/(p|h[1-6]|li|div)>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  };
  const needle = q.trim().toLowerCase();
  const inView = (n: Note) => view === "shelf" || (view === "loose" ? nbOf(n) === null : nbOf(n) === view);
  const filtered = notes.filter((n) => inView(n)
    && (!needle || (n.title || "").toLowerCase().includes(needle) || textOf(n).toLowerCase().includes(needle)));
  const viewBook = view !== "shelf" && view !== "loose" ? bookById(view) : null;
  const viewName = view === "loose" ? "Loose notes" : viewBook?.name ?? "";
  // If the open notebook was deleted elsewhere, fall back to the shelf.
  useEffect(() => { if (view !== "shelf" && view !== "loose" && !books.some((b) => b.id === view)) setView("shelf"); }, [books, view]);

  const moveTo = async (n: Note, nbId: string | null) => {
    if (nbOf(n) === nbId) return;
    setMoved((m) => ({ ...m, [n.id]: nbId }));
    const res = await moveNoteToNotebook(spaceId, n.id, nbId);
    if (res && "error" in res && res.error) { setMoved((m) => { const c = { ...m }; delete c[n.id]; return c; }); setNote(res.error); return; }
    setNote(`Moved to ${nbId ? bookById(nbId)?.name ?? "the notebook" : "Loose notes"}.`);
    router.refresh();
  };
  const onDropBook = (e: React.DragEvent, nbId: string | null) => {
    e.preventDefault(); setDropOn(null);
    const n = notes.find((x) => x.id === e.dataTransfer.getData("text/note-id"));
    if (n) void moveTo(n, nbId);
  };

  const shift = async (id: string, dir: -1 | 1) => {
    const i = books.findIndex((b) => b.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= books.length) return;
    const next = [...books]; [next[i], next[j]] = [next[j], next[i]];
    setBooks(next);
    setNote(`${books[i].name} moved ${dir < 0 ? "earlier" : "later"}.`);
    const res = await reorderNotebooks(spaceId, next.map((b) => b.id));
    if (res && "error" in res && res.error) { setBooks(books); setNote(res.error); return; }
    router.refresh();
  };

  const removeBook = async (b: NotebookRow) => {
    const c = countIn(b.id);
    const msg = c > 0
      ? `Delete the notebook "${b.name}"? Its ${c} note${c === 1 ? "" : "s"} will move to Loose notes. The notes are not deleted.`
      : `Delete the empty notebook "${b.name}"?`;
    if (!window.confirm(msg)) return;
    const res = await deleteNotebook(spaceId, b.id);
    if (res && "error" in res && res.error) { setNote(res.error); return; }
    setDialog(null);
    if (view === b.id) setView("shelf");
    setMoved((m) => ({ ...Object.fromEntries(notes.filter((n) => nbOf(n) === b.id).map((n) => [n.id, null])), ...m }));
    setNote(`Deleted ${b.name}. ${c} note${c === 1 ? "" : "s"} moved to Loose notes.`);
    router.refresh();
  };

  // Opening a note adds a browser history entry (?note=<id>), so the browser's and the phone's own back
  // button return to the notes list instead of leaving the page. Switching notes replaces that entry.
  const pushedRef = useRef(false);
  const openNote = (note: Note, fromUrl = false) => {
    if (!fromUrl) {
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.get("note") !== note.id) {
          u.searchParams.set("note", note.id);
          window.history[pushedRef.current ? "replaceState" : "pushState"](null, "", u.pathname + u.search + u.hash);
          pushedRef.current = true;
        }
      } catch { /* history unavailable */ }
    }
    void flush();
    setActive(note); setTitle(note.title); setBody(note.body); setSaved(true);
    setRecallPrompts(null); setRecallError(null); setGenMsg(null);
  };

  // Latest unsaved edit, so closing, switching tabs or locking the iPad never drops it.
  const unsaved = useRef<{ id: string; t: string; b: string } | null>(null);
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const p = unsaved.current;
    if (!p) return;
    unsaved.current = null;
    await updateNote(spaceId, p.id, p.t, p.b);
    setSaved(true);
  }, [spaceId]);

  const autoSave = useCallback((t: string, b: string) => {
    if (!active) return;
    unsaved.current = { id: active.id, t, b };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => { await flush(); router.refresh(); }, 1200);
  }, [active, flush, router]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flush); };
  }, [flush]);

  const closeNote = async () => { await exitFull(); await flush(); setActive(null); router.refresh(); };
  // Back out of a note to the general notes page (the shelf of notebooks), and drop ?note= from the URL
  // so a refresh doesn't reopen the note.
  const backToNotes = async () => {
    setView("shelf"); setQ("");
    // We added a history entry when the note opened: go back through it so Forward/Back stay sensible.
    if (pushedRef.current) { window.history.back(); return; }
    try { const u = new URL(window.location.href); if (u.searchParams.has("note")) { u.searchParams.delete("note"); window.history.replaceState(null, "", u.pathname + u.search + u.hash); } } catch { /* ignore */ }
    await closeNote();
  };

  // Full screen: the browser's Fullscreen API where available, plus a CSS fallback (iPhone Safari).
  const shellRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  // Page zoom, remembered per device. 100% is the normal size.
  const [zoom, setZoom] = useState(100);
  useEffect(() => { try { const z = Number(localStorage.getItem("logia.note.zoom")); if (z >= ZOOM_MIN && z <= ZOOM_MAX) setZoom(z); } catch { /* storage blocked */ } }, []);
  const setZoomSafe = (z: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / 10) * 10));
    setZoom(next);
    try { localStorage.setItem("logia.note.zoom", String(next)); } catch { /* storage blocked */ }
  };
  const exitFull = async () => { setFull(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); };
  const toggleFull = async () => {
    if (full) return exitFull();
    setFull(true);
    try { await shellRef.current?.requestFullscreen?.(); } catch { /* CSS fallback stays on */ }
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && full && !document.fullscreenElement) setFull(false); };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onChange); window.removeEventListener("keydown", onKey); };
  }, [full]);

  const onTitleChange = (t: string) => { setTitle(t); setSaved(false); autoSave(t, body); };
  const onBodyChange = (b: string) => { setBody(b); setSaved(false); autoSave(title, b); };

  const createNew = () => start(async () => {
    const nbId = viewBook ? viewBook.id : null;
    const folderName = viewBook ? viewBook.name : "General";
    const res = await createNote(spaceId, folderName, "Untitled note", "", nbId);
    if (res.id) { openNote({ id: res.id, title: "Untitled note", body: "", folder: folderName, updated_at: new Date().toISOString(), notebook_id: nbId, cover_kind: null, cover_value: null }); router.refresh(); }
    else if ("error" in res && res.error) setNote(res.error);
  });

  // A blank handwriting page (Apple Pencil, stylus, finger or mouse). Opens straight away.
  const createPage = () => start(async () => {
    const nbId = viewBook ? viewBook.id : null;
    const folderName = viewBook ? viewBook.name : "General";
    const body = blankInk();
    const res = await createNote(spaceId, folderName, "Handwritten page", body, nbId);
    if (res.id) { openNote({ id: res.id, title: "Handwritten page", body, folder: folderName, updated_at: new Date().toISOString(), notebook_id: nbId, cover_kind: null, cover_value: null }); router.refresh(); }
    else if ("error" in res && res.error) setNote(res.error);
  });

  const remove = (id: string) => start(async () => {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    await deleteNote(spaceId, id);
    if (active?.id === id) setActive(null);
    router.refresh();
  });

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Deep link: /notes?note=<id> opens that note (used by shared links).
  // Re-checks when the notes list changes, so a note that was only just created (e.g. from a lecture
  // transcript) still opens if the first render had a stale list.
  const deepLinked = useRef(false);
  // Browser/phone Back and Forward: no ?note= means the list, a note id means that note.
  const popRef = useRef<() => void>(() => {});
  popRef.current = () => {
    const id = new URLSearchParams(window.location.search).get("note");
    if (!id) { pushedRef.current = false; setView("shelf"); setQ(""); void closeNote(); return; }
    const n = notes.find((x) => x.id === id);
    if (n) openNote(n, true);
  };
  useEffect(() => {
    const on = () => popRef.current();
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  useEffect(() => {
    if (deepLinked.current) return;
    const id = new URLSearchParams(window.location.search).get("note");
    const n = id && notes.find((x) => x.id === id);
    if (n) { deepLinked.current = true; openNote(n, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const plain = (html: string) => {
    const d = document.createElement("div"); d.innerHTML = html.replace(/<\/(p|h[1-6]|li)>/g, "\n");
    const t = (d.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    return t.length > 1500 ? t.slice(0, 1500) + "…" : t;
  };

  const dialogsEl = (
    <>
      {dialog && (
        <NotebookDialog spaceId={spaceId} userId={userId} urls={urls} onUploaded={addUrl}
          notebook={dialog.mode === "edit" ? bookById(dialog.id) ?? undefined : undefined}
          onDelete={dialog.mode === "edit" ? () => { const b = bookById(dialog.id); if (b) void removeBook(b); } : undefined}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setNote(dialog.mode === "edit" ? "Notebook saved." : "Notebook created."); router.refresh(); }} />
      )}
      {coverFor && (
        <NoteCoverDialog spaceId={spaceId} userId={userId} urls={urls} onUploaded={addUrl} noteId={coverFor}
          current={(() => { const n = notes.find((x) => x.id === coverFor) ?? (active?.id === coverFor ? active : null); return n ? coverOf(n) : null; })()}
          onClose={() => setCoverFor(null)}
          onSaved={(c) => { setCoverOv((m) => ({ ...m, [coverFor]: c ?? null })); setCoverFor(null); router.refresh(); }} />
      )}
      <p role="status" className="sr-only">{note}</p>
    </>
  );

  if (active) {
    return (
      <div className="ln-split ln-notes is-editing ln-h">
      <aside className="ln-side" aria-label="Notes list">
        <div className="ln-side-head">
          <div className="nb-search">
            <Search size={15} aria-hidden="true" />
            <label htmlFor="nb-q2" className="sr-only">Search notes</label>
            <input id="nb-q2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" />
          </div>
          <label className="sr-only" htmlFor="nb-folder-sel">Notebook</label>
          <select id="nb-folder-sel" className="ln-select" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="shelf">All notes</option>
            <option value="loose">Loose notes</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.icon ? `${b.icon} ` : ""}{b.name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={createNew} disabled={pending} style={{ height: 36 }}>
            {pending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} New note
          </button>
        </div>
        <ul className="ln-side-list">
          {filtered.length === 0 && <li className="ln-item-s" style={{ padding: 12 }}>{needle ? "No notes match your search." : "No notes in this notebook."}</li>}
          {filtered.map((n) => (
            <li key={n.id}>
              <button type="button" className="ln-item" aria-current={n.id === active.id} onClick={() => n.id !== active.id && openNote(n)}>
                <span className="ln-item-t">{n.title || "Untitled note"}</span>
                <span className="ln-item-s">{new Date(n.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{isInk(n.body) ? " · Handwritten" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="ln-main">
      <div ref={shellRef} className={`doc-shell${full ? " is-full" : ""}`}>
        {/* Toolbar */}
        <div className="doc-bar no-print">
          <button className="btn" onClick={backToNotes} style={{ height: 34 }}><ArrowLeft size={15} aria-hidden="true" /> All notes</button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--faint)" }}>{saved ? "Saved" : "Saving…"}</span>
          <ExportButtons filename={title} markdown={() => htmlToMarkdown(title, textBody)} />
          <ShareButton className="btn btn-ghost" note="The text is sent as-is. The link only opens for members of this space."
            get={async () => ({ title: title || "Untitled note", text: plain(textBody), url: `${window.location.origin}/spaces/${spaceId}/notes?note=${active.id}` })} />
          <button className="btn btn-ghost" onClick={makeFlashcards} disabled={generating} style={{ height: 34 }}>
            {generating ? <><Loader2 size={15} className="spin" /> Generating…</> : <><Layers size={15} /> Make flashcards</>}
          </button>
          <button className="btn btn-ghost" onClick={() => setChatOpen((o) => !o)} style={{ height: 34 }}>
            <MessageCircle size={15} /> Ask
          </button>
          <div className="doc-zoom" role="group" aria-label="Zoom">
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setZoomSafe(zoom - 10)} disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out" title="Zoom out"><ZoomOut size={15} /></button>
            <button type="button" className="doc-zoom-val" onClick={() => setZoomSafe(100)} title="Back to 100%"
              aria-label={`Zoom ${zoom} percent. Press to reset to 100 percent`}>{zoom}%</button>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setZoomSafe(zoom + 10)} disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in" title="Zoom in"><ZoomIn size={15} /></button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={toggleFull} aria-pressed={full} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen (Esc)" : "Full screen"} style={{ height: 34, width: 34 }}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>

        {genMsg && (
          <div role="status" className="no-print" style={{ padding: "10px 24px", fontSize: 14, color: "var(--text)", background: "var(--surface-2)", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 200 }}>{genMsg}{genDeck && " Try answering each one out loud."}</span>
            {genDeck && <a href={`/spaces/${spaceId}/decks/${genDeck}`} className="btn btn-primary btn-sm">Study them now</a>}
          </div>
        )}

        {/* Editor */}
        <div className={`doc-canvas${ink ? " ink-scroll" : ""}`} style={{ ["--doc-zoom" as string]: zoom / 100 }}>
          <div className={`doc-page note-print${ink ? " is-ink" : ""}`}>
          {(() => {
            const cv = coverOf(active);
            const pc = parseCover(cv);
            return cv ? (
              <div className="nbk-banner">
                <CoverArt cover={cv} imageUrl={pc?.path ? urls[pc.path] : null} />
                <button type="button" className="btn btn-sm nbk-banner-btn no-print" onClick={() => setCoverFor(active.id)}><ImagePlus size={13} aria-hidden="true" /> Change cover</button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm nbk-addcover no-print" onClick={() => setCoverFor(active.id)}><ImagePlus size={13} aria-hidden="true" /> Add cover</button>
            );
          })()}
          <input
            className="note-title"
            placeholder="Untitled note"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
          {ink ? (
            <InkCanvas key={active.id} value={body} onChange={onBodyChange} />
          ) : (
            <RichEditor
              key={active.id}
              noteId={active.id}
              noteTitle={title}
              value={body}
              onChange={onBodyChange}
              spaceId={spaceId}
              onMakeFlashcard={makeFlashcardFromSelection}
              makingFlashcard={makingFlashcard}
            />
          )}
          </div>

          <div className="doc-extra no-print">
            <button className="btn btn-ghost" onClick={testYourself} disabled={recallLoading}>
              {recallLoading ? <><Loader2 size={14} className="spin" /> Thinking of questions…</> : <><Brain size={14} /> Test yourself on this page</>}
            </button>
            {recallError && <div style={{ color: "var(--amber)", fontSize: 12.5, marginTop: 10 }}>{recallError}</div>}
            {recallPrompts && recallPrompts.length > 0 && (
              <ol style={{ marginTop: 14, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {recallPrompts.map((q, i) => (
                  <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text)" }}>{q}</li>
                ))}
              </ol>
            )}
            {recallPrompts && (
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
                Not graded. Use these to test yourself before you move on.
              </div>
            )}
          </div>
        </div>

        {chatOpen && (
          <NoteChat key={active.id} spaceId={spaceId} noteId={active.id} noteTitle={title} noteBody={textBody} onClose={() => setChatOpen(false)} />
        )}
      </div>
      </div>
      {dialogsEl}
      </div>
    );
  }

  const searching = view === "shelf" && needle.length > 0;
  const showShelf = view === "shelf" && !searching;

  const card = (n: Note) => {
    const ink = isInk(n.body);
    const text = textOf(n).trim();
    const cv = coverOf(n);
    const pc = parseCover(cv);
    const nb = bookById(nbOf(n));
    return (
      <li key={n.id} className="nb-doc" draggable
        onDragStart={(e) => { e.dataTransfer.setData("text/note-id", n.id); e.dataTransfer.effectAllowed = "move"; }}>
        <button type="button" className="nb-page" onClick={() => openNote(n)} aria-label={`Open ${n.title || "Untitled note"}`}>
          <span className="nb-sheet" aria-hidden="true">
            {cv && <span className="nbk-card-cover"><CoverArt cover={cv} imageUrl={pc?.path ? urls[pc.path] : null} /></span>}
            <span className="nb-sheet-title">{n.title || "Untitled note"}</span>
            {ink && !text ? <span className="nb-ink"><i /><i /><i /><i /></span> : <span className="nb-sheet-text">{text.slice(0, 420) || "Empty page"}</span>}
          </span>
        </button>
        <div className="nb-meta">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{n.title || "Untitled note"}</div>
            <div className="truncate" style={{ fontSize: 12, color: "var(--faint)" }}>{ink ? "Handwritten · " : ""}{new Date(n.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{searching ? ` · ${nb ? nb.name : "Loose notes"}` : ""}</div>
          </div>
          <label className="nb-move" title="Move to notebook">
            <span className="sr-only">Move {n.title || "note"} to notebook</span>
            <BookOpen size={14} aria-hidden="true" />
            <select value={nbOf(n) ?? ""} onChange={(e) => moveTo(n, e.target.value || null)}>
              <option value="">Loose notes</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete ${n.title || "note"}`} onClick={() => remove(n.id)}><Trash2 size={13} /></button>
        </div>
      </li>
    );
  };

  const looseCount = countIn(null);

  return (
    <div className="ln-notes-grid nbk-root">
      <div className="nb-bar">
        <div className="nb-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="nb-q" className="sr-only">Search notes</label>
          <input id="nb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === "shelf" ? "Search all notes" : `Search ${viewName}`} />
          {q && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}
        </div>
        {showShelf && notebooksReady && (
          <button className="btn" onClick={() => setDialog({ mode: "create" })} style={{ height: 38 }}>
            <Plus size={14} aria-hidden="true" /> New notebook
          </button>
        )}
        <button className="btn" onClick={createPage} disabled={pending} style={{ height: 38 }} title="A blank page to write on with an Apple Pencil or stylus">
          <PenTool size={14} aria-hidden="true" /> Blank page
        </button>
        <button className="btn btn-primary" onClick={createNew} disabled={pending} style={{ height: 38 }}>
          {pending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} New note
        </button>
      </div>

      {!notebooksReady && (
        <p className="nbk-warn" role="note">Notebooks need one database update before they work. Until then your notes show as loose notes. Run migration 26 in Supabase.</p>
      )}

      {(view !== "shelf" || searching) && (
        <div className="nbk-crumb">
          <button type="button" className="btn btn-sm" onClick={() => { setView("shelf"); setQ(""); }}><ArrowLeft size={14} aria-hidden="true" /> Back to notebooks</button>
          {searching ? (
            <>
              <h2 className="nbk-crumb-t">Search results</h2>
              <span className="nbk-crumb-n">{filtered.length} note{filtered.length === 1 ? "" : "s"}</span>
            </>
          ) : (
            <>
              <h2 className="nbk-crumb-t">{viewBook?.icon && <span aria-hidden="true">{viewBook.icon} </span>}{viewName}</h2>
              <span className="nbk-crumb-n">{countIn(view === "loose" ? null : view)} note{countIn(view === "loose" ? null : view) === 1 ? "" : "s"}</span>
              {viewBook && <button type="button" className="btn btn-sm" onClick={() => setDialog({ mode: "edit", id: viewBook.id })}><Pencil size={13} aria-hidden="true" /> Edit notebook</button>}
            </>
          )}
        </div>
      )}

      {showShelf && (
        <section aria-label="Notebooks">
          <ul className="nbk-shelf">
            {books.map((b, i) => {
              const pc = parseCover({ kind: b.cover_kind, value: b.cover_value });
              const c = countIn(b.id);
              return (
                <li key={b.id} className={`nbk-item${dropOn === b.id ? " is-drop" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDropOn(b.id); }} onDragLeave={() => setDropOn(null)} onDrop={(e) => onDropBook(e, b.id)}>
                  <button type="button" className="nbk-open" onClick={() => setView(b.id)} aria-label={`Open ${b.name}, ${c} note${c === 1 ? "" : "s"}`}>
                    <span className="nbk-book" aria-hidden="true">
                      <span className="nbk-spine" />
                      <span className="nbk-art"><CoverArt cover={{ kind: b.cover_kind, value: b.cover_value }} imageUrl={pc?.path ? urls[pc.path] : null} /></span>
                      {b.icon && <span className="nbk-badge">{b.icon}</span>}
                    </span>
                  </button>
                  <div className="nbk-label">
                    <div className="nbk-name" title={b.name}>{b.name}</div>
                    <div className="nbk-count">{c} note{c === 1 ? "" : "s"}</div>
                  </div>
                  <div className="nbk-tools">
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => shift(b.id, -1)} aria-label={`Move ${b.name} earlier`}><ChevronLeft size={15} /></button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === books.length - 1} onClick={() => shift(b.id, 1)} aria-label={`Move ${b.name} later`}><ChevronRight size={15} /></button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setDialog({ mode: "edit", id: b.id })} aria-label={`Edit ${b.name}`}><Pencil size={14} /></button>
                  </div>
                </li>
              );
            })}
            <li className={`nbk-item${dropOn === "loose" ? " is-drop" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDropOn("loose"); }} onDragLeave={() => setDropOn(null)} onDrop={(e) => onDropBook(e, null)}>
              <button type="button" className="nbk-open" onClick={() => setView("loose")} aria-label={`Open Loose notes, ${looseCount} note${looseCount === 1 ? "" : "s"}`}>
                <span className="nbk-book nbk-loose" aria-hidden="true">
                  <span className="nbk-stack"><i /><i /><i /></span>
                </span>
              </button>
              <div className="nbk-label">
                <div className="nbk-name">Loose notes</div>
                <div className="nbk-count">{looseCount} note{looseCount === 1 ? "" : "s"}</div>
              </div>
            </li>
            {notebooksReady && (
              <li className="nbk-item">
                <button type="button" className="nbk-open" onClick={() => setDialog({ mode: "create" })} aria-label="New notebook">
                  <span className="nbk-book nbk-new" aria-hidden="true"><Plus size={26} /></span>
                </button>
                <div className="nbk-label"><div className="nbk-name">New notebook</div></div>
              </li>
            )}
          </ul>
          {notes.length === 0 && books.length === 0 && (
            <div className="empty card" style={{ marginTop: 18 }}><strong>No notes yet.</strong> Create a notebook for each subject, or use <strong>New note</strong> above. Any note can become flashcards in one click.</div>
          )}
        </section>
      )}

      {!showShelf && (filtered.length === 0 ? (
        <div className="empty card">{needle
          ? <><strong>No notes match “{q}”.</strong> Try a different word{view !== "shelf" ? ", or go back to all notebooks to search everything" : ""}.</>
          : <><strong>{view === "loose" ? "No loose notes." : "This notebook is empty."}</strong> Use <strong>New note</strong> above to add one{view !== "loose" ? ", or move notes in from another notebook" : ""}.</>}</div>
      ) : (
        <ul className="nb-grid">{filtered.map(card)}</ul>
      ))}
      {dialogsEl}
    </div>
  );
}
