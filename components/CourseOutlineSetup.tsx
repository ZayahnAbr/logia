"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ClipboardList, Upload, AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { extractFileText } from "@/lib/extractText";
import { getFileUrl } from "@/app/actions";
import { analyseOutline, createFromOutline } from "@/app/course-outline-actions";
import { ASSESSMENT_TYPES, TYPE_STYLE, type AssessmentType, type OutlineResult } from "@/lib/courseOutline";

export type OutlineFile = { id: string; name: string; path: string; mime_type: string };
const READABLE = /\.(pdf|docx|pptx|txt|md)$/i;

type TopicDraft = { name: string; week: string; source?: string; on: boolean };
type AssDraft = { title: string; type: AssessmentType; weight: string; date: string; source?: string; notes?: string; on: boolean };

export function CourseOutlineButton({ spaceId, files = [], variant = "card", courseId, label }: { spaceId: string; files?: OutlineFile[]; variant?: "card" | "button"; courseId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "card" ? (
        <div className="co-card">
          <ClipboardList size={22} aria-hidden="true" className="co-card-ico" />
          <div className="co-card-copy">
            <strong>Set up from your course outline</strong>
            <span>Upload your outline or handbook. Logia finds the topics, tests and textbooks and offers to build this space. You check everything first.</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Start</button>
        </div>
      ) : (
        <button type="button" className="btn" style={{ height: 36 }} onClick={() => setOpen(true)}><ClipboardList size={14} aria-hidden="true" /> {label ?? "Set up from course outline"}</button>
      )}
      {open && <OutlineDialog spaceId={spaceId} files={files} courseId={courseId} onClose={() => setOpen(false)} />}
    </>
  );
}

