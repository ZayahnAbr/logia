"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Editor } from "@tiptap/react";
import { ExternalLink, FilePlus2, FileText, Link2, Loader2, Unlink } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { blocksSig, isCalloutNode, merge3, plainBlocks, trimTrailing } from "@/lib/gdocBlocks";
import { applyItems, flatBlocks, readEditor } from "./editorBlocks";
import {
  gdocsCreate, gdocsLink, gdocsNoteLink, gdocsPeek, gdocsPickerToken, gdocsPull, gdocsPush, gdocsStatus, gdocsUnlink,
  type GdocsFail, type GdocsStatus, type NoteLink,
} from "@/app/gdocs-actions";

// Google Docs menu for the note toolbar, and the sync loop that runs while the note is open:
// - about 3 seconds after you stop typing, changed blocks are sent to the document
// - every 45 seconds (and when the note opens) the document's version is checked; if it changed, only the changed
//   blocks are brought into this note through the editor, so everyone editing live sees them
// A block changed on both sides keeps your text and gets the Google Docs text right after it in a marked callout.

const HELP = "Text, headings, lists and simple formatting sync. Pictures, tables and fonts stay where they are.";
const DEBOUNCE_MS = 3000;
const POLL_MS = 45_000;

type SyncState = "idle" | "syncing" | "synced" | "conflict" | "retry" | "error";
type Why = "open" | "edit" | "poll" | "manual";

const flat = flatBlocks;

