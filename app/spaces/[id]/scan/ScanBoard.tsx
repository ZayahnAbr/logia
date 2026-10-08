"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, FileText, FileCheck2 } from "lucide-react";
import { ScanCapture } from "@/components/ScanCapture";
import { createNoteFromText } from "@/app/actions";

export function ScanBoard({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text) return;
    setSaving(true); setError(null);
    const res = await createNoteFromText(spaceId, title.trim(), text);
    setSaving(false);
    if ("error" in res && res.error) { setError(res.error); return; }
    router.push(`/spaces/${spaceId}/notes`);
  };

  return (
    <div className="ln-scan ln-h">
      <div className="ln-pane">
        <ScanCapture onText={setText} label="Turn into text" />
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Scanning a past paper you&apos;ve written? Use the scan option on the{" "}
          <Link href={`/spaces/${spaceId}/papers`} style={{ color: "var(--accent-text)", fontWeight: 600 }}>Papers</Link> page so it gets marked.
        </div>
      </div>

      <div className="ln-pane">
        {text === null ? (
          <div className="ln-empty">
            <FileText size={28} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <h2>Your text appears here</h2>
            <p>Add a photo on the left. When Logia has read it, you can fix anything it misread and save it as a note.</p>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Check the transcription and fix anything the scan misread.</div>
            <label className="field"><span className="field-label">Note title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field-label" htmlFor="scan-text">Transcribed text</label>
            <textarea id="scan-text" className="input" value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit" }} />
            {error && <div role="alert" style={{ color: "var(--destructive)", fontSize: 12.5 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={save} disabled={saving || !text.trim()}>
                {saving ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} Save as note
              </button>
              <Link href={`/spaces/${spaceId}/papers`} className="btn"><FileCheck2 size={14} /> Go to Papers instead</Link>
              <button className="btn btn-ghost" onClick={() => setText(null)}>Clear text</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
