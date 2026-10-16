"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Plus, Trash2, Table2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { TimetableDialog } from "@/components/TimetableDialog";
import { listTimetable, deleteTimetable } from "@/app/calendar-actions";
import { DAY_NAMES, typeLabel, classesOn, countdown, fmtMin, gaps, nextClass, weekdayOf, type TimetableClass } from "@/lib/timetable";

function Line({ c }: { c: TimetableClass }) {
  return (
    <li className="tt-item">
      <span className="tt-time">{fmtMin(c.start_min)} to {fmtMin(c.end_min)}</span>
      <span className="tt-title">{c.title}</span>
      <span className="tt-meta"><span className="tt-badge">{typeLabel(c.class_type)}</span>{c.course_code ? ` ${c.course_code}` : ""}{c.venue ? ` · ${c.venue}` : ""}</span>
    </li>
  );
}

function DayList({ label, day }: { label: string; day: TimetableClass[] }) {
  const free = gaps(day);
  return (
    <div className="tt-day">
      <h4>{label}</h4>
      {day.length === 0 ? <p className="tt-empty">No classes.</p> : (
        <ul className="tt-list">
          {day.map((c, i) => {
            const g = free.find((x) => x.from === c.end_min && day[i + 1]?.start_min === x.to);
            return (
              <li key={c.id} className="tt-li">
                <ul className="tt-list"><Line c={c} /></ul>
                {g && <p className="tt-gap">Suggestion: free {fmtMin(g.from)} to {fmtMin(g.to)}, a possible study slot. Nothing is scheduled.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// "This week" card: next class, today and tomorrow, full week view, add/replace.
export function TimetableWidget({ spaceId }: { spaceId?: string }) {
  const [classes, setClasses] = useState<TimetableClass[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [week, setWeek] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const res = await listTimetable();
    if ("error" in res) { setErr(res.error); setClasses([]); } else { setErr(null); setClasses(res.classes); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);

  const remove = async () => {
    if (!window.confirm("Remove your whole timetable? Your deadlines are not affected.")) return;
    const res = await deleteTimetable();
    if (res.error) { toast(res.error, "error"); return; }
    setWeek(false); load();
  };

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const next = classes ? nextClass(classes, now) : null;

  return (
    <section className="card tt-card" aria-label="This week">
      <div className="tt-head">
        <h3><CalendarClock size={16} aria-hidden="true" /> This week</h3>
        <div className="tt-head-actions">
          <Link href="/timetable" className="btn btn-ghost btn-sm">Open timetable</Link>
          {classes && classes.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWeek(true)}><Table2 size={14} aria-hidden="true" /> Full week</button>}
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> {classes && classes.length ? "Replace" : "Add your timetable"}</button>
        </div>
      </div>
      {classes === null ? <div className="tt-wait"><Loader2 size={16} className="spin" aria-hidden="true" /></div>
        : err ? <p className="tt-empty">{err}</p>
        : classes.length === 0 ? <p className="tt-empty">Photograph your timetable and Logia lists your lectures, labs and venues here. You check it before it is saved.</p>
        : (
          <>
            {next && <p className="tt-next"><b>Next up:</b> {next.c.title} {countdown(next.start, now)}{next.c.venue ? `, ${next.c.venue}` : ""}</p>}
            <DayList label="Today" day={classesOn(classes, now)} />
            <DayList label="Tomorrow" day={classesOn(classes, tomorrow)} />
          </>
        )}

      {adding && <TimetableDialog spaceId={spaceId} onClose={() => setAdding(false)} onSaved={load} />}
      {week && classes && (
        <Dialog title="Your week" onClose={() => setWeek(false)} width={1000}>
          <div className="tt-week">
            {DAY_NAMES.map((name, wd) => {
              const day = classes.filter((c) => c.weekday === wd).sort((a, b) => a.start_min - b.start_min);
              if (day.length === 0 && wd >= 5) return null;
              return (
                <div key={name} className={`tt-col${wd === weekdayOf(now) ? " today" : ""}`}>
                  <h4>{name}</h4>
                  {day.length === 0 ? <p className="tt-empty">Free</p> : <ul className="tt-list">{day.map((c) => <Line key={c.id} c={c} />)}</ul>}
                </div>
              );
            })}
          </div>
          <p className="tt-note">Gaps of an hour or more between classes can be study time. Logia only suggests it, nothing is scheduled.</p>
          <div className="tt-actions"><button type="button" className="btn btn-ghost" onClick={remove} style={{ color: "var(--danger)" }}><Trash2 size={14} aria-hidden="true" /> Remove timetable</button></div>
        </Dialog>
      )}
    </section>
  );
}