type PickerWin = { gapi?: { load: (n: string, o: { callback: () => void; onerror: () => void }) => void }; google?: { picker: Record<string, any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
let pickerLoad: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (pickerLoad) return pickerLoad;
  pickerLoad = new Promise<void>((resolve, reject) => {
    const fail = () => { pickerLoad = null; reject(new Error("picker")); };
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js"; s.async = true;
    s.onload = () => { const g = (window as unknown as PickerWin).gapi; if (!g) return fail(); g.load("picker", { callback: () => resolve(), onerror: fail }); };
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return pickerLoad;
}

function pickDoc(token: string, apiKey: string, appId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const g = (window as unknown as PickerWin).google?.picker;
    if (!g) { resolve(null); return; }
    const view = new g.DocsView(g.ViewId.DOCUMENTS).setIncludeFolders(false).setSelectFolderEnabled(false);
    const picker = new g.PickerBuilder()
      .addView(view).setOAuthToken(token).setDeveloperKey(apiKey).setAppId(appId).setTitle("Choose a Google Doc")
      .setCallback((d: { action: string; docs?: { id: string }[] }) => {
        if (d.action === g.Action.PICKED) resolve(d.docs?.[0]?.id ?? null);
        else if (d.action === g.Action.CANCEL) resolve(null);
      }).build();
    picker.setVisible(true);
  });
}

export function GoogleDocsMenu({ editor, noteId, noteTitle, isReady }: { editor: Editor; noteId: string; noteTitle: string; isReady: () => boolean }) {
  const [status, setStatus] = useState<GdocsStatus | null>(null);
  const [link, setLink] = useState<NoteLink | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "pick" | "create" | "unlink">("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [choice, setChoice] = useState<{ docId: string; title: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const linkRef = useRef<NoteLink | null>(null); linkRef.current = link;
  const running = useRef(false);
  const again = useRef<Why | null>(null);
  const backoffUntil = useRef(0);
  const stopped = useRef(false); // set when Google access has ended or the doc is gone
  const readyTries = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, l] = await Promise.all([gdocsStatus(), gdocsNoteLink(noteId)]);
      if (!alive) return;
      setStatus(s); setLink(l.link);
    })();
    return () => { alive = false; };
  }, [noteId]);

  const fail = useCallback((r: GdocsFail) => {
    if (r.code === "rate" || r.code === "busy") { backoffUntil.current = Date.now() + (r.code === "busy" ? 5000 : 60_000); setSync("retry"); setProblem(r.error); return; }
    if (r.code === "reconnect" || r.code === "connect" || r.code === "gone" || r.code === "setup") stopped.current = true;
    setSync("error"); setProblem(r.error);
  }, []);

  const cycle = useCallback(async (why: Why) => {
    const l = linkRef.current;
    if (!l || editor.isDestroyed) return;
    if (stopped.current && why !== "manual") return;
    if (Date.now() < backoffUntil.current && why !== "manual") return;
    if (!isReady()) {
      if (readyTries.current++ < 30) window.setTimeout(() => void cycle(why), 400);
      return;
    }
    if (running.current) { again.current = why; return; }
    running.current = true;
    stopped.current = false;
    try {
      if (readEditor(editor).callouts > 0) { setSync("conflict"); setProblem(null); return; }
      setSync("syncing"); setProblem(null);
      const pulled = await gdocsPull(noteId, false);
      if ("error" in pulled) { fail(pulled); return; }
      if (editor.isDestroyed) return;
      // From here to the editor update there is no waiting, so what we merge is exactly what is on screen.
      const cur = readEditor(editor);
      if (cur.callouts > 0) { setSync("conflict"); return; }
      const local = flat(cur.units);
      const base = pulled.base;

      if (pulled.state === "unchanged") {
        if (blocksSig(local) === blocksSig(base)) { setSync("synced"); return; }
        const r = await gdocsPush(noteId, { desired: local, base: local, revision: null, status: "synced" });
        if ("error" in r) { fail(r); return; }
        setSync("synced");
        return;
      }

      const { items, conflicts } = merge3(base, local, pulled.remote);
      if (!applyItems(editor, items)) { setSync("error"); setProblem("Couldn't bring the changes from Google Docs into this note."); return; }
      if (conflicts > 0) {
        const r = await gdocsPush(noteId, { desired: null, base: pulled.remote, revision: pulled.revision, status: "conflict" });
        if ("error" in r) { fail(r); return; }
        setSync("conflict");
        return;
      }
      const desired = trimTrailing(plainBlocks(items));
      const needPush = blocksSig(desired) !== blocksSig(pulled.remote);
      const r = await gdocsPush(noteId, { desired: needPush ? desired : null, base: desired, revision: pulled.revision, status: "synced" });
      if ("error" in r) { fail(r); return; }
      setSync("synced");
    } catch {
      setSync("error"); setProblem("Couldn't reach Google Docs. Logia will try again.");
    } finally {
      running.current = false;
      const next = again.current; again.current = null;
      if (next && !editor.isDestroyed) window.setTimeout(() => void cycle(next), 800);
    }
  }, [editor, noteId, isReady, fail]);

  // Sync triggers: note open, edits (debounced), and a steady check while the note is open and visible.
  const linked = !!link && !!status?.connected && status.configured;
  useEffect(() => {
    if (!linked) return;
    readyTries.current = 0;
    void cycle("open");
    let t: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => { clearTimeout(t); t = setTimeout(() => void cycle("edit"), DEBOUNCE_MS); };
    editor.on("update", onUpdate);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void cycle("poll"); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void cycle("poll"); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); editor.off("update", onUpdate); window.clearInterval(poll); document.removeEventListener("visibilitychange", onVis); };
  }, [linked, editor, cycle]);

  const syncLabel =
    sync === "syncing" || sync === "idle" ? "Syncing" : sync === "synced" ? "In sync" : sync === "conflict" ? "Changed in both places"
      : sync === "retry" ? "Waiting to try again" : "Not syncing";

  // ── Actions ────────────────────────────────────────────────────────────────

  const noteBlocks = () => flat(readEditor(editor).units);

  const afterLink = (l: NoteLink) => { setLink(l); stopped.current = false; setSync("synced"); setProblem(null); };

  const linkExisting = async () => {
    if (!status?.picker) return;
    setBusy("pick"); setMsg(null);
    try {
      const tok = await gdocsPickerToken();
      if ("error" in tok) { setMsg(tok.error); return; }
      await loadPicker();
      const docId = await pickDoc(tok.token, status.picker.apiKey, status.picker.appId);
      if (!docId) return;
      const peek = await gdocsPeek(docId);
      if ("error" in peek) { setMsg(peek.error); return; }
      const mine = noteBlocks();
      if (mine.length > 0 && peek.blocks > 0) { setChoice({ docId, title: peek.title }); return; }
      await finishLink(docId, mine.length === 0 ? "doc" : "note");
    } catch { setMsg("Couldn't open the Google Docs picker. Check your connection and try again."); }
    finally { setBusy(""); }
  };

  const finishLink = async (docId: string, mode: "doc" | "note") => {
    setBusy("pick"); setMsg(null);
    const res = await gdocsLink(noteId, docId, mode, mode === "note" ? noteBlocks() : undefined, mode === "doc" ? editor.getHTML() : undefined);
    setBusy("");
    if ("error" in res) { setMsg(res.error); return; }
    if (mode === "doc" && !applyItems(editor, res.blocks)) { setMsg("The note is linked, but its text couldn't be updated. Reload the note."); }
    setChoice(null);
    afterLink({ docId, title: res.title, status: "synced", url: `https://docs.google.com/document/d/${docId}/edit` });
    if (res.backedUp) toast(`Linked. Your earlier text is saved as "${res.backedUp}".`, "success");
    else toast("Linked to Google Docs", "success");
  };

  const createDoc = async () => {
    setBusy("create"); setMsg(null);
    const res = await gdocsCreate(noteId, noteTitle, noteBlocks());
    setBusy("");
    if ("error" in res) { setMsg(res.error); return; }
    afterLink({ docId: res.docId, title: res.title, status: "synced", url: res.url });
    toast("Google Doc created", "success");
  };

  const unlink = async () => {
    setBusy("unlink");
    const res = await gdocsUnlink(noteId);
    setBusy(""); setConfirmUnlink(false);
    if (res.error) { setMsg(res.error); return; }
    setLink(null); setSync("idle"); setProblem(null);
    toast("Unlinked. The note and the document both stay as they are.", "success");
  };

  const resolve = (keep: "mine" | "both") => {
    const { state, view } = editor;
    const tr = state.tr;
    const found: { pos: number; size: number; kids: import("@tiptap/pm/model").Node[] }[] = [];
    state.doc.forEach((node, pos) => {
      if (!isCalloutNode(node.toJSON() as never)) return;
      const kids: import("@tiptap/pm/model").Node[] = [];
      node.forEach((c, _o, i) => { if (i > 0) kids.push(c); });
      found.push({ pos, size: node.nodeSize, kids });
    });
    for (const f of found.reverse()) {
      if (keep === "mine" || f.kids.length === 0) tr.delete(f.pos, f.pos + f.size);
      else tr.replaceWith(f.pos, f.pos + f.size, f.kids);
    }
    view.dispatch(tr);
    setSync("syncing");
    window.setTimeout(() => void cycle("manual"), 300);
  };

  const buttonText = link ? `Google Docs: ${syncLabel}` : "Google Docs";

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => { setOpen(true); setMsg(null); setConfirmUnlink(false); }}
        aria-haspopup="dialog" title="Google Docs" style={{ height: 34, fontSize: 12.5, color: link && sync === "conflict" ? "var(--amber)" : "var(--muted)" }}>
        {sync === "syncing" && link ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />} {buttonText}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{link ? syncLabel : ""}</span>

      {open && !choice && (
        <Dialog title="Google Docs" onClose={() => setOpen(false)} width={460}>
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>{HELP} Syncing runs while this note is open.</p>

            {status === null && <p style={{ margin: 0 }}>Loading</p>}

            {status !== null && !status.configured && (
              <p style={{ margin: 0 }} role="status">Google Docs isn&apos;t set up for this app yet. An administrator needs to finish setup first.</p>
            )}

            {status !== null && status.configured && !status.connected && (
              <p style={{ margin: 0 }}>
                Connect your Google account first. <Link href="/spaces/settings#connections" className="btn btn-sm" style={{ marginLeft: 6 }}>Open Settings</Link>
              </p>
            )}

            {status !== null && status.configured && status.connected && !link && (
              <div style={{ display: "grid", gap: 10 }}>
                <button type="button" className="btn" onClick={linkExisting} disabled={busy !== "" || !status.picker} style={{ justifyContent: "flex-start" }}>
                  {busy === "pick" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />} Link to a Google Doc
                </button>
                {!status.picker && <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }} role="status">Choosing an existing document isn&apos;t set up for this app yet. You can still create a new Google Doc from this note.</p>}
                <button type="button" className="btn" onClick={createDoc} disabled={busy !== ""} style={{ justifyContent: "flex-start" }}>
                  {busy === "create" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FilePlus2 size={14} aria-hidden="true" />} Create a Google Doc from this note
                </button>
              </div>
            )}

            {link && (
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <strong style={{ display: "block", fontSize: 14 }}>{link.title}</strong>
                  <span role="status" aria-live="polite" style={{ fontSize: 13, color: sync === "conflict" ? "var(--amber)" : "var(--muted)" }}>{syncLabel}</span>
                  {problem && <span role="alert" style={{ display: "block", fontSize: 12.5, color: "var(--amber)", marginTop: 4 }}>{problem}</span>}
                </div>
                {sync === "conflict" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
                      Some text changed here and in Google Docs. Your version is kept, with the Google Docs version just after it in a box labelled &quot;{`Version from Google Docs`}&quot;.
                      Delete the one you don&apos;t want. Syncing is paused until the boxes are gone.
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-sm" onClick={() => { resolve("mine"); setOpen(false); }}>Keep my versions</button>
                      <button type="button" className="btn btn-sm" onClick={() => { resolve("both"); setOpen(false); }}>Keep both as normal text</button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open in Google Docs<span className="sr-only"> (opens in a new tab)</span></a>
                  <button type="button" className="btn" onClick={() => void cycle("manual")} disabled={busy !== "" || sync === "syncing"}>Sync now</button>
                  {confirmUnlink ? (
                    <>
                      <button type="button" className="btn st-danger" onClick={unlink} disabled={busy !== ""}>
                        {busy === "unlink" && <Loader2 size={14} className="spin" aria-hidden="true" />} Yes, unlink
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmUnlink(false)}>Keep linked</button>
                    </>
                  ) : (
                    <button type="button" className="btn st-danger" onClick={() => setConfirmUnlink(true)} disabled={busy !== ""}><Unlink size={14} aria-hidden="true" /> Unlink</button>
                  )}
                </div>
                {confirmUnlink && <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Unlinking keeps the note and the document exactly as they are. They just stop updating each other.</p>}
              </div>
            )}

            {msg && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--amber)" }}>{msg}</p>}
          </div>
        </Dialog>
      )}

      {choice && (
        <Dialog title="Which text should you start from?" onClose={() => { setChoice(null); }} width={480}>
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
              Both this note and &quot;{choice.title}&quot; already have text. Choose which one to start from. Nothing is lost: your note&apos;s text is saved as a copy, and Google Docs keeps its own version history.
            </p>
            <button type="button" className="btn" disabled={busy !== ""} onClick={() => void finishLink(choice.docId, "doc")} style={{ justifyContent: "flex-start", height: "auto", padding: "10px 14px", textAlign: "left" }}>
              Use the Google Doc&apos;s text here. This note&apos;s current text is saved as a separate copy first.
            </button>
            <button type="button" className="btn" disabled={busy !== ""} onClick={() => void finishLink(choice.docId, "note")} style={{ justifyContent: "flex-start", height: "auto", padding: "10px 14px", textAlign: "left" }}>
              Use this note&apos;s text in the Google Doc. The document&apos;s earlier text stays in its version history.
            </button>
            {busy !== "" && <p role="status" style={{ margin: 0 }}><Loader2 size={14} className="spin" aria-hidden="true" /> Linking</p>}
            {msg && <p role="alert" style={{ margin: 0, color: "var(--amber)" }}>{msg}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
