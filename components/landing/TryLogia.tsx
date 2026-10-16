"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, Copy, Check, Loader2 } from "lucide-react";
import { extractFileText } from "@/lib/extractText";
import { tryGenerateFromText, tryTranscribeAudio, tryExportDocx, type TryResult } from "@/app/try-actions";
import { Dialog } from "@/components/Dialog";
import type { Block } from "@/lib/gdocBlocks";

type Action = "notes" | "flashcards";
type Result = TryResult | { kind: "transcript"; transcript: string };
const DOC_EXT = [".pdf", ".pptx", ".docx", ".txt", ".md"];
const AV_EXT = [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg"];
// Extensions alone are unreliable in mobile file pickers (files can be greyed out), so MIME types go alongside.
const DOC_MIME = ["application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"];
const ACCEPT = [...DOC_EXT, ...AV_EXT, ...DOC_MIME, "audio/*", "video/mp4", "video/webm"].join(",");
const MAX_AV_BYTES = 15 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function resultTitle(result: Result) {
  if (result.kind === "notes") return result.title;
  if (result.kind === "flashcards") return "Your flashcards";
  return "Your transcript";
}

function resultPlainText(result: Result) {
  if (result.kind === "notes") return `${result.title}\n\n${result.html.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim()}`;
  if (result.kind === "flashcards") return result.cards.map((c) => `Q: ${c.question}\nA: ${c.answer}`).join("\n\n");
  return result.transcript;
}

// Simple HTML (only h3/p/ul/li/strong, per the notes prompt) back into the same block shape
// lib/server/wordExport.ts expects, so the trial's .docx reuses the real note exporter as-is.
function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const runsOf = (el: Element): Block["r"] => {
    const runs: Block["r"] = [];
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) runs.push({ t: node.textContent }); }
      else if (node.nodeType === Node.ELEMENT_NODE) {
        const t = (node as Element).textContent ?? "";
        if (t) runs.push({ t, ...((node as Element).tagName === "STRONG" ? { b: 1 as const } : {}) });
      }
    }
    return runs.length ? runs : [{ t: "" }];
  };
  const blocks: Block[] = [];
  for (const el of doc.body.children) {
    if (el.tagName === "H3") blocks.push({ k: "h3", r: runsOf(el) });
    else if (el.tagName === "P") blocks.push({ k: "p", r: runsOf(el) });
    else if (el.tagName === "UL") for (const li of el.children) blocks.push({ k: "ul", r: runsOf(li) });
  }
  return blocks.length ? blocks : [{ k: "p", r: [{ t: doc.body.textContent ?? "" }] }];
}

function resultToBlocks(result: Result): Block[] {
  if (result.kind === "notes") return htmlToBlocks(result.html);
  if (result.kind === "flashcards") return result.cards.flatMap((c) => [{ k: "h3" as const, r: [{ t: `Q: ${c.question}` }] }, { k: "p" as const, r: [{ t: c.answer }] }]);
  return result.transcript.split(/\n+/).filter(Boolean).map((t) => ({ k: "p" as const, r: [{ t }] }));
}

