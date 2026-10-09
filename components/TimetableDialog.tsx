"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, Loader2, Plus, Trash2, ScanLine } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { parseTimetable, saveTimetable } from "@/app/calendar-actions";
import { extractFileText } from "@/lib/extractText";
import { CLASS_TYPES, DAY_NAMES, TYPE_LABEL, type ClassType, type DraftClass } from "@/lib/timetable";

const MAX_W = 1800;
function fileToJpeg(file: File) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_W / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => reject(new Error("That image couldn't be opened."));
    img.src = URL.createObjectURL(file);
  });
}

const blank = (): DraftClass => ({ key: crypto.randomUUID(), title: "", course_code: "", class_type: "lecture", weekday: 0, start: "08:00", end: "09:00", venue: "" });

// Step 1: add a photo, PDF or pasted text. Step 2: review and edit. Nothing is saved until "Save timetable".
export function TimetableDialog({ spaceId, onClose, onSaved }: { spaceId?: string | null; onClose: () => void; onSaved: () => void }) {
  const [images, setImages] = useState<string[]>([]);
  const [pdfText, setPdfText] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftClass[] | null>(null);
  const [terms, setTerms] = useState<{ start?: string; end?: string }>({});
  const [replace, setReplace] = useState(true);
  const camRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    try {
      const imgs: string[] = [];
      let text = "";
      for (const f of [...files]) {
        if (f.type.startsWith("image/")) imgs.push(await fileToJpeg(f));
        else if (f.name.toLowerCase().endsWith(".pdf")) {
          const t = await extractFileText(f);
          if (!t) setError("That PDF has no readable text (it may be a scan). Take a photo of it instead.");
          else text += `${t}\n`;
        } else setError("Use a photo (JPG, PNG) or a PDF.");
      }
      if (imgs.length) setImages((p) => [...p, ...imgs].slice(0, 4));
      if (text) setPdfText((p) => `${p}${text}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't open that file."); }
  };

  const read = async () => {
    setBusy(true); setError(null);
    const res = await parseTimetable(images, `${pdfText}\n${pasted}`);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    setRows(res.classes);
    setTerms({ start: res.termStart, end: res.termEnd });
  };

  const patch = (key: string, p: Partial<DraftClass>) => setRows((r) => r?.map((x) => (x.key === key ? { ...x, ...p } : x)) ?? r);
  const save = async () => {
    if (!rows) return;
    setSaving(true);
    const res = await saveTimetable(rows, { replace, spaceId, termStart: terms.start, termEnd: terms.end });
    setSaving(false);
    if ("error" in res) { setError(res.error); return; }
    toast(`Saved ${res.saved} class${res.saved === 1 ? "" : "es"} to your timetable.`);
    onSaved(); onClose();
  };

  const hasInput = images.length > 0 || pdfText.trim() || pasted.trim();

  return (
    <Dialog title={rows ? "Check your timetable" : "Add your timetable"} onClose={onClose} width={720}>
      {!rows ? (
        <div className="tt-form">
          <p className="tt-note">Take a photo of your weekly timetable, upload a photo or PDF, or paste the text. Logia reads it and shows you the result to check before anything is saved.</p>
          <div className="tt-pick">
            <button type="button" className="btn btn-primary" onClick={() => camRef.current?.click()}><Camera size={14} aria-hidden="true" /> Take or choose a photo</button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden aria-label="Take or choose a photo of your timetable" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <label className="btn tt-file"><FileUp size={14} aria-hidden="true" /> Upload photo or PDF
              <input type="file" accept="image/*,application/pdf,.pdf" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {images.length > 0 && (
            <div className="tt-thumbs">
              {images.map((src, i) => (
                <div key={i} className="tt-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Timetable photo ${i + 1}`} />
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove photo ${i + 1}`} onClick={() => setImages((p) => p.filter((_, j) => j !== i))}><Trash2 size={13} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
          )}
          {pdfText && <p className="tt-note">PDF text added. <button type="button" className="tt-link" onClick={() => setPdfText("")}>Remove it</button></p>}
          <label className="field"><span className="field-label">Or paste the text <span className="field-hint">(optional)</span></span>
            <textarea className="input" rows={4} maxLength={12000} placeholder={"e.g. Mon 08:00-09:30 PSY101 Lecture, Hall 4"} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </label>
          {error && <div className="tt-error" role="alert">{error}</div>}
          <div className="tt-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !hasInput} onClick={read}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Reading…</> : <><ScanLine size={14} aria-hidden="true" /> Read my timetable</>}
            </button>
          </div>
        </div>
      ) : (
        <div className="tt-form">
          <p className="tt-warn" role="note">Logia reads the image and can misread it, so check every day and time. Nothing is saved until you press Save.</p>
          {rows.length === 0 && <p className="tt-note">No classes were found. This may not be a timetable, or the photo was too unclear. Add classes by hand or go back and try a sharper photo.</p>}
          <ul className="tt-rows">
            {rows.map((r, i) => (
              <li key={r.key} className="tt-row">
                <label className="field tt-w2"><span className="field-label">Title</span>
                  <input className="input" value={r.title} maxLength={120} onChange={(e) => patch(r.key, { title: e.target.value })} aria-label={`Title, class ${i + 1}`} /></label>
                <label className="field"><span className="field-label">Type</span>
                  <select className="input" value={r.class_type} onChange={(e) => patch(r.key, { class_type: e.target.value as ClassType })}>
                    {CLASS_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select></label>
                <label className="field"><span className="field-label">Day</span>
                  <select className="input" value={r.weekday} onChange={(e) => patch(r.key, { weekday: +e.target.value })}>
                    {DAY_NAMES.map((d, n) => <option key={d} value={n}>{d}</option>)}
                  </select></label>
                <label className="field"><span className="field-label">Start</span>
                  <input className="input" type="time" value={r.start} onChange={(e) => patch(r.key, { start: e.target.value })} /></label>
                <label className="field"><span className="field-label">End</span>
                  <input className="input" type="time" value={r.end} onChange={(e) => patch(r.key, { end: e.target.value })} /></label>
                <label className="field tt-w2"><span className="field-label">Venue</span>
                  <input className="input" value={r.venue} maxLength={80} onChange={(e) => patch(r.key, { venue: e.target.value })} /></label>
                <button type="button" className="btn btn-ghost btn-sm tt-rm" onClick={() => setRows((l) => l?.filter((x) => x.key !== r.key) ?? l)} aria-label={`Remove ${r.title || `class ${i + 1}`}`}><Trash2 size={14} aria-hidden="true" /> Remove</button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm" onClick={() => setRows((l) => [...(l ?? []), blank()])}><Plus size={14} aria-hidden="true" /> Add a class</button>
          {(terms.start || terms.end) && <p className="tt-note">Term dates found: {terms.start ?? "?"} to {terms.end ?? "?"}. Classes only show inside these dates.</p>}
          <label className="tt-check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace my current timetable</label>
          {error && <div className="tt-error" role="alert">{error}</div>}
          <div className="tt-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setRows(null); setError(null); }}>Back</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={saving || rows.length === 0} onClick={save}>
              {saving && <Loader2 size={14} className="spin" aria-hidden="true" />} Save timetable
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
