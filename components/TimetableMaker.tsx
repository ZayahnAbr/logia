"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Camera, Loader2, Printer, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { TimetableDialog } from "@/components/TimetableDialog";
import { deleteClass, listTimetable, saveClass } from "@/app/calendar-actions";
import {
  CLASS_TYPES, DAY_NAMES, DAY_SHORT, PALETTE, TYPE_LABEL, classColor, fmtMin, findClashes, inkOn, parseHM, weekdayOf,
  type ClassType, type TimetableClass,
} from "@/lib/timetable";

type Prefs = { days: 5 | 7; startH: number; endH: number; dense: boolean; venues: boolean; h24: boolean; sunStart: boolean };
const DEFAULT_PREFS: Prefs = { days: 5, startH: 7, endH: 20, dense: false, venues: true, h24: true, sunStart: false };
const PREF_KEY = "logia.timetable.prefs";
const SNAP = 5;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS, ...raw } as Prefs;
    p.days = p.days === 7 ? 7 : 5;
    p.startH = clamp(Math.floor(+p.startH) || 0, 0, 22);
    p.endH = clamp(Math.floor(+p.endH) || 20, p.startH + 1, 24);
    return p;
  } catch { return DEFAULT_PREFS; }
}

function fmtTime(m: number, h24: boolean) {
  if (h24) return fmtMin(m === 1440 ? 1439 : m);
  const h = Math.floor(m / 60) % 24, mi = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mi ? ":" + String(mi).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
}
function hourLabel(h: number, h24: boolean) { return h24 ? `${String(h % 24).padStart(2, "0")}:00` : fmtTime(h * 60, false); }

/** Side-by-side lanes for classes that overlap on one day. */
function lanes(day: TimetableClass[]) {
  const sorted = [...day].sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
  const out = new Map<string, { lane: number; of: number }>();
  let cluster: TimetableClass[] = [], clusterEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    const lane = new Map<string, number>();
    for (const c of cluster) {
      let l = ends.findIndex((e) => e <= c.start_min);
      if (l < 0) { l = ends.length; ends.push(c.end_min); } else ends[l] = c.end_min;
      lane.set(c.id, l);
    }
    for (const c of cluster) out.set(c.id, { lane: lane.get(c.id)!, of: ends.length });
    cluster = [];
  };
  for (const c of sorted) {
    if (cluster.length && c.start_min >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(c); clusterEnd = Math.max(clusterEnd, c.end_min);
  }
  if (cluster.length) flush();
  return out;
}

function unionMinutes(all: TimetableClass[]) {
  let total = 0;
  for (let wd = 0; wd < 7; wd++) {
    const d = all.filter((c) => c.weekday === wd).sort((a, b) => a.start_min - b.start_min);
    let end = -1;
    for (const c of d) { const s = Math.max(c.start_min, end); if (c.end_min > s) total += c.end_min - s; end = Math.max(end, c.end_min); }
  }
  return total;
}
const hm = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;

type Editing = { cls?: TimetableClass; init?: { weekday: number; start_min: number; end_min: number } } | null;

