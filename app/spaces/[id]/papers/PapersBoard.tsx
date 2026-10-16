"use client";
import { RenameableTitle } from "@/components/RenameableTitle";
import { renameUpload } from "@/app/actions";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ThinkingSteps } from "@/components/ThinkingSteps";
import { Search, Upload, FileCheck2, Trash2, ChevronRight, FileText, ClipboardCheck, SearchCheck, Sparkles, Camera } from "lucide-react";
import { extractFileText } from "@/lib/extractText";
import { generatePastPaper, deletePastPaper } from "@/app/actions";
import type { PastPaper } from "@/lib/types";
import { ScanCapture } from "@/components/ScanCapture";

type Stage = "idle" | "reading" | "marking";

const STEPS = [
  { icon: Upload, title: "Upload", text: "Your answered paper + the memo" },
  { icon: SearchCheck, title: "See where you went wrong", text: "Every question marked against the memo" },
  { icon: Sparkles, title: "Practise (optional)", text: "Generate questions on your weak topics" },
];

function FileDrop({ label, hint, icon: Icon, file, onFile, disabled }: {
  label: string; hint: string; icon: typeof FileText; file: File | null; onFile: (f: File) => void; disabled: boolean;
}) {
  return (
    <label className={`pp-drop${file ? " is-set" : ""}${disabled ? " is-off" : ""}`}>
      <span className="pp-drop-ic" aria-hidden="true">{file ? <FileCheck2 size={20} /> : <Icon size={20} />}</span>
      <span className="pp-drop-t">{label}</span>
      <span className="pp-drop-h">{file ? file.name : hint}</span>
      {!file && <span className="pp-drop-cta">Choose file</span>}
      <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" className="sr-only" disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </label>
  );
}

