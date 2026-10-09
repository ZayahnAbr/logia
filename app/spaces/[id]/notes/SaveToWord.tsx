"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Editor } from "@tiptap/react";
import { ExternalLink, FileDown, Loader2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { saveNoteToOneDrive, onedriveStatus, type OneDriveStatus } from "@/app/onedrive-actions";
import type { DriveFile } from "@/lib/server/onedrive";
import { noteBlocksOf } from "./editorBlocks";

// "Save to OneDrive as Word": a one-way copy of this note as a .docx in the OneDrive "Logia" folder.
export function SaveToWord({ editor, noteTitle }: { editor: Editor; noteTitle: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState<DriveFile | null>(null);
  const [saved, setSaved] = useState<DriveFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    onedriveStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [open]);

  const save = async (replace: boolean) => {
    setBusy(true); setErr(null);
    const res = await saveNoteToOneDrive(noteTitle, noteBlocksOf(editor), replace);
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    if (res.state === "exists") { setExists(res.file); return; }
    setExists(null); setSaved(res.file);
  };

  const close = () => { setOpen(false); setExists(null); setSaved(null); setErr(null); };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Save to OneDrive as Word"
        style={{ height: 34, fontSize: 12.5, color: "var(--muted)" }}>
        <FileDown size={14} aria-hidden="true" /> Word
      </button>
      {open && (
        <Dialog title="Save as a Word file" onClose={close} width={460}>
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
              Saves a copy of this note to OneDrive as a Word file, in a folder called Logia. Headings, lists and simple formatting are included; pictures are not.
              Edits made in Word are not brought back into this note automatically.
            </p>

            {status === null && <p style={{ margin: 0 }}>Loading</p>}
            {status !== null && !status.configured && <p style={{ margin: 0 }} role="status">OneDrive isn&apos;t set up for this app yet. An administrator needs to finish setup first.</p>}
            {status !== null && status.configured && !status.connected && (
              <p style={{ margin: 0 }}>Connect OneDrive first. <Link href="/spaces/settings#connections" className="btn btn-sm" style={{ marginLeft: 6 }}>Open Settings</Link></p>
            )}

            {status?.connected && status.configured && !saved && !exists && (
              <button type="button" className="btn btn-primary" onClick={() => void save(false)} disabled={busy} style={{ justifySelf: "start" }}>
                {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileDown size={14} aria-hidden="true" />} Save to OneDrive as Word
              </button>
            )}

            {exists && (
              <div style={{ display: "grid", gap: 10 }} role="alertdialog" aria-label="Replace the existing file">
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                  &quot;{exists.name}&quot; is already in your Logia folder in OneDrive. Replacing it overwrites that file with this version of the note, including any edits you made to it in Word.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn st-danger" onClick={() => void save(true)} disabled={busy}>
                    {busy && <Loader2 size={14} className="spin" aria-hidden="true" />} Replace the file
                  </button>
                  <button type="button" className="btn" onClick={() => setExists(null)} disabled={busy}>Cancel</button>
                </div>
              </div>
            )}

            {saved && (
              <div style={{ display: "grid", gap: 10 }}>
                <p role="status" style={{ margin: 0, fontSize: 13.5 }}>Saved as &quot;{saved.name}&quot; in your Logia folder in OneDrive.</p>
                {saved.webUrl && <a className="btn" href={saved.webUrl} target="_blank" rel="noopener noreferrer" style={{ justifySelf: "start" }}><ExternalLink size={14} aria-hidden="true" /> Open in Word<span className="sr-only"> (opens in a new tab)</span></a>}
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Saving again will ask before it replaces this file. Edits made in Word stay in Word.</p>
              </div>
            )}

            {err && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--amber)" }}>{err}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
