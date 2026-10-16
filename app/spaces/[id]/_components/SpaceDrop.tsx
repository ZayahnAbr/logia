"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { extractFileText } from "@/lib/extractText";
import { createLectureRecord, generateNotesFromText, generateCardsFromNote } from "@/app/actions";
import { registerUploadedFile } from "@/app/onboarding-actions";

const DOC_EXT = [".pdf", ".pptx", ".docx", ".txt", ".md"];
const AV_EXT = [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg"];
const ACCEPT = [...DOC_EXT, ...AV_EXT, "audio/*", "video/mp4", "video/webm"].join(",");
const MAX_MB = 25;

// The space's "add anything" tool: drop or choose a file, or paste text, then turn it into notes or
// flashcards, or just keep it. Same drop zone as the landing page, wired to this space.
export function SpaceDrop({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [isAv, setIsAv] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const label = file?.name ?? (text.trim() ? "Pasted text" : "Untitled");

  async function take(f: File) {
    setError(null); setText(""); setFile(null);
    const name = f.name.toLowerCase();
    const av = AV_EXT.some((e) => name.endsWith(e)) || /^(audio|video)\//.test(f.type);
    const doc = DOC_EXT.some((e) => name.endsWith(e));
    if (!av && !doc) { setError("That file type isn't supported here. Try a PDF, PowerPoint, Word doc, text, audio or video."); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`That file is over ${MAX_MB} MB.`); return; }
    setFile(f); setIsAv(av);
    if (av) return;
    setBusy("Reading your file…");
    try {
      const t = await extractFileText(f);
      if (!t.trim()) { setError("Couldn't find any text in that file."); setFile(null); } else setText(t);
    } catch (e) {
      console.error("SpaceDrop: reading file failed", f.name, f.type, f.size, e);
      setError("Couldn't read that file. Please try another."); setFile(null);
    }
    setBusy(null);
  }

  async function upload(f: File, prefix = "") {
    // crypto.randomUUID is missing on iOS Safari before 15.4.
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${spaceId}/${prefix}${id}-${f.name.replace(/[^\w.\-]/g, "_")}`;
    const { error: e } = await createClient().storage.from("space-files").upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (e) throw e;
    return path;
  }

  async function run(kind: "notes" | "cards" | "save" | "lecture") {
    setError(null);
    try {
      if (kind === "notes") {
        setBusy("Writing your notes…");
        const res = await generateNotesFromText(spaceId, label, text);
        if ("error" in res && res.error) throw new Error(res.error);
        if ("id" in res && res.id) { router.push(`/spaces/${spaceId}/notes?note=${res.id}`); return; }
      } else if (kind === "cards") {
        setBusy("Making your flashcards…");
        const res = await generateCardsFromNote(spaceId, label.replace(/\.[^.]+$/, ""), text);
        if ("error" in res && res.error) throw new Error(res.error);
        if ("deckId" in res && res.deckId) { router.push(`/spaces/${spaceId}/decks/${res.deckId}`); return; }
      } else if (kind === "lecture" && file) {
        setBusy("Uploading…");
        const path = await upload(file, "audio-");
        const res = await createLectureRecord(spaceId, file.name.replace(/\.[^.]+$/, ""), path);
        if (res.error) throw new Error(res.error);
        router.push(`/spaces/${spaceId}/lectures`); return;
      } else if (kind === "save" && file) {
        setBusy("Saving…");
        const path = await upload(file);
        const res = await registerUploadedFile(spaceId, "General", file.name, path, file.size, file.type);
        if ("error" in res) throw new Error(res.error);
        router.push(`/spaces/${spaceId}/files`); return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
    setBusy(null);
  }

  const hasText = text.trim().length > 0;
  const ready = !busy && (file || hasText);

  return (
    <div className="try-logia sd">
      <div className={`try-drop${over ? " is-over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void take(f); }}
        aria-label="Drop a file here or choose one">
        <input ref={input} type="file" accept={ACCEPT} className="try-drop-input"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void take(f); }} />
        <p className="try-drop-title"><span className="try-desk">Drop anything here, or click to choose</span><span className="try-touch">Tap to choose a file</span></p>
        <p className="try-drop-sub">PDF, slides, Word, text, audio or video</p>
        {file && <p className="try-drop-file">{file.name}</p>}
      </div>

      {!file && (
        <textarea className="try-textarea sd-text" rows={3} placeholder="Or paste text here…" value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }} aria-label="Paste text" />
      )}

      {ready && (
        <div className="try-actions sd-actions">
          {isAv ? (
            <>
              <button type="button" className="btn" onClick={() => run("lecture")}>Transcribe as a lecture</button>
              <button type="button" className="btn" onClick={() => run("save")}>Save to files</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => run("notes")} disabled={!hasText}>Make notes</button>
              <button type="button" className="btn" onClick={() => run("cards")} disabled={!hasText}>Make flashcards</button>
              {file && <button type="button" className="btn" onClick={() => run("save")}>Save to files</button>}
            </>
          )}
        </div>
      )}

      {busy && <p className="try-status" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> {busy}</p>}
      {error && <p className="try-error" role="alert">{error}</p>}
    </div>
  );
}