export function PapersBoard({ spaceId, papers }: { spaceId: string; papers: PastPaper[] }) {
  const router = useRouter();
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [memoFile, setMemoFile] = useState<File | null>(null);
  const [memoText, setMemoText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [paperScan, setPaperScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState<"paper" | "memo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [newest, setNewest] = useState(true);
  const shown = papers.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => (newest ? -1 : 1) * (a.created_at < b.created_at ? -1 : 1));

  const submit = () => {
    if (!paperFile && paperScan === null) { setError("Upload or scan your answered paper first."); return; }
    if (!memoFile && !memoText.trim()) { setError("Upload, scan or paste the memo."); return; }
    setError(null);
    start(async () => {
      setStage("reading");
      const [paperText, memo] = await Promise.all([
        paperScan !== null ? Promise.resolve(paperScan) : extractFileText(paperFile!),
        memoFile ? extractFileText(memoFile) : Promise.resolve(memoText),
      ]);
      if (!paperText.trim()) { setError("Couldn't read any text from your paper. If it's a photographed/scanned PDF, use \"Scan with camera\" instead."); setStage("idle"); return; }
      if (!memo.trim()) { setError("Couldn't read any text from the memo."); setStage("idle"); return; }
      setStage("marking");
      const title = paperFile ? paperFile.name.replace(/\.(pdf|docx|txt|md)$/i, "") : `Scanned paper ${new Date().toLocaleDateString()}`;
      const res = await generatePastPaper(spaceId, title, paperText, memo);
      if ("error" in res) { setError(res.error ?? "Couldn't mark your paper. Please try again."); setStage("idle"); return; }
      router.push(`/spaces/${spaceId}/papers/${res.paperId}`);
    });
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Delete this paper and its marks? This can't be undone.")) return;
    await deletePastPaper(spaceId, id);
    router.refresh();
  };

  return (
    <div className="pp">
      <section className="pp-work" aria-labelledby="pp-mark-h">
        <div className="pp-work-main">
          <h2 id="pp-mark-h">Mark a paper</h2>
          <p className="pp-lead">Add your answered paper and the memo. Every question is marked against the memo.</p>
          <div className="pp-drops" style={{ opacity: pending ? 0.5 : 1, pointerEvents: pending ? "none" : "auto" }}>
            <FileDrop label="Your answered paper" hint="PDF, DOCX or TXT with your answers" icon={FileText} file={paperFile} onFile={setPaperFile} disabled={pending} />
            <FileDrop label="Memo" hint="The official answers to mark against" icon={ClipboardCheck} file={memoFile} onFile={(f) => { setMemoFile(f); setMemoText(""); }} disabled={pending} />
          </div>
          {!pending && (
            <div className="pp-alt">
              {!paperFile && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScanning("paper")}><Camera size={14} aria-hidden="true" /> {paperScan !== null ? "Paper scanned. Rescan" : "Scan the paper"}</button>}
              {!memoFile && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScanning("memo")}><Camera size={14} aria-hidden="true" /> Scan the memo</button>}
              {!memoFile && !showPaste && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPaste(true)}>Paste the memo</button>}
            </div>
          )}
          {scanning && !pending && (
            <div className="pp-scan">
              <div className="pp-scan-t">Scan your {scanning === "paper" ? "answered paper" : "memo"}, one photo per page</div>
              <ScanCapture label={`Read ${scanning === "paper" ? "paper" : "memo"}`} onCancel={() => setScanning(null)}
                onText={(t) => { if (scanning === "paper") setPaperScan(t); else { setMemoText(t); setShowPaste(true); } setScanning(null); }} />
            </div>
          )}
          {!memoFile && showPaste && !pending && (
            <>
              <label htmlFor="pp-memo" className="sr-only">Memo text</label>
              <textarea id="pp-memo" className="input" rows={4} value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="Paste the memo here" style={{ resize: "vertical", marginTop: 12 }} />
            </>
          )}
          {error && <div role="alert" className="pp-err">{error}</div>}
        </div>

        <aside className="pp-work-side">
          <ol className="pp-steps">
            {STEPS.map((st, i) => (
              <li key={st.title}><span className="pp-n" aria-hidden="true">{i + 1}</span><span><strong>{st.title}</strong>{st.text}</span></li>
            ))}
          </ol>
          {pending ? (
            <div className="pp-progress-steps">
              <p className="pp-stage">{stage === "reading" ? "Step 1 of 2" : "Step 2 of 2"}</p>
              {stage === "reading"
                ? <ThinkingSteps key="reading" every={4500} steps={["Opening your paper and memo", "Reading each page", "Matching your answers to the memo"]} />
                : <ThinkingSteps key="marking" every={5000} steps={["Marking every question", "Adding up your marks", "Finding the topics to work on", "Writing your feedback"]} />}
              <small className="pp-keep">Keep this tab open. Most papers take under a minute.</small>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-lg pp-go" onClick={submit}>Mark my paper</button>
          )}
        </aside>
      </section>

      <section className="pp-list" aria-labelledby="pp-marked-h">
        <div className="pp-list-head">
          <h2 id="pp-marked-h">Marked papers {papers.length > 0 && <span>{papers.length}</span>}</h2>
          {papers.length > 0 && (
            <div className="pp-tools">
              <div className="nb-search">
                <Search size={15} aria-hidden="true" />
                <label htmlFor="paper-q" className="sr-only">Search papers</label>
                <input id="paper-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search papers" />
              </div>
              <button type="button" className="pr-chip" onClick={() => setNewest((n) => !n)} aria-label={`Sort: ${newest ? "newest" : "oldest"} first`}>{newest ? "Newest first" : "Oldest first"}</button>
            </div>
          )}
        </div>
        {papers.length === 0 ? (
          <div className="pp-empty">
            <span className="pp-sheet" aria-hidden="true"><i /><i /><i /><i /></span>
            <div><strong>No marked papers yet</strong><p>Papers you mark appear here. Open one to see your answer next to the memo, question by question.</p></div>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty card">No papers match that search.</div>
        ) : (
          <div className="pp-grid">
            {shown.map((p) => {
              const practice = /(—|·) practice$/.test(p.title);
              return (
                <Link key={p.id} href={`/spaces/${spaceId}/papers/${p.id}`} className="pp-card">
                  <span className="pp-sheet" aria-hidden="true"><i /><i /><i /><i /></span>
                  <span className="pp-card-body">
                    <span className="pp-tag">{practice ? <><Sparkles size={12} aria-hidden="true" /> Practice</> : <><FileCheck2 size={12} aria-hidden="true" /> Marked</>}</span>
                    <RenameableTitle value={p.title} label="paper" style={{ fontSize: 14.5, fontWeight: 600 }}
                      onRename={async (n) => { const r = await renameUpload("paper", spaceId, p.id, n); if (!r.error) router.refresh(); return r; }} />
                    <span className="pp-date">{new Date(p.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                  </span>
                  <span className="pp-card-foot">
                    <span className="pp-open">Open <ChevronRight size={14} aria-hidden="true" /></span>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={(e) => remove(e, p.id)} aria-label={`Delete ${p.title}`}><Trash2 size={14} /></button>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