export function TimetableMaker({ initial, spaces, loadError }: { initial: TimetableClass[]; spaces: { id: string; name: string }[]; loadError?: string | null }) {
  const [classes, setClasses] = useState<TimetableClass[]>(initial);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [editing, setEditing] = useState<Editing>(null);
  const [photo, setPhoto] = useState(false);
  const [live, setLive] = useState("");
  const [narrow, setNarrow] = useState(false);
  const [mobileDay, setMobileDay] = useState(() => weekdayOf(new Date()));
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const classesRef = useRef(classes);
  classesRef.current = classes;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 759px)");
    const f = () => setNarrow(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const setPref = (p: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...p };
    if (next.endH <= next.startH) { if (p.startH !== undefined) next.endH = Math.min(24, next.startH + 1); else next.startH = Math.max(0, next.endH - 1); }
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });

  const order = useMemo(() => {
    const base = prefs.sunStart ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
    return prefs.days === 5 ? base.filter((d) => d < 5) : base;
  }, [prefs.days, prefs.sunStart]);
  const days = useMemo(() => {
    if (printing || !narrow) return order;
    return [order.includes(mobileDay) ? mobileDay : order[0]];
  }, [order, narrow, mobileDay, printing]);

  const ppm = (prefs.dense ? 44 : 68) / 60;
  const startMin = prefs.startH * 60, endMin = prefs.endH * 60;
  const bodyH = (endMin - startMin) * ppm;

  const reload = useCallback(async () => {
    const res = await listTimetable();
    if ("error" in res) toast(res.error, "error"); else setClasses(res.classes);
  }, []);

  const persist = useCallback(async (id: string) => {
    const c = classesRef.current.find((x) => x.id === id);
    if (!c) return;
    const res = await saveClass({ id: c.id, title: c.title, course_code: c.course_code, class_type: c.class_type, weekday: c.weekday, start_min: c.start_min, end_min: c.end_min, venue: c.venue, space_id: c.space_id, color: c.color ?? null, notes: c.notes ?? "" });
    if ("error" in res) { toast(res.error, "error"); reload(); } else if (res.warning) toast(res.warning);
  }, [reload]);
  const schedule = useCallback((id: string, delay = 500) => {
    const t = timers.current.get(id); if (t) clearTimeout(t);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); persist(id); }, delay));
  }, [persist]);
  useEffect(() => { const m = timers.current; return () => { m.forEach((t) => clearTimeout(t)); }; }, []);

  const patchLocal = (id: string, p: Partial<TimetableClass>) => setClasses((cur) => cur.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const describe = (c: { title: string; weekday: number; start_min: number; end_min: number }) => `${c.title}, ${DAY_NAMES[c.weekday]} ${fmtTime(c.start_min, prefs.h24)} to ${fmtTime(c.end_min, prefs.h24)}`;

  // Pointer drag (move or resize).
  const drag = useRef<{ id: string; mode: "move" | "resize"; x0: number; y0: number; orig: TimetableClass; moved: boolean } | null>(null);
  const startDrag = (e: React.PointerEvent, c: TimetableClass, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    if (mode === "resize") e.stopPropagation();
    drag.current = { id: c.id, mode, x0: e.clientX, y0: e.clientY, orig: c, moved: false };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current, area = areaRef.current;
      if (!d || !area) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return;
      d.moved = true;
      const dm = snap((ev.clientY - d.y0) / ppm);
      if (d.mode === "resize") {
        patchLocal(d.id, { end_min: clamp(d.orig.end_min + dm, d.orig.start_min + SNAP, 1440) });
      } else {
        const dur = d.orig.end_min - d.orig.start_min, r = area.getBoundingClientRect();
        const idx = clamp(Math.floor(((ev.clientX - r.left) / r.width) * days.length), 0, days.length - 1);
        const s = clamp(d.orig.start_min + dm, 0, 1440 - dur);
        patchLocal(d.id, { weekday: days[idx], start_min: s, end_min: s + dur });
      }
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      const d = drag.current; drag.current = null;
      if (!d) return;
      if (ev.type === "pointercancel") { if (d.moved) patchLocal(d.id, d.orig); return; }
      if (!d.moved) { if (d.mode === "move") setEditing({ cls: d.orig }); return; }
      const now = classesRef.current.find((x) => x.id === d.id);
      if (now) setLive(`${d.mode === "resize" ? "Resized" : "Moved"} ${describe(now)}.`);
      persist(d.id);
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };

  const removeClass = async (c: TimetableClass) => {
    if (!window.confirm(`Delete "${c.title}" from your timetable?`)) return;
    const res = await deleteClass(c.id);
    if (res.error) { toast(res.error, "error"); return; }
    setClasses((cur) => cur.filter((x) => x.id !== c.id));
    setLive(`Deleted ${c.title}.`);
  };

  const onBlockKey = (e: React.KeyboardEvent, c: TimetableClass) => {
    const dur = c.end_min - c.start_min;
    const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (e.key === "Enter") { e.preventDefault(); setEditing({ cls: c }); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeClass(c); return; }
    if (!arrows.includes(e.key)) return;
    e.preventDefault();
    let p: Partial<TimetableClass> | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = e.key === "ArrowUp" ? -SNAP : SNAP;
      if (e.shiftKey) { const end = clamp(c.end_min + step, c.start_min + SNAP, 1440); if (end !== c.end_min) p = { end_min: end }; }
      else { const s = clamp(c.start_min + step, 0, 1440 - dur); if (s !== c.start_min) p = { start_min: s, end_min: s + dur }; }
    } else if (!e.shiftKey) {
      const i = days.indexOf(c.weekday), n = days[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (n !== undefined) p = { weekday: n };
    }
    if (!p) return;
    const next = { ...c, ...p };
    patchLocal(c.id, p);
    setLive(`${describe(next)}.`);
    schedule(c.id);
  };

  const onGridClick = (e: React.MouseEvent) => {
    const area = areaRef.current; if (!area) return;
    const r = area.getBoundingClientRect();
    const idx = clamp(Math.floor(((e.clientX - r.left) / r.width) * days.length), 0, days.length - 1);
    const s = clamp(Math.floor((startMin + (e.clientY - r.top) / ppm) / 15) * 15, 0, 1380);
    setEditing({ init: { weekday: days[idx], start_min: s, end_min: Math.min(s + 60, 1440) } });
  };

  const clashes = useMemo(() => findClashes(classes), [classes]);
  const clashIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const { a, b } of clashes) { m.set(a.id, [...(m.get(a.id) ?? []), b.title]); m.set(b.id, [...(m.get(b.id) ?? []), a.title]); }
    return m;
  }, [clashes]);
  const laneMap = useMemo(() => {
    const m = new Map<string, { lane: number; of: number }>();
    for (let wd = 0; wd < 7; wd++) lanes(classes.filter((c) => c.weekday === wd)).forEach((v, k) => m.set(k, v));
    return m;
  }, [classes]);

  const outside = classes.filter((c) => !order.includes(c.weekday) || c.end_min <= startMin || c.start_min >= endMin || c.start_min < startMin || c.end_min > endMin);
  const showAll = () => {
    const lo = Math.min(prefs.startH, ...outside.map((c) => Math.floor(c.start_min / 60)));
    const hi = Math.max(prefs.endH, ...outside.map((c) => Math.ceil(c.end_min / 60)));
    setPref({ days: outside.some((c) => c.weekday >= 5) ? 7 : prefs.days, startH: lo, endH: hi });
  };
  // A class after the default 8pm cutoff (or before the default 7am start) widens the grid on its own the
  // first time it's seen, instead of silently hiding it behind the "Show everything" link.
  const widenedFor = useRef(new Set<string>());
  useEffect(() => {
    if (outside.length === 0) return;
    const key = outside.map((c) => c.id).sort().join(",");
    if (widenedFor.current.has(key)) return;
    widenedFor.current.add(key);
    showAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside.length, classes]);

  const print = () => {
    setBusy(true); setPrinting(true);
  };
  useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(false); setBusy(false); };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  const total = unionMinutes(classes);
  const hours = Array.from({ length: prefs.endH - prefs.startH + 1 }, (_, i) => prefs.startH + i);

  return (
    <div className="tm">
      <div className="tm-bar">
        <button type="button" className="btn" onClick={() => setEditing({ init: { weekday: days[0] ?? 0, start_min: Math.max(startMin, 9 * 60), end_min: Math.max(startMin, 9 * 60) + 60 } })}>
          <CalendarPlus size={15} aria-hidden="true" /> Add class
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setPhoto(true)}><Camera size={15} aria-hidden="true" /> Add from a photo</button>
        <button type="button" className="btn btn-ghost" onClick={print} disabled={busy || classes.length === 0}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Printer size={15} aria-hidden="true" />} Print or save as PDF
        </button>
        <span className="tm-total">{classes.length ? <>Contact time: <b>{hm(total)}</b> a week</> : null}</span>
      </div>

      <details className="tm-view">
        <summary>View options</summary>
        <div className="tm-view-grid">
          <label className="field"><span className="field-label">Days shown</span>
            <select className="input" value={prefs.days} onChange={(e) => setPref({ days: e.target.value === "7" ? 7 : 5 })}><option value={5}>Monday to Friday</option><option value={7}>Monday to Sunday</option></select></label>
          <label className="field"><span className="field-label">Week starts on</span>
            <select className="input" value={prefs.sunStart ? "sun" : "mon"} onChange={(e) => setPref({ sunStart: e.target.value === "sun" })}><option value="mon">Monday</option><option value="sun">Sunday</option></select></label>
          <label className="field"><span className="field-label">From</span>
            <select className="input" value={prefs.startH} onChange={(e) => setPref({ startH: +e.target.value })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h, prefs.h24)}</option>)}</select></label>
          <label className="field"><span className="field-label">To</span>
            <select className="input" value={prefs.endH} onChange={(e) => setPref({ endH: +e.target.value })}>{Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hourLabel(h, prefs.h24)}</option>)}</select></label>
          <label className="field"><span className="field-label">Row height</span>
            <select className="input" value={prefs.dense ? "compact" : "comfortable"} onChange={(e) => setPref({ dense: e.target.value === "compact" })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <label className="field"><span className="field-label">Times</span>
            <select className="input" value={prefs.h24 ? "24" : "12"} onChange={(e) => setPref({ h24: e.target.value === "24" })}><option value="24">24 hour</option><option value="12">12 hour</option></select></label>
          <label className="tm-check"><input type="checkbox" checked={prefs.venues} onChange={(e) => setPref({ venues: e.target.checked })} /> Show venues</label>
        </div>
        <p className="tm-hint">These settings are kept on this device only.</p>
      </details>

      {loadError && <p className="notice notice-error" role="alert">{loadError}</p>}

      {outside.length > 0 && classes.length > 0 && (
        <p className="tm-note" role="status">
          {outside.length} {outside.length === 1 ? "class is" : "classes are"} outside the days or hours shown.{" "}
          <button type="button" className="tm-linkbtn" onClick={showAll}>Show everything</button>
        </p>
      )}

      {clashes.length > 0 && (
        <div className="tm-clash" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <b>{clashes.length === 1 ? "1 clash" : `${clashes.length} clashes`} in your week</b>
            <ul>{clashes.map(({ a, b }) => <li key={a.id + b.id}>{DAY_NAMES[a.weekday]} {fmtTime(Math.max(a.start_min, b.start_min), prefs.h24)} to {fmtTime(Math.min(a.end_min, b.end_min), prefs.h24)}: {a.title} and {b.title}</li>)}</ul>
          </div>
        </div>
      )}

      {classes.length === 0 ? (
        <div className="tm-empty">
          <h2>Build your weekly timetable</h2>
          <p>Add your lectures, tutorials and labs once. They show on your dashboard, with a countdown to your next class and gaps you could study in. Add them by hand or read them from a photo, a PDF or pasted text.</p>
          <div className="tm-empty-actions">
            <button type="button" className="btn" onClick={() => setEditing({ init: { weekday: 0, start_min: 9 * 60, end_min: 10 * 60 } })}><CalendarPlus size={15} aria-hidden="true" /> Add a class</button>
            <button type="button" className="btn btn-ghost" onClick={() => setPhoto(true)}><Camera size={15} aria-hidden="true" /> Add from a photo</button>
          </div>
        </div>
      ) : (
        <>
          {narrow && !printing && (
            <div className="tm-tabs" role="group" aria-label="Day">
              {order.map((d) => (
                <button key={d} type="button" className="tm-tab" aria-pressed={days[0] === d} onClick={() => setMobileDay(d)}>{DAY_SHORT[d]}</button>
              ))}
            </div>
          )}
          <p id="tm-help" className="tm-hint">Click an empty slot to add a class, click a class to edit it, or drag it to move it. Drag its bottom edge to change its length. With the keyboard, focus a class then use the arrow keys to move it, Shift with the up and down arrows to resize, Enter to edit and Delete to remove. Changes snap to 5 minutes.</p>
          <div className={`tm-print-area${printing ? " is-printing" : ""}`}>
            <h2 className="tm-print-title">My timetable</h2>
            <div className="tm-grid" style={{ ["--tm-n" as string]: days.length }}>
              <div className="tm-head" aria-hidden="true">
                <div className="tm-corner" />
                {days.map((d) => <div key={d} className={`tm-dayh${d === weekdayOf(new Date()) ? " today" : ""}`}>{narrow && !printing ? DAY_NAMES[d] : DAY_SHORT[d]}</div>)}
              </div>
              <div className="tm-body" style={{ height: bodyH }}>
                <div className="tm-gutter" aria-hidden="true">
                  {hours.map((h, i) => <span key={h} className="tm-hl" style={{ top: i * 60 * ppm }}>{hourLabel(h, prefs.h24)}</span>)}
                </div>
                <div className="tm-area" ref={areaRef} style={{ ["--tm-hour" as string]: `${60 * ppm}px` }}>
                  <div className="tm-cols" onClick={onGridClick} aria-hidden="true">
                    {days.map((d) => <div key={d} className="tm-col" />)}
                  </div>
                  <div className="tm-blocks">
                    {classes.filter((c) => days.includes(c.weekday) && c.end_min > startMin && c.start_min < endMin).map((c) => {
                      const di = days.indexOf(c.weekday), ln = laneMap.get(c.id) ?? { lane: 0, of: 1 };
                      const s = Math.max(c.start_min, startMin), e = Math.min(c.end_min, endMin);
                      const h = (e - s) * ppm, bg = classColor(c), clash = clashIds.get(c.id);
                      const w = 100 / days.length / ln.of;
                      return (
                        <div
                          key={c.id} role="button" tabIndex={0} aria-describedby="tm-help"
                          aria-label={`${describe(c)}, ${TYPE_LABEL[c.class_type]}${c.course_code ? " " + c.course_code : ""}${c.venue ? ", " + c.venue : ""}${clash ? `. Clashes with ${clash.join(" and ")}` : ""}`}
                          className={`tm-block${clash ? " clash" : ""}`}
                          style={{ top: (s - startMin) * ppm, height: h, left: `calc(${di * (100 / days.length) + ln.lane * w}% + 2px)`, width: `calc(${w}% - 4px)`, background: bg, color: inkOn(bg) }}
                          onPointerDown={(e) => startDrag(e, c, "move")}
                          onKeyDown={(e) => onBlockKey(e, c)}
                        >
                          <span className="tm-b-title">{clash && <AlertTriangle size={12} aria-hidden="true" />} {c.title}</span>
                          {h >= 34 && <span className="tm-b-sub">{c.course_code ? `${c.course_code} · ` : ""}{TYPE_LABEL[c.class_type]}</span>}
                          {h >= 50 && <span className="tm-b-sub">{fmtTime(c.start_min, prefs.h24)} to {fmtTime(c.end_min, prefs.h24)}</span>}
                          {h >= 66 && prefs.venues && c.venue && <span className="tm-b-sub">{c.venue}</span>}
                          <span className="tm-resize" aria-hidden="true" onPointerDown={(e) => startDrag(e, c, "resize")} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="tm-live" role="status" aria-live="polite">{live}</div>

      {editing && (
        <ClassDialog
          key={editing.cls?.id ?? "new"} editing={editing} spaces={spaces}
          onClose={() => setEditing(null)}
          onSaved={(c, warning) => {
            setClasses((cur) => (cur.some((x) => x.id === c.id) ? cur.map((x) => (x.id === c.id ? c : x)) : [...cur, c]));
            setLive(`${editing.cls ? "Saved" : "Added"} ${describe(c)}.`);
            if (warning) toast(warning);
            setEditing(null);
          }}
          onDelete={editing.cls ? () => { const c = editing.cls!; setEditing(null); removeClass(c); } : undefined}
        />
      )}
      {photo && <TimetableDialog onClose={() => setPhoto(false)} onSaved={() => { setPhoto(false); reload(); }} />}
    </div>
  );
}

function ClassDialog({ editing, spaces, onClose, onSaved, onDelete }: {
  editing: NonNullable<Editing>; spaces: { id: string; name: string }[];
  onClose: () => void; onSaved: (c: TimetableClass, warning?: string) => void; onDelete?: () => void;
}) {
  const c = editing.cls, init = editing.init;
  const [title, setTitle] = useState(c?.title ?? "");
  const [code, setCode] = useState(c?.course_code ?? "");
  const [type, setType] = useState<ClassType>(c?.class_type ?? "lecture");
  const [day, setDay] = useState(c?.weekday ?? init?.weekday ?? 0);
  const [start, setStart] = useState(fmtMin(c?.start_min ?? init?.start_min ?? 540));
  const [end, setEnd] = useState(fmtMin(Math.min(c?.end_min ?? init?.end_min ?? 600, 1439)));
  const [venue, setVenue] = useState(c?.venue ?? "");
  const [color, setColor] = useState<string | null>(c?.color ?? null);
  const [spaceId, setSpaceId] = useState(c?.space_id ?? "");
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const s = parseHM(start), e = parseHM(end);
    if (!title.trim()) { setErr("Give the class a title."); return; }
    if (s === null || e === null) { setErr("Enter a start and end time."); return; }
    if (e <= s) { setErr("The end time must be after the start time."); return; }
    setSaving(true); setErr(null);
    const res = await saveClass({ id: c?.id, title, course_code: code, class_type: type, weekday: day, start_min: s, end_min: e, venue, space_id: spaceId || null, color, notes });
    setSaving(false);
    if ("error" in res) { setErr(res.error); return; }
    onSaved(res.cls, res.warning);
  };

  return (
    <Dialog title={c ? "Edit class" : "Add class"} onClose={onClose} width={520}>
      <form className="tm-form" onSubmit={submit} noValidate>
        <label className="field"><span className="field-label">Title</span>
          <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!err && !title.trim()} required /></label>
        <div className="tm-form-row">
          <label className="field"><span className="field-label">Course code <span className="field-hint">(optional)</span></span>
            <input className="input" value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} /></label>
          <label className="field"><span className="field-label">Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as ClassType)}>{CLASS_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        </div>
        <div className="tm-form-row three">
          <label className="field"><span className="field-label">Day</span>
            <select className="input" value={day} onChange={(e) => setDay(+e.target.value)}>{DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select></label>
          <label className="field"><span className="field-label">Start</span>
            <input className="input" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span className="field-label">End</span>
            <input className="input" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="field"><span className="field-label">Venue <span className="field-hint">(optional)</span></span>
          <input className="input" value={venue} maxLength={80} onChange={(e) => setVenue(e.target.value)} /></label>
        <fieldset className="tm-colors">
          <legend className="field-label">Colour</legend>
          <label className="tm-sw"><input type="radio" name="tm-color" checked={color === null} onChange={() => setColor(null)} /><span className="tm-swatch auto" style={{ background: classColor({ color: null, class_type: type }) }} /><span className="tm-sw-name">Automatic</span></label>
          {PALETTE.map((p) => (
            <label key={p.hex} className="tm-sw"><input type="radio" name="tm-color" checked={color === p.hex} onChange={() => setColor(p.hex)} /><span className="tm-swatch" style={{ background: p.hex }} /><span className="tm-sw-name">{p.name}</span></label>
          ))}
        </fieldset>
        {spaces.length > 0 && (
          <label className="field"><span className="field-label">Link to a space <span className="field-hint">(optional)</span></span>
            <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}><option value="">No space</option>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        )}
        <label className="field"><span className="field-label">Notes <span className="field-hint">(optional)</span></span>
          <textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="tm-form-actions">
          {onDelete && <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={onDelete}><Trash2 size={14} aria-hidden="true" /> Delete</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null} {c ? "Save" : "Add class"}</button>
        </div>
      </form>
    </Dialog>
  );
}