function downloadBlob(filename: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function TryLogia() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isAv, setIsAv] = useState(false);
  const [avFile, setAvFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() { setError(null); setResult(null); }

  async function handleFile(file: File) {
    reset();
    const name = file.name.toLowerCase();
    // Phones sometimes hand over files with no extension in the name, so fall back to the MIME type.
    const av = AV_EXT.some((e) => name.endsWith(e)) || /^(audio|video)\//.test(file.type);
    const doc = DOC_EXT.some((e) => name.endsWith(e)) || DOC_MIME.includes(file.type);
    if (av && file.size > MAX_AV_BYTES) { setError("That clip is over 15 MB. Try a shorter one for the demo."); return; }
    setFileName(file.name);
    setIsAv(av);
    setAvFile(av ? file : null);
    setText("");
    if (av) return; // transcribe happens on demand, below
    if (!doc) { setError("That file type isn't supported here. Try a PDF, PowerPoint, Word doc, audio or video clip."); setFileName(null); return; }
    setBusy("Reading your file…");
    try {
      const extracted = await extractFileText(file);
      if (!extracted.trim()) { setError("Couldn't find any text in that file."); setBusy(null); return; }
      setText(extracted);
    } catch {
      setError("Couldn't read that file. Please try another.");
    } finally {
      setBusy(null);
    }
  }

  async function transcribe() {
    if (!avFile) return;
    reset();
    setBusy("Listening to your clip…");
    try {
      const base64 = await fileToBase64(avFile);
      const res = await tryTranscribeAudio({ base64, mime: avFile.type, filename: avFile.name });
      if ("error" in res) setError(res.error);
      else setResult({ kind: "transcript", transcript: res.transcript });
    } catch {
      setError("Couldn't transcribe that clip. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function generate(action: Action) {
    reset();
    setBusy(action === "notes" ? "Writing your notes…" : "Making your flashcards…");
    try {
      const res = await tryGenerateFromText({ text, action });
      if ("error" in res) setError(res.error);
      else setResult(res);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const hasText = text.trim().length > 0;

  async function downloadDocx() {
    if (!result) return;
    setDownloading(true);
    try {
      const res = await tryExportDocx(resultTitle(result), resultToBlocks(result));
      if ("error" in res) { setError(res.error); return; }
      downloadBlob(res.filename, Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch {
      setError("Couldn't make that file. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="try-logia">
      <div
        className={`try-drop${dragOver ? " is-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        aria-label="Drop a file here or click to choose one"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="try-drop-input"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }}
        />
        <p className="try-drop-title"><span className="try-desk">Drop a file here, or click to choose one</span><span className="try-touch">Tap to choose a file</span></p>
        <p className="try-drop-sub">PDF, PowerPoint, Word, audio or video</p>
        {fileName && <p className="try-drop-file">{fileName}</p>}
      </div>

      <div className="try-or">or paste text</div>

      <textarea
        className="try-textarea"
        placeholder="Paste text from a document, slide deck, or anywhere else…"
        value={text}
        onChange={(e) => { setText(e.target.value); setFileName(null); setIsAv(false); reset(); }}
        rows={6}
      />

      <div className="try-actions">
        {isAv ? (
          <button type="button" className="btn btn-primary" onClick={transcribe} disabled={!!busy}>Transcribe</button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => generate("notes")} disabled={!hasText || !!busy}>Create notes</button>
            <button type="button" className="btn" onClick={() => generate("flashcards")} disabled={!hasText || !!busy}>Create flashcards</button>
          </>
        )}
      </div>

      {busy && <p className="try-status" role="status">{busy}</p>}
      {error && <p className="try-error" role="alert">{error}</p>}

      {result && (
        <Dialog title={resultTitle(result)} onClose={() => setResult(null)} width={560}>
          <div className="try-result">
            {result.kind === "notes" && <div className="try-result-html" dangerouslySetInnerHTML={{ __html: result.html }} />}
            {result.kind === "flashcards" && (
              <ul className="try-cards">
                {result.cards.map((c, i) => (
                  <li key={i} className="try-card">
                    <p className="try-card-q">{c.question}</p>
                    <p className="try-card-a">{c.answer}</p>
                  </li>
                ))}
              </ul>
            )}
            {result.kind === "transcript" && <p className="try-transcript">{result.transcript}</p>}
          </div>

          <div className="try-dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={async () => { await navigator.clipboard.writeText(resultPlainText(result)); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn" onClick={() => void downloadDocx()} disabled={downloading}>
              {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download .docx
            </button>
          </div>
          <div className="try-dialog-signup">
            <p>That&apos;s not all. Create an account to save this, build it into decks that track your progress, and keep going with no limit.</p>
            <Link href="/auth/sign-up" className="btn btn-primary btn-lg">Create a free account</Link>
          </div>
        </Dialog>
      )}
    </div>
  );
}
