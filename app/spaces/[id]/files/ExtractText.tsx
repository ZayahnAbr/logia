"use client";
import { loadPdfjs } from "@/lib/pdf/loadPdfjs";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check, FileText, Sparkles } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { extractFileText } from "@/lib/extractText";
import { scanPagesToText, createNoteFromText, generateNotesFromText } from "@/app/actions";

// Pull the text out of an uploaded file, let the student fix it up, then optionally save it
// as a note or have Logia turn it into study notes. Text-based files are read on-device;
// images and scanned PDFs (no text layer) are read with the vision model.
async function pdfPagesAsImages(blob: Blob, max = 6) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
  const doc = await task.promise;
  const out: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1600 / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      out.push(canvas.toDataURL("image/jpeg", 0.85));
    }
  } finally { task.destroy(); }
  return out;
}
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });

export function ExtractText({ spaceId, file, url, onClose }: { spaceId: string; file: { name: string; mime_type: string }; url: string; onClose: () => void }) {
  const router = useRouter();
  const [stage, setStage] = useState<"reading" | "ocr" | "ready" | "saving" | "notes" | "error">("reading");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [usedAi, setUsedAi] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const isImg = file.mime_type?.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(file.name);
        let out = "";
        if (!isImg) out = (await extractFileText(new File([blob], file.name, { type: file.mime_type }))).trim();
        const isPdf = /\.pdf$/i.test(file.name) || file.mime_type?.includes("pdf");
        if (isImg || (isPdf && out.length < 80)) {
          if (!alive) return;
          setStage("ocr"); setUsedAi(true);
          const images = isImg ? [await blobToDataUrl(blob)] : await pdfPagesAsImages(blob);
          const res = await scanPagesToText(images, false);
          if ("error" in res && res.error) throw new Error(res.error);
          out = (res as { text: string }).text.trim();
        }
        if (!alive) return;
        if (!out) throw new Error("No readable text was found in this file.");
        setText(out); setStage("ready");
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : "Couldn't read this file."); setStage("error"); }
      }
    })();
    return () => { alive = false; };
  }, [url, file.name, file.mime_type]);

  const title = file.name.replace(/\.[^.]+$/, "");
  const saveAsIs = async () => {
    setStage("saving");
    const res = await createNoteFromText(spaceId, title, text, "From files");
    if ("error" in res && res.error) { toast(res.error, "error"); setStage("ready"); return; }
    toast("Saved as a note.");
    onClose();
    router.push(`/spaces/${spaceId}/notes?note=${res.id}`);
  };
  const studyNotes = async () => {
    setStage("notes");
    const res = await generateNotesFromText(spaceId, file.name, text);
    if ("error" in res && res.error) { toast(res.error, "error"); setStage("ready"); return; }
    toast(`Study notes ready: ${res.title}`);
    onClose();
    router.push(`/spaces/${spaceId}/notes?note=${res.id}`);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const busy = stage === "saving" || stage === "notes";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <Dialog title={`Text from ${file.name}`} onClose={onClose} width={760}>
      {(stage === "reading" || stage === "ocr") && (
        <div className="xt-wait" role="status">
          <Loader2 size={20} className="spin" aria-hidden="true" />
          <span>{stage === "reading" ? "Reading the file…" : "This looks like a scan or photo. Reading it carefully…"}</span>
        </div>
      )}
      {stage === "error" && <p className="field-error" role="alert">{err}</p>}
      {(stage === "ready" || busy) && (
        <>
          <p className="xt-meta">{words.toLocaleString()} words{usedAi ? " · read from an image, so check names and numbers" : " · read directly from the file"}. You can fix anything below before saving.</p>
          <label htmlFor="xt-text" className="sr-only">Extracted text</label>
          <textarea id="xt-text" className="input xt-text" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <div className="xt-actions">
            <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Copied" : "Copy"}</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={saveAsIs} disabled={busy || !text.trim()}>
              {stage === "saving" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />} Save as note
            </button>
            <button type="button" className="btn btn-primary" onClick={studyNotes} disabled={busy || text.trim().length < 200}>
              {stage === "notes" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />} Turn into study notes
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