function OutlineDialog({ spaceId, files, courseId, onClose }: { spaceId: string; files: OutlineFile[]; courseId?: string; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [stage, setStage] = useState<"pick" | "reading" | "review" | "saving">("pick");
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [result, setResult] = useState<OutlineResult | null>(null);
  const [topics, setTopics] = useState<TopicDraft[]>([]);
  const [ass, setAss] = useState<AssDraft[]>([]);
  const [books, setBooks] = useState<{ title: string; author?: string }[]>([]);
  const [info, setInfo] = useState({ code: "", name: "", lecturer: "" });

  const run = async (name: string, getFile: () => Promise<File>) => {
    setErr(null); setFileName(name); setStage("reading");
    try {
      if (!READABLE.test(name)) throw new Error("Use a PDF, Word (.docx), PowerPoint (.pptx) or text file.");
      const text = await extractFileText(await getFile());
      const res = await analyseOutline(name, text);
      if ("error" in res) throw new Error(res.error);
      const r = res.result;
      setResult(r); setTruncated(res.truncated);
      setTopics(r.topics.map((t) => ({ name: t.name, week: t.week ?? "", source: t.source, on: true })));
      setAss(r.assessments.map((a) => ({ title: a.title, type: a.type, weight: a.weightPercent != null ? String(a.weightPercent) : "", date: a.dueDate ?? "", source: a.source, notes: a.notes, on: !!a.dueDate })));
      setBooks(r.textbooks);
      setInfo({ code: r.courseCode ?? "", name: r.courseName ?? "", lecturer: r.lecturerName ?? "" });
      setStage("review");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that file."); setStage("pick"); }
  };
  const fromUpload = (f: File | undefined) => { if (f) run(f.name, async () => f); };
  const fromExisting = (f: OutlineFile) => run(f.name, async () => {
    const url = (await getFileUrl(f.path)).url;
    if (!url) throw new Error("Couldn't open that file.");
    return new File([await (await fetch(url)).blob()], f.name, { type: f.mime_type });
  });

  const create = async () => {
    setStage("saving"); setErr(null);
    const res = await createFromOutline(spaceId, {
      courseCode: info.code, courseName: info.name, lecturerName: info.lecturer, textbooks: books, raw: result,
      topics: topics.map((t) => ({ name: t.name, week: t.week, notebook: t.on })),
      assessments: ass.map((a) => ({ title: a.title, type: a.type, weightPercent: a.weight.trim() === "" ? undefined : Number(a.weight), dueDate: a.date || undefined, deadline: a.on && !!a.date })),
    }, courseId);
    if ("error" in res) { setErr(res.error); setStage("review"); return; }
    const bits = [res.notebooks && `${res.notebooks} notebook${res.notebooks === 1 ? "" : "s"}`, res.deadlines && `${res.deadlines} deadline${res.deadlines === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    toast(bits ? `Space set up: ${bits} added.` : "Course info saved.");
    res.warnings.forEach((w) => toast(w, "error"));
    router.refresh(); onClose();
  };

  const weightSum = ass.reduce((s, a) => s + (a.weight.trim() === "" || !Number.isFinite(Number(a.weight)) ? 0 : Number(a.weight)), 0);
  const busy = stage === "saving";
  const setA = (i: number, p: Partial<AssDraft>) => setAss((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setT = (i: number, p: Partial<TopicDraft>) => setTopics((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <Dialog title="Set up from your course outline" onClose={onClose} width={820}>
      {(stage === "pick" || stage === "reading") && (
        <div className="co-pick">
          <p className="co-note">{courseId ? "This replaces the assessments and topics of this course only. Marks you entered for it will be cleared. " : ""}Pick the document that lists your topics and assessments. Logia reads it, and it can get things wrong, so you will review everything before anything is saved.</p>
          {stage === "reading" ? (
            <div className="co-wait" role="status"><Loader2 size={20} className="spin" aria-hidden="true" /><span>Reading {fileName}. This can take up to a minute.</span></div>
          ) : (
            <>
              <label className="btn btn-primary co-upload" htmlFor={`${uid}-f`}><Upload size={14} aria-hidden="true" /> Upload a PDF, Word, PowerPoint or text file</label>
              <input id={`${uid}-f`} className="sr-only" type="file" accept=".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown" onChange={(e) => { fromUpload(e.target.files?.[0]); e.target.value = ""; }} />
              <p className="co-hint">This file is read on your device and is not added to Files. Scans and photos aren&rsquo;t supported here; open them in Files and use Extract text first.</p>
              {files.some((f) => READABLE.test(f.name)) && (
                <>
                  <h3 className="co-h">Or use a file already in this space</h3>
                  <ul className="co-files">
                    {files.filter((f) => READABLE.test(f.name)).map((f) => (
                      <li key={f.id}><button type="button" className="co-file" onClick={() => fromExisting(f)}>{f.name}</button></li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {err && <p className="field-error" role="alert">{err}</p>}
        </div>
      )}

      {(stage === "review" || busy) && (
        <div className="co-review">
          <p className="co-warn" role="note"><AlertTriangle size={15} aria-hidden="true" /> <span>Logia read <strong>{fileName}</strong> and can get things wrong. Check every item, date and weight before saving. Nothing is saved until you press Create.{truncated ? " This document is very long, so the later pages were not read." : ""}</span></p>

          <section aria-labelledby={`${uid}-c`}>
            <h3 className="co-h" id={`${uid}-c`}>Course</h3>
            <div className="co-grid3">
              <label>Code<input className="input" value={info.code} onChange={(e) => setInfo({ ...info, code: e.target.value })} disabled={busy} /></label>
              <label>Name<input className="input" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} disabled={busy} /></label>
              <label>Lecturer<input className="input" value={info.lecturer} onChange={(e) => setInfo({ ...info, lecturer: e.target.value })} disabled={busy} /></label>
            </div>
            {result?.notes && <p className="co-hint">From the document: {result.notes}</p>}
          </section>

          <section aria-labelledby={`${uid}-t`}>
            <h3 className="co-h" id={`${uid}-t`}>Topics <span className="co-count">{topics.filter((t) => t.on).length} of {topics.length} become notebooks</span></h3>
            {topics.length === 0 ? <p className="co-hint">No topics were found.</p> : (
              <ul className="co-list">
                {topics.map((t, i) => (
                  <li key={i} className="co-row">
                    <input type="checkbox" checked={t.on} onChange={(e) => setT(i, { on: e.target.checked })} aria-label={`Create a notebook for ${t.name || "this topic"}`} disabled={busy} />
                    <div className="co-fields">
                      <div className="co-line">
                        <input className="input" aria-label="Topic name" value={t.name} maxLength={60} onChange={(e) => setT(i, { name: e.target.value })} disabled={busy} />
                        <input className="input co-week" aria-label="Week" placeholder="Week" value={t.week} maxLength={30} onChange={(e) => setT(i, { week: e.target.value })} disabled={busy} />
                      </div>
                      {t.source && <span className="co-src">Found in: &ldquo;{t.source}&rdquo;</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${uid}-a`}>
            <h3 className="co-h" id={`${uid}-a`}>Assessments <span className="co-count">{ass.filter((a) => a.on && a.date).length} become deadlines</span></h3>
            {ass.length === 0 ? <p className="co-hint">No assessments were found.</p> : (
              <ul className="co-list">
                {ass.map((a, i) => (
                  <li key={i} className="co-row">
                    <input type="checkbox" checked={a.on && !!a.date} onChange={(e) => setA(i, { on: e.target.checked })} disabled={busy || !a.date} aria-label={a.date ? `Add ${a.title || "this assessment"} to the calendar` : `${a.title || "This assessment"} has no date, so it can't be added to the calendar`} />
                    <div className="co-fields">
                      <div className="co-line">
                        <input className="input" aria-label="Assessment title" value={a.title} maxLength={120} onChange={(e) => setA(i, { title: e.target.value })} disabled={busy} />
                        <select className="input co-type" aria-label="Type" value={a.type} onChange={(e) => setA(i, { type: e.target.value as AssessmentType })} disabled={busy}>
                          {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}
                        </select>
                      </div>
                      <div className="co-line">
                        <label className="co-mini">Date<input type="date" className="input" value={a.date} onChange={(e) => setA(i, { date: e.target.value, on: e.target.value ? true : false })} disabled={busy} /></label>
                        <label className="co-mini">Weight %<input type="number" min={0} max={100} step="0.5" inputMode="decimal" className="input co-w" value={a.weight} onChange={(e) => setA(i, { weight: e.target.value })} disabled={busy} /></label>
                      </div>
                      {!a.date && <span className="co-flag">No date found{a.notes ? ` (${a.notes})` : ""}. Add one to put it on the calendar. It is still saved for the marks calculator.</span>}
                      {a.source && <span className="co-src">Found in: &ldquo;{a.source}&rdquo;</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {ass.length > 0 && Math.abs(weightSum - 100) > 0.01 && <p className="co-flag">These weights add up to {weightSum}%, not 100%. Check the document. The marks calculator will wait until they add up to 100%.</p>}
          </section>

          {books.length > 0 && (
            <section aria-labelledby={`${uid}-b`}>
              <h3 className="co-h" id={`${uid}-b`}>Textbooks</h3>
              <ul className="co-books">
                {books.map((b, i) => (
                  <li key={i}>
                    {b.title}{b.author ? `, ${b.author}` : ""}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBooks((l) => l.filter((_, j) => j !== i))} disabled={busy} aria-label={`Remove ${b.title}`}>Remove</button>
                  </li>
                ))}
              </ul>
              <p className="co-hint">Textbooks are saved with the course info for reference. Add the PDFs yourself in your Library.</p>
            </section>
          )}

          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="co-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setStage("pick"); setErr(null); }} disabled={busy}>Back</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={create} disabled={busy || (!info.name && !info.code && topics.length + ass.length + books.length === 0)}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Creating…</> : "Create"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
