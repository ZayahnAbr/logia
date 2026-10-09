"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ClipboardCopy, FileDown, Loader2, Share } from "lucide-react";
import { noteToDocx } from "@/app/export-actions";
import { toast } from "@/components/Toaster";
import { noteBlocksOf } from "./editorBlocks";

// "Export": take this note to Google Docs or Word. Nothing is connected or shared with Google or Microsoft:
// it is a copy, so later edits in either place stay in that place.
export function ExportToDocs({ editor, noteTitle }: { editor: Editor; noteTitle: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); wrap.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", esc); };
  }, [open]);

  // Copy as formatted text: pasting into a Google Doc or Word keeps headings, lists, bold, italic and links.
  const copy = async () => {
    setOpen(false);
    const html = editor.getHTML();
    const text = editor.getText({ blockSeparator: "\n\n" });
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast("Copied. Paste it into a Google Doc or Word document.");
    } catch {
      toast("Couldn't copy. Try the Word file instead.", "error");
    }
  };

  const download = async () => {
    setOpen(false); setBusy(true);
    const res = await noteToDocx(noteTitle, noteBlocksOf(editor));
    setBusy(false);
    if ("error" in res) { toast(res.error, "error"); return; }
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    const a = document.createElement("a"); a.href = url; a.download = res.filename; a.click(); URL.revokeObjectURL(url);
    toast("Downloaded. Open it in Word, or upload it to Google Drive and open it with Google Docs.");
  };

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        title="Take this note to Google Docs or Word" style={{ height: 34, fontSize: 12.5, color: "var(--muted)" }} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Share size={14} aria-hidden="true" />} Export <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Export this note" className="card" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, width: 290, padding: 6, display: "grid", gap: 2 }}>
          <button type="button" role="menuitem" className="btn btn-ghost" onClick={() => void copy()} style={{ height: "auto", justifyContent: "flex-start", textAlign: "left", padding: "9px 10px", alignItems: "flex-start", gap: 10 }}>
            <ClipboardCopy size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
            <span><strong style={{ display: "block", fontSize: 13.5 }}>Copy for Google Docs or Word</strong><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Then paste. Headings, lists and bold come with it.</span></span>
          </button>
          <button type="button" role="menuitem" className="btn btn-ghost" onClick={() => void download()} style={{ height: "auto", justifyContent: "flex-start", textAlign: "left", padding: "9px 10px", alignItems: "flex-start", gap: 10 }}>
            <FileDown size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
            <span><strong style={{ display: "block", fontSize: 13.5 }}>Download a Word file (.docx)</strong><span style={{ fontSize: 12.5, color: "var(--muted)" }}>Opens in Word, or in Google Docs after you upload it to Drive.</span></span>
          </button>
          <p style={{ margin: "4px 10px 6px", fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>This makes a copy. Changes you make later in Docs or Word do not come back here.</p>
        </div>
      )}
    </div>
  );
}
