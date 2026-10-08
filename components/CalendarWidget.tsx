"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, Trash2, CalendarClock, Loader2, CalendarDays, Clock, ExternalLink } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { listEvents, saveEvent, setEventDone, deleteEvent, listTimetable, type CalEvent, type CalInput } from "@/app/calendar-actions";
import { TimetableDialog } from "@/components/TimetableDialog";
import { TYPE_LABEL, classesOn, fmtMin, type TimetableClass } from "@/lib/timetable";
import { listLmsItems, type LmsItem } from "@/app/lms-actions";
import { platformLabel } from "@/lib/lmsPlatforms";

// A calendar entry. School items (synced by the browser extension) are read-only and carry `lms`.
type Entry = CalEvent & { lms?: { url: string; course: string; type: LmsItem["item_type"]; platform: string } };
const LMS_COLOR = "#2f5bd3";
const LMS_TYPE: Record<LmsItem["item_type"], string> = { assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", checklist: "Checklist", event: "Event", other: "Item" };
const lmsToEntry = (i: LmsItem): Entry => ({
  id: `lms:${i.id}`, space_id: null, title: i.title, kind: i.item_type === "quiz" ? "test" : "assignment",
  due_at: i.due_at as string, all_day: false, urgency: "medium", color: LMS_COLOR, notes: "", done: i.completed,
  lms: { url: i.url, course: i.course || i.course_code, type: i.item_type, platform: platformLabel(i.source) },
});

// Tests, assignments and tasks with a date/time, urgency and colour.
// Full month view on Space home; compact "coming up" list on the dashboard.
const COLORS = ["#f2836b", "#e8608a", "#e0a03a", "#3fb28a", "#3f8f8a", "#2f5bd3", "#7b4fd6", "#6b6f76"];
const KIND_LABEL: Record<CalEvent["kind"], string> = { test: "Test", assignment: "Assignment", task: "Task", other: "Other" };
const URGENCY: { id: CalEvent["urgency"]; label: string }[] = [
  { id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }, { id: "urgent", label: "Urgent" },
];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

function relative(due: Date, allDay: boolean) {
  const now = new Date();
  const days = Math.round((new Date(ymd(due)).getTime() - new Date(ymd(now)).getTime()) / 86_400_000);
  const time = allDay ? "" : ` ${pad(due.getHours())}:${pad(due.getMinutes())}`;
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return allDay ? "Today" : `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 7) return `${due.toLocaleDateString(undefined, { weekday: "long" })}${time}`;
  return `In ${days} days · ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

type Draft = { id?: string; title: string; kind: CalEvent["kind"]; date: string; time: string; all_day: boolean; urgency: CalEvent["urgency"]; color: string; notes: string };
const newDraft = (date = new Date()): Draft => ({ title: "", kind: "test", date: ymd(date), time: "09:00", all_day: false, urgency: "medium", color: COLORS[0], notes: "" });

// hideLms: the dashboard shows synced school items in their own "From your school" card instead.
export function CalendarWidget({ spaceId, compact = false, hideLms = false }: { spaceId?: string; compact?: boolean; hideLms?: boolean }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [events, setEvents] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the visible month plus the next 60 days (for "coming up") and anything overdue.
  const load = useCallback(async () => {
    const from = new Date(month); from.setDate(from.getDate() - 7);
    const back = new Date(); back.setDate(back.getDate() - 30);
    const to = new Date(month); to.setMonth(to.getMonth() + 1); to.setDate(to.getDate() + 7);
    const ahead = new Date(); ahead.setDate(ahead.getDate() + 60);
    const fromIso = (from < back ? from : back).toISOString(), toIso = (to > ahead ? to : ahead).toISOString();
    const [res, lms] = await Promise.all([listEvents(fromIso, toIso, spaceId), hideLms ? Promise.resolve({ items: [] as LmsItem[] }) : listLmsItems(fromIso, toIso)]);
    if ("error" in res) { setErr(res.error); setEvents([]); } else { setErr(null); setEvents([...res.events, ...lms.items.map(lmsToEntry)]); }
  }, [month, spaceId, hideLms]);
  useEffect(() => { load(); }, [load]);
  // Recurring timetable classes: one row each, expanded per day at render time (never stored as events).
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [ttOpen, setTtOpen] = useState(false);
  const loadClasses = useCallback(async () => { const r = await listTimetable(); if ("classes" in r) setClasses(r.classes); }, []);
  useEffect(() => { if (!compact) loadClasses(); }, [compact, loadClasses]);

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of events ?? []) { const k = ymd(new Date(e.due_at)); m.set(k, [...(m.get(k) ?? []), e]); }
    return m;
  }, [events]);
  const upcoming = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 30);
    return (events ?? []).filter((e) => !e.done && new Date(e.due_at) >= start).sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at)).slice(0, compact ? 5 : 8);
  }, [events, compact]);

  // Month grid (Monday first)
  const cells = useMemo(() => {
    const first = new Date(month); const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);

  const openNew = (d?: Date) => setDraft(newDraft(d ?? selected ?? new Date()));
  const openEdit = (e: CalEvent) => {
    const d = new Date(e.due_at);
    setDraft({ id: e.id, title: e.title, kind: e.kind, date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, all_day: e.all_day, urgency: e.urgency, color: e.color, notes: e.notes });
  };
  const save = async () => {
    if (!draft) return;
    const [y, mo, da] = draft.date.split("-").map(Number);
    const [h, mi] = (draft.all_day ? "23:59" : draft.time || "09:00").split(":").map(Number);
    const due = new Date(y, mo - 1, da, h, mi);
    const input: CalInput = { space_id: spaceId ?? null, title: draft.title, kind: draft.kind, due_at: due.toISOString(), all_day: draft.all_day, urgency: draft.urgency, color: draft.color, notes: draft.notes };
    setSaving(true);
    const res = await saveEvent(input, draft.id);
    setSaving(false);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    setDraft(null); load();
  };
  const toggle = async (e: CalEvent) => {
    setEvents((list) => list?.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)) ?? list);
    const res = await setEventDone(e.id, !e.done);
    if ("error" in res && res.error) { toast(res.error, "error"); load(); }
  };
  const remove = async () => {
    if (!draft?.id) return;
    const res = await deleteEvent(draft.id);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    setDraft(null); load();
  };

  const Item = ({ e }: { e: Entry }) => {
    const due = new Date(e.due_at);
    const overdue = !e.done && due < new Date();
    if (e.lms) {
      const when = relative(due, false);
      return (
        <li className={`cal-item cal-lms${e.done ? " done" : ""}${overdue ? " overdue" : ""}`} style={{ ["--ev" as string]: e.color }}>
          <span className="cal-lms-mark" aria-hidden="true">{e.done ? <Check size={12} /> : null}</span>
          {e.lms.url ? (
            <a className="cal-item-main" href={e.lms.url} target="_blank" rel="noopener noreferrer">
              <span className="cal-item-title">{e.title}<span className="sr-only">{e.done ? " (completed)" : ""}, opens your school site in a new tab</span></span>
              <span className="cal-item-meta">
                <span className="cal-urg medium">{e.lms.platform}</span>
                {LMS_TYPE[e.lms.type]}{e.lms.course ? ` · ${e.lms.course}` : ""} · {when}
                <ExternalLink size={11} aria-hidden="true" />
              </span>
            </a>
          ) : (
            <div className="cal-item-main">
              <span className="cal-item-title">{e.title}</span>
              <span className="cal-item-meta"><span className="cal-urg medium">{e.lms.platform}</span>{LMS_TYPE[e.lms.type]}{e.lms.course ? ` · ${e.lms.course}` : ""} · {when}</span>
            </div>
          )}
        </li>
      );
    }
    return (
      <li className={`cal-item${e.done ? " done" : ""}${overdue ? " overdue" : ""}`} style={{ ["--ev" as string]: e.color }}>
        <button type="button" className="cal-check" onClick={() => toggle(e)} aria-pressed={e.done} aria-label={e.done ? `Mark ${e.title} not done` : `Mark ${e.title} done`}>{e.done && <Check size={12} />}</button>
        <button type="button" className="cal-item-main" onClick={() => openEdit(e)}>
          <span className="cal-item-title">{e.title}</span>
          <span className="cal-item-meta">
            <span className={`cal-urg ${e.urgency}`}>{URGENCY.find((u) => u.id === e.urgency)?.label}</span>
            {KIND_LABEL[e.kind]} · {relative(due, e.all_day)}
          </span>
        </button>
      </li>
    );
  };

  if (err) return <div className="empty card" style={{ padding: 20 }}>{err}</div>;

  const dayEvents = selected ? byDay.get(ymd(selected)) ?? [] : [];
  const dayClasses = selected && !compact ? classesOn(classes, selected) : [];

  return (
    <div className={`cal${compact ? " compact" : ""}`}>
      {!compact && (
        <div className="cal-month card">
          <div className="cal-head">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <h3>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); setSelected(new Date()); }}>Today</button>
          </div>
          <div className="cal-grid" role="grid" aria-label="Calendar">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="cal-dow" aria-hidden="true">{d}</span>)}
            {cells.map((d) => {
              const evs = byDay.get(ymd(d)) ?? [];
              const out = d.getMonth() !== month.getMonth();
              const isSel = selected && sameDay(d, selected);
              return (
                <button key={ymd(d)} type="button" role="gridcell" aria-selected={!!isSel}
                  className={`cal-day${out ? " out" : ""}${sameDay(d, new Date()) ? " today" : ""}${isSel ? " sel" : ""}`}
                  onClick={() => setSelected(d)} onDoubleClick={() => openNew(d)}
                  aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${evs.length ? `, ${evs.length} item${evs.length === 1 ? "" : "s"}` : ""}`}>
                  <span className="cal-num">{d.getDate()}</span>
                  {evs.length > 0 && (
                    <span className="cal-dots" aria-hidden="true">
                      {evs.slice(0, 3).map((e) => <i key={e.id} style={{ background: e.color, opacity: e.done ? .35 : 1 }} className={e.urgency === "urgent" && !e.done ? "urgent" : ""} />)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="cal-side card">
        <div className="cal-side-head">
          <h3>{selected && !compact ? selected.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "Coming up"}</h3>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openNew()}><Plus size={14} aria-hidden="true" /> Add</button>
        </div>
        {events === null ? (
          <div className="cal-wait"><Loader2 size={16} className="spin" aria-hidden="true" /></div>
        ) : (selected && !compact ? dayEvents : upcoming).length === 0 && dayClasses.length === 0 ? (
          <p className="cal-empty"><CalendarDays size={16} aria-hidden="true" /> {selected && !compact ? "Nothing on this day. Double-click a day, or use Add." : "Nothing coming up. Add your next test or deadline."}</p>
        ) : (
          <ul className="cal-list">
            {dayClasses.map((c) => (
              <li key={`tt:${c.id}`} className="cal-item tt-cal">
                <div className="cal-item-main">
                  <span className="cal-item-title">{c.title}</span>
                  <span className="cal-item-meta"><span className="tt-badge">Class</span>{TYPE_LABEL[c.class_type]} · {fmtMin(c.start_min)} to {fmtMin(c.end_min)}{c.venue ? ` · ${c.venue}` : ""}</span>
                </div>
              </li>
            ))}
            {(selected && !compact ? dayEvents : upcoming).map((e) => <Item key={e.id} e={e} />)}
          </ul>
        )}
        {!compact && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTtOpen(true)} style={{ marginTop: 6 }}><CalendarClock size={13} aria-hidden="true" /> Add your timetable</button>}
        {ttOpen && <TimetableDialog spaceId={spaceId} onClose={() => setTtOpen(false)} onSaved={loadClasses} />}
        {selected && !compact && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} style={{ marginTop: 6 }}><Clock size={13} aria-hidden="true" /> Show everything coming up</button>}
      </div>

      {draft && (
        <Dialog title={draft.id ? "Edit item" : "Add to calendar"} onClose={() => setDraft(null)} width={480}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="cal-form">
            <label className="field"><span className="field-label">What is it?</span>
              <input className="input" autoFocus required maxLength={160} placeholder="e.g. Psych 2 test: memory" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="cal-kinds" role="radiogroup" aria-label="Type">
              {(Object.keys(KIND_LABEL) as CalEvent["kind"][]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={draft.kind === k ? "on" : ""} onClick={() => setDraft({ ...draft, kind: k })}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            <div className="cal-row">
              <label className="field"><span className="field-label">Date</span><input className="input" type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              <label className="field"><span className="field-label">Time</span><input className="input" type="time" value={draft.time} disabled={draft.all_day} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /></label>
            </div>
            <label className="cal-allday"><input type="checkbox" checked={draft.all_day} onChange={(e) => setDraft({ ...draft, all_day: e.target.checked })} /> All day (due by end of day)</label>
            <fieldset className="cal-fs"><legend className="field-label">Urgency</legend>
              <div className="cal-urgencies">
                {URGENCY.map((u) => <button key={u.id} type="button" className={`cal-urg-pick ${u.id}${draft.urgency === u.id ? " on" : ""}`} aria-pressed={draft.urgency === u.id} onClick={() => setDraft({ ...draft, urgency: u.id })}>{u.label}</button>)}
              </div>
            </fieldset>
            <fieldset className="cal-fs"><legend className="field-label">Colour</legend>
              <div className="cal-colors">
                {COLORS.map((c) => <button key={c} type="button" className={`cal-color${draft.color === c ? " on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={draft.color === c} onClick={() => setDraft({ ...draft, color: c })} />)}
              </div>
            </fieldset>
            <label className="field"><span className="field-label">Notes <span className="field-hint">(optional)</span></span>
              <textarea className="input" rows={2} maxLength={1000} placeholder="Chapters, venue, what to bring…" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className="cal-actions">
              {draft.id && <button type="button" className="btn btn-ghost" onClick={remove} style={{ color: "var(--danger)" }}><Trash2 size={14} aria-hidden="true" /> Delete</button>}
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !draft.title.trim()}>{saving && <Loader2 size={14} className="spin" aria-hidden="true" />} {draft.id ? "Save" : "Add"}</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
