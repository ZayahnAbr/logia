"use client";
import { RenameableTitle } from "@/components/RenameableTitle";
import { renameUpload } from "@/app/actions";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createLectureRecord, transcribeLecture, generateStudyMaterials, deleteLecture, generateNotesFromText } from "@/app/actions";
import { compressAudioFile } from "./compressAudio";
import { LectureRecorder } from "./LectureRecorder";
import { Upload, Loader2, Mic, Trash2, Sparkles, FileText } from "lucide-react";

type Lecture = {
  id: string; title: string; audio_path: string; status: string;
  transcript: string | null; summary: string | null; cards_generated: boolean; created_at: string;
};

export function LecturesBoard({ spaceId, lectures }: { spaceId: string; lectures: Lecture[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAudio(file);
    e.target.value = "";
  };

  const uploadAudio = async (file: File) => {
    setUploading(true); setErr(null);
    try {
      const compressed = await compressAudioFile(file);
      const supabase = createClient();
      const path = `${spaceId}/audio-${crypto.randomUUID()}-${compressed.name}`;
      const { error: upErr } = await supabase.storage.from("space-files").upload(path, compressed, { contentType: "audio/mp3", upsert: false });
      if (upErr) throw upErr;
      const res = await createLectureRecord(spaceId, title.trim() || file.name.replace(/\.[^.]+$/, ""), path);
      if (res.error) throw new Error(res.error);
      setTitle("");
      router.refresh();
    } catch (e: any) { setErr(e.message ?? "Upload failed."); }
    setUploading(false);
  };

  const transcribe = (id: string, path: string) => start(async () => {
    const res = await transcribeLecture(spaceId, id, path);
    if (res.error) setErr(res.error);
    router.refresh();
  });

  const generate = (id: string) => start(async () => {
    const res = await generateStudyMaterials(spaceId, id);
    if (res.error) { setErr(res.error); router.refresh(); return; }
    router.refresh();
    // Open the cards that were just made, rather than leaving the student to find them.
    if (res.deckId) router.push(`/spaces/${spaceId}/decks/${res.deckId}`);
  });

  // Turn the transcript into a note instead of cards. Can be done more than once.
  const makeNote = (title: string, transcript: string) => start(async () => {
    const res = await generateNotesFromText(spaceId, title, transcript, "From lectures");
    if ("error" in res && res.error) { setErr(res.error); return; }
    if ("id" in res && res.id) router.push(`/spaces/${spaceId}/notes?note=${res.id}`);
  });

  const remove = (id: string, path: string) => start(async () => {
    if (!window.confirm("Delete this lecture and its recording? This can't be undone.")) return;
    await deleteLecture(spaceId, id, path);
    router.refresh();
  });

  const sel = lectures.find((l) => l.id === selId) ?? lectures[0] ?? null;

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      uploaded:     { label: "Uploaded",     color: "var(--muted)",    bg: "var(--surface-2)" },
      transcribing: { label: "Transcribing…", color: "var(--amber)",   bg: "var(--amber-soft)" },
      done:         { label: "Transcribed",   color: "var(--emerald)", bg: "var(--emerald-soft)" },
      failed:       { label: "Failed",        color: "var(--destructive)", bg: "var(--destructive-soft)" },
    };
    const m = map[s] ?? map.uploaded;
    return <span className="pill" style={{ background: m.bg, color: m.color, fontSize: 12 }}>{m.label}</span>;
  };

  return (
    <div className="ln-split ln-h">
      <aside className="ln-side" aria-label="Lectures">
        <div className="ln-side-head ln-upload">
          <div>
            <label className="field-l" htmlFor="lecture-title">Lecture title (optional)</label>
            <input id="lecture-title" className="input" placeholder="e.g. Week 3: Working memory" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <LectureRecorder onRecorded={uploadAudio} disabled={uploading} />
            <label className="btn btn-primary" style={{ cursor: "pointer", height: 42 }}>
              {uploading ? <><Loader2 size={14} className="spin" /> Compressing…</> : <><Upload size={14} /> Upload audio or video</>}
              <input type="file" accept="audio/*,video/*" hidden onChange={onPick} disabled={uploading} />
            </label>
          </div>
          {err && <div className="err" role="alert">{err}</div>}
          <p style={{ fontSize: 12, color: "var(--faint)", margin: 0 }}>Audio is compressed on your device before upload. Recordings up to about 1 hour 40 minutes fit.</p>
        </div>
        <ul className="ln-side-list">
          {lectures.length === 0 && <li className="ln-item-s" style={{ padding: 12 }}>No lectures yet.</li>}
          {lectures.map((l) => (
            <li key={l.id}>
              <button type="button" className="ln-item" aria-current={sel?.id === l.id} onClick={() => setSelId(l.id)}>
                <span className="ln-item-t">{l.title}</span>
                <span className="ln-item-s">{new Date(l.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {l.status === "done" ? "Transcribed" : l.status === "transcribing" ? "Transcribing" : l.status === "failed" ? "Failed" : "Uploaded"}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="ln-main">
        <div className="ln-pane">
          {!sel ? (
            <div className="ln-empty">
              <Mic size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
              <h2>No lectures yet</h2>
              <p>Record a lecture, or upload a recording or video of one, on the left. Logia writes out what was said, then turns it into flashcards or a note.</p>
            </div>
          ) : (
            <>
              <div className="ln-lec-head">
                <div>
                  <RenameableTitle value={sel.title} label="lecture" style={{ fontSize: 20, fontWeight: 700 }}
                    onRename={async (n) => { const r = await renameUpload("lecture", spaceId, sel.id, n); if (!r.error) router.refresh(); return r; }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {statusBadge(sel.status)}
                    {sel.cards_generated && <span className="pill" style={{ background: "var(--emerald-soft)", color: "var(--emerald)", fontSize: 12 }}>Cards generated</span>}
                    <span style={{ fontSize: 12, color: "var(--faint)" }}>{new Date(sel.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sel.status === "uploaded" && (
                    <button className="btn btn-primary" style={{ height: 36 }} onClick={() => transcribe(sel.id, sel.audio_path)} disabled={pending}>
                      <Mic size={13} /> Transcribe
                    </button>
                  )}
                  {sel.status === "done" && sel.transcript && (
                    <>
                      {!sel.cards_generated && (
                        <button className="btn btn-primary" style={{ height: 36 }} onClick={() => generate(sel.id)} disabled={pending}>
                          <Sparkles size={13} aria-hidden="true" /> Make flashcards
                        </button>
                      )}
                      <button className="btn" style={{ height: 36 }} onClick={() => makeNote(sel.title, sel.transcript!)} disabled={pending}>
                        <FileText size={13} aria-hidden="true" /> Make a note
                      </button>
                    </>
                  )}
                  <button aria-label="Delete lecture" className="btn btn-ghost" style={{ height: 36 }} onClick={() => remove(sel.id, sel.audio_path)} disabled={pending}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>
              {sel.summary || sel.transcript ? (
                <div className="ln-lec-body">
                  {sel.summary && (
                    <section>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>Summary</div>
                      <p style={{ color: "var(--text)" }}>{sel.summary}</p>
                    </section>
                  )}
                  {sel.transcript && (
                    <section>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>Transcript</div>
                      <div className="ln-lec-transcript"><p style={{ color: "var(--muted)" }}>{sel.transcript}</p></div>
                    </section>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 14, color: "var(--muted)" }}>
                  {sel.status === "uploaded" ? "Next step: press Transcribe to turn the recording into text." : sel.status === "transcribing" ? "Transcribing. This page updates when it finishes." : sel.status === "failed" ? "Transcription failed. Delete this lecture and upload the recording again." : "Nothing to show yet."}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
