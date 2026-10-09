"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileUp, Loader2, Search } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import {
  importWordFromOneDrive, importWordUpload, onedriveFiles, onedriveStatus,
  type ImportedNote, type OneDriveStatus,
} from "@/app/onedrive-actions";
import type { DriveFile } from "@/lib/server/onedrive";

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtSize = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

// Import a Word (.docx) file as a new note: pick one from OneDrive, or upload one from this device.
// One way only: the note is a copy, and changes are not sent back to Word.
export function ImportWordDialog({ spaceId, onClose, onImported }: { spaceId: string; onClose: () => void; onImported: (n: ImportedNote) => void }) {
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const load = async (query: string) => {
    const my = ++seq.current;
    setFiles(null); setErr(null);
    const res = await onedriveFiles(query);
    if (my !== seq.current) return;
    if ("error" in res) { setErr(res.error); setFiles([]); return; }
    setFiles(res.files);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await onedriveStatus();
      if (!alive) return;
      setStatus(s);
      if (s.connected && s.configured) void load("");
    })();
    return () => { alive = false; };
  }, []);

  const finish = (res: ImportedNote | { error: string }) => {
    setBusy("");
    if ("error" in res) { setErr(res.error); return; }
    onImported(res);
  };

  const pick = async (f: DriveFile) => {
    setBusy(f.id); setErr(null);
    finish(await importWordFromOneDrive(spaceId, f.id));
  };

  const upload = async (file: File) => {
    setBusy("upload"); setErr(null);
    const fd = new FormData(); fd.set("file", file);
    finish(await importWordUpload(spaceId, fd));
  };

  const drive = status?.connected && status.configured;

  return (
    <Dialog title="Import from Word" onClose={onClose} width={520}>
      <div style={{ display: "grid", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
          Brings a Word file in as a new note. Text, headings, lists and simple formatting come across; pictures and tables don&apos;t. The note is a copy, so changes you make here are not sent back to Word.
        </p>

        <div>
          <input ref={fileRef} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy !== ""}>
            {busy === "upload" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileUp size={14} aria-hidden="true" />} Upload a .docx from this device
          </button>
        </div>

        <section aria-labelledby="od-h" style={{ display: "grid", gap: 10 }}>
          <h3 id="od-h" style={{ margin: 0, fontSize: 14 }}>From OneDrive</h3>
          {status === null && <p style={{ margin: 0 }}>Loading</p>}
          {status !== null && !status.configured && <p style={{ margin: 0, fontSize: 13 }} role="status">OneDrive isn&apos;t set up for this app yet. You can still upload a file above.</p>}
          {status !== null && status.configured && !status.connected && (
            <p style={{ margin: 0, fontSize: 13 }}>Connect OneDrive to pick a file from it. <Link href="/spaces/settings#connections" className="btn btn-sm" style={{ marginLeft: 6 }}>Open Settings</Link></p>
          )}
          {drive && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); void load(q); }} style={{ display: "flex", gap: 8 }} role="search">
                <label className="sr-only" htmlFor="od-q">Search your Word files</label>
                <input id="od-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your Word files" style={{ flex: 1 }} />
                <button type="submit" className="btn" aria-label="Search"><Search size={14} aria-hidden="true" /></button>
              </form>
              {files === null && <p role="status" style={{ margin: 0 }}><Loader2 size={14} className="spin" aria-hidden="true" /> Loading your files</p>}
              {files !== null && files.length === 0 && !err && <p style={{ margin: 0, fontSize: 13 }}>No Word files found.</p>}
              {files !== null && files.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                  {files.map((f) => (
                    <li key={f.id}>
                      <button type="button" className="btn" onClick={() => void pick(f)} disabled={busy !== ""}
                        style={{ width: "100%", justifyContent: "space-between", height: "auto", padding: "8px 12px", textAlign: "left", gap: 10 }}>
                        <span style={{ overflowWrap: "anywhere" }}>{f.name}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {busy === f.id ? <Loader2 size={13} className="spin" aria-hidden="true" /> : `${fmtDate(f.modified)} · ${fmtSize(f.size)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {err && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--amber)" }}>{err}</p>}
      </div>
    </Dialog>
  );
}
