"use client";

import { useId, useMemo, useState } from "react";
import { setAssessmentMark, setTopicDone } from "@/app/course-outline-actions";
import { summarise, courseLabel, TYPE_STYLE, type AssessmentRow, type TopicRow, type CourseData } from "@/lib/courseOutline";

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function MarkCalculator({ rows: initial }: { rows: AssessmentRow[] }) {
  const [rows, setRows] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const s = useMemo(() => summarise(rows), [rows]);
  const save = async (id: string, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v != null && !(v >= 0 && v <= 100)) { setErr("Enter a mark between 0 and 100."); return; }
    setErr(null);
    setRows((l) => l.map((r) => (r.id === id ? { ...r, mark_percent: v } : r)));
    const res = await setAssessmentMark(id, v);
    if ("error" in res && res.error) setErr(res.error);
  };
  const weighted = rows.filter((r) => r.weight_percent != null);
  const sumOk = Math.abs(s.weightSum - 100) < 0.01;
  return (
    <div className="co-calc card">
      <ul className="co-calc-list">
        {rows.map((r) => (
          <li key={r.id} className="co-calc-row">
            <div className="co-calc-name">
              <span className="truncate">{r.title}</span>
              <span className="co-sub">{TYPE_STYLE[r.type].label} · {r.weight_percent != null ? `${f1(Number(r.weight_percent))}% of final` : "no weight given"}{r.due_at ? ` · ${new Date(r.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}</span>
            </div>
            <label className="co-calc-in"><span className="sr-only">Mark received for {r.title}, percent</span>
              <input type="number" min={0} max={100} step="0.5" inputMode="decimal" className="input" placeholder="Mark %" defaultValue={r.mark_percent ?? ""} onBlur={(e) => save(r.id, e.target.value)} />
            </label>
          </li>
        ))}
      </ul>
      {err && <p className="field-error" role="alert">{err}</p>}
      {weighted.length > 0 && !sumOk && (
        <p className="co-flag" role="note">The weights add up to {f1(s.weightSum)}%, not 100%, so the targets below can&rsquo;t be worked out reliably. Check them against your outline.</p>
      )}
      <div className="co-total" aria-live="polite">
        <strong>{f1(s.earned)}%</strong> <span>of the final mark earned so far, from {f1(s.markedWeight)}% of the course marked</span>
      </div>
      {sumOk && (
        <table className="co-need">
          <caption className="sr-only">Average needed on the remaining assessments</caption>
          <thead><tr><th scope="col">To finish with</th><th scope="col">You need</th></tr></thead>
          <tbody>
            {s.needed.map((n) => (
              <tr key={n.target}>
                <th scope="row">{n.target}%</th>
                <td>{n.status === "done" ? "Already reached" : n.status === "impossible" ? (n.required != null ? `${f1(n.required)}% (not possible)` : "Not possible") : `${f1(n.required ?? 0)}% on the remaining ${f1(s.remainingWeight)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="co-hint">Your own estimate from the marks you enter. Your institution&rsquo;s rules (sub-minimums, rounding) may differ.</p>
    </div>
  );
}

export function TopicChecklist({ rows: initial }: { rows: TopicRow[] }) {
  const [rows, setRows] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const done = rows.filter((r) => r.done).length;
  const toggle = async (id: string, v: boolean) => {
    setRows((l) => l.map((r) => (r.id === id ? { ...r, done: v } : r)));
    const res = await setTopicDone(id, v);
    if ("error" in res && res.error) { setErr(res.error); setRows((l) => l.map((r) => (r.id === id ? { ...r, done: !v } : r))); } else setErr(null);
  };
  return (
    <div className="co-calc card">
      <p className="co-total" aria-live="polite"><strong>{done} of {rows.length}</strong> <span>topics done</span></p>
      <div className="co-bar" role="progressbar" aria-label="Topics done" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={done}><i style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }} /></div>
      <ul className="co-topics">
        {rows.map((r) => (
          <li key={r.id}>
            <label className="co-check">
              <input type="checkbox" checked={r.done} onChange={(e) => toggle(r.id, e.target.checked)} />
              <span className={r.done ? "co-done" : undefined}>{r.name}</span>
              {r.week && <span className="co-sub">{/^\d+$/.test(r.week) ? `Week ${r.week}` : r.week}</span>}
            </label>
          </li>
        ))}
      </ul>
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}

// Space-home versions: a small course switcher when there is more than one course.
function Switcher({ courses, value, onChange, id }: { courses: CourseData[]; value: string; onChange: (v: string) => void; id: string }) {
  if (courses.length < 2) return courses[0] ? <p className="co-sub co-switch-one">{courseLabel(courses[0])}</p> : null;
  return (
    <div className="co-switch">
      <label htmlFor={id} className="co-sub">Course</label>
      <select id={id} className="ln-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {courses.map((c) => <option key={c.id} value={c.id}>{courseLabel(c)}</option>)}
      </select>
    </div>
  );
}

export function HomeMarks({ courses }: { courses: CourseData[] }) {
  const [id, setId] = useState(courses[0]?.id ?? "");
  const uid = useId();
  const c = courses.find((x) => x.id === id) ?? courses[0];
  if (!c) return null;
  return (
    <div>
      <Switcher courses={courses} value={c.id} onChange={setId} id={`${uid}-m`} />
      {c.assessments.length ? <MarkCalculator key={c.id} rows={c.assessments} /> : <p className="co-hint">No assessments for this course.</p>}
    </div>
  );
}

export function HomeTopics({ courses }: { courses: CourseData[] }) {
  const [id, setId] = useState(courses[0]?.id ?? "");
  const uid = useId();
  const c = courses.find((x) => x.id === id) ?? courses[0];
  if (!c) return null;
  return (
    <div>
      <Switcher courses={courses} value={c.id} onChange={setId} id={`${uid}-t`} />
      {c.topics.length ? <TopicChecklist key={c.id} rows={c.topics} /> : <p className="co-hint">No topics for this course.</p>}
    </div>
  );
}
