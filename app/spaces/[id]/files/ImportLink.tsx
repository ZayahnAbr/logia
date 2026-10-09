"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, FilePenLine, Check } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { importFromLink, openFileAsNote } from "@/app/import-actions";
import { getFileUrl, indexContent } from "@/app/actions";
import { extractFileText, chunkForIndex } from "@/lib/extractText";

export const EDITABLE_NOTE_RE = /\.(docx|pptx|txt|md)$/i;

// Paste a public share link; Logia downloads the file into this space like an upload.
export function ImportLink({ spaceId, folder, onClose }: { spaceId: string; folder: string; onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<"idle" | "busy" | "done" | "converting">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setErr(null); setStage("busy");
    const res = await importFromLink(spaceId, folder, url);
    if ("error" in res && res.error) { setErr(res.error); setStage("idle"); return; }
    const r = res as { id: string; name: string; path: string; mime: string };
    setDone({ id: r.id, name: r.name }); setStage("done");
    router.refresh();
    // Index for Ask Logia, best-effort, same as an upload.
    try {
      const signed = (await getFileUrl(r.path)).url;
      if (signed) {
        const blob = await (await fetch(signed)).blob();
        const chunks = chunkForIndex(await extractFileText(new File([blob], r.name, { type: r.mime })));
        if (chunks.length) await indexContent(spaceId, "file", r.id, r.name, chunks);
      }
    } catch { /* indexing is best-effort */ }
  };

  const openNote = async () => {
    if (!done) return;
    setStage("converting"); setErr(null);
    const res = await openFileAsNote(spaceId, done.id);
    if ("error" in res && res.error) { setErr(res.error); setStage("done"); return; }
    toast("Opened as an editable note.");
    onClose();
    router.push(`/spaces/${spaceId}/notes?note=${(res as { id: string }).id}`);
  };

  return (
    <Dialog title="Import from a link" onClose={onClose} width={520}>
      {stage === "done" || stage === "converting" ? (
        <div>
          <p role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 12px" }}>
            <Check size={16} aria-hidden="true" style={{ marginTop: 3, flex: "none" }} />
            <span><strong style={{ overflowWrap: "anywhere" }}>{done?.name}</strong> was added to your files.</span>
          </p>
          {err && <p className="field-error" role="alert">{err}</p>}
          {done && EDITABLE_NOTE_RE.test(done.name) && (
            <p className="xt-meta">Want to edit it in Logia? This makes a separate note. Formatting is approximated, the original file stays unchanged, and your edits do not sync back to the site it came from.</p>
          )}
          <div className="xt-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>Done</button>
            {done && EDITABLE_NOTE_RE.test(done.name) && (
              <button type="button" className="btn btn-primary" onClick={openNote} disabled={stage === "converting"}>
                {stage === "converting" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FilePenLine size={14} aria-hidden="true" />} Open as editable note
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="il-url" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Share link</label>
          <input id="il-url" className="input" type="url" inputMode="url" autoComplete="off" autoFocus required
            value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/..."
            aria-describedby="il-help il-err" disabled={stage === "busy"} style={{ width: "100%" }} />
          <p id="il-help" className="xt-meta" style={{ marginTop: 8 }}>
            Works with Google Drive, Docs, Slides and Sheets, OneDrive, SharePoint and Dropbox links. Logia has no access to your accounts, so the file must be shared as <strong>&ldquo;Anyone with the link&rdquo;</strong>. Private files and folders can&rsquo;t be imported. Up to 25 MB. Google Docs come in as Word files, Slides as PowerPoint and Sheets as Excel.
          </p>
          <div id="il-err" aria-live="polite">{err && <p className="field-error" role="alert">{err}</p>}</div>
          <div className="xt-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={stage === "busy" || !url.trim()}>
              {stage === "busy" ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Downloading…</> : <><Link2 size={14} aria-hidden="true" /> Import file</>}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
