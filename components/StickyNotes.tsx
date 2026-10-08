"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { listStickies, addSticky, updateSticky, deleteSticky, type Sticky } from "@/app/sticky-actions";
import { toast } from "@/components/Toaster";

const COLORS = [
  { id: "yellow", label: "Yellow", bg: "#fff3b0" },
  { id: "pink", label: "Pink", bg: "#fde0e4" },
  { id: "blue", label: "Blue", bg: "#dcebfb" },
  { id: "green", label: "Green", bg: "#e1f1dc" },
  { id: "peach", label: "Peach", bg: "#fde5d2" },
];
const bgFor = (c: string) => COLORS.find((x) => x.id === c)?.bg ?? COLORS[0].bg;

// Quick jottings on Space home. Saves as you type (debounced), private to you.
export function StickyNotes({ spaceId }: { spaceId: string }) {
  const [notes, setNotes] = useState<Sticky[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fresh = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Remember each note's size (drag the corner to resize) on this device.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !notes) return;
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const t = en.target as HTMLElement, id = t.dataset.id!;
        clearTimeout(saveTimers.get(id));
        saveTimers.set(id, setTimeout(() => {
          try { localStorage.setItem(`logia.sticky.${id}`, JSON.stringify({ w: t.offsetWidth, h: t.offsetHeight })); } catch { /* storage blocked */ }
        }, 300));
      }
    });
    el.querySelectorAll<HTMLElement>("[data-id]").forEach((n) => ro.observe(n));
    return () => { ro.disconnect(); saveTimers.forEach(clearTimeout); };
  }, [notes]);
  // Drag a note by its top strip to move it.
  const dragId = useRef<string | null>(null);
  const saveOrder = (list: Sticky[]) => { try { localStorage.setItem(`logia.stickies.${spaceId}.order`, JSON.stringify(list.map((n) => n.id))); } catch { /* */ } };
  const onGrab = (e: React.PointerEvent, id: string) => { e.preventDefault(); dragId.current = id; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onDragMove = (e: React.PointerEvent) => {
    const id = dragId.current; const el = listRef.current;
    if (!id || !el || !notes) return;
    let best = Infinity, target = -1;
    el.querySelectorAll<HTMLElement>("[data-id]").forEach((n, i) => {
      const r = n.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < best) { best = d; target = i; }
    });
    const from = notes.findIndex((n) => n.id === id);
    if (target < 0 || target === from) return;
    const next = [...notes]; const [m] = next.splice(from, 1); next.splice(target, 0, m);
    setNotes(next);
  };
  const onDrop = () => { if (dragId.current && notes) saveOrder(notes); dragId.current = null; };
  const moveBy = (id: string, dir: -1 | 1) => setNotes((list) => {
    if (!list) return list;
    const i = list.findIndex((n) => n.id === id), j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; saveOrder(next); return next;
  });
  const sizeOf = (id: string) => { try { const v = JSON.parse(localStorage.getItem(`logia.sticky.${id}`) || "null"); return v ? { width: v.w, height: v.h } : {}; } catch { return {}; } };

  useEffect(() => {
    listStickies(spaceId).then((r) => {
      if ("error" in r) { setErr(r.error); return; }
      let order: string[] = [];
      try { order = JSON.parse(localStorage.getItem(`logia.stickies.${spaceId}.order`) || "[]"); } catch { /* */ }
      const rank = (id: string) => { const i = order.indexOf(id); return i === -1 ? Infinity : i; };
      setNotes([...r.notes].sort((a, b) => rank(a.id) - rank(b.id)));
    });
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [spaceId]);

  const add = async () => {
    setAdding(true);
    const used = new Set((notes ?? []).map((n) => n.color));
    const color = COLORS.find((c) => !used.has(c.id))?.id ?? COLORS[(notes?.length ?? 0) % COLORS.length].id;
    const r = await addSticky(spaceId, color);
    setAdding(false);
    if ("error" in r && r.error) { toast(r.error, "error"); return; }
    fresh.current = r.note!.id;
    setNotes((n) => [...(n ?? []), r.note!]);
  };

  const edit = (id: string, body: string) => {
    setNotes((n) => n?.map((x) => (x.id === id ? { ...x, body } : x)) ?? n);
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(async () => {
      const r = await updateSticky(id, { body });
      if ("error" in r && r.error) toast(r.error, "error");
    }, 700));
  };

  const recolor = async (id: string, color: string) => {
    setNotes((n) => n?.map((x) => (x.id === id ? { ...x, color } : x)) ?? n);
    await updateSticky(id, { color });
  };

  const remove = async (id: string) => {
    const prev = notes;
    setNotes((n) => n?.filter((x) => x.id !== id) ?? n);
    const r = await deleteSticky(id);
    if ("error" in r && r.error) { toast(r.error, "error"); setNotes(prev); }
  };

  if (err) return <div className="empty card" style={{ padding: "20px" }}>{err}</div>;
  if (!notes) return <div className="stickies"><div className="sticky skeleton" /><div className="sticky skeleton" /></div>;

  return (
    <ul ref={listRef} className="stickies" aria-label="Sticky notes" onPointerMove={onDragMove} onPointerUp={onDrop} onPointerCancel={onDrop}>
      {notes.map((n, i) => (
        <li key={n.id} data-id={n.id} className="sticky" style={{ background: bgFor(n.color), ["--tilt" as string]: `${(i % 3) - 1}deg`, ...sizeOf(n.id) }}>
          <button type="button" className="sticky-grab" aria-label={`Move sticky note ${i + 1}. Drag, or use the arrow keys`}
            onPointerDown={(e) => onGrab(e, n.id)}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveBy(n.id, -1); } if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveBy(n.id, 1); } }} />
          <label htmlFor={`sticky-${n.id}`} className="sr-only">Sticky note {i + 1}</label>
          <textarea id={`sticky-${n.id}`} value={n.body} maxLength={2000} placeholder="Jot something down…"
            autoFocus={fresh.current === n.id} onChange={(e) => edit(n.id, e.target.value)} />
          <div className="sticky-bar">
            <span role="radiogroup" aria-label="Colour" style={{ display: "flex", gap: 4 }}>
              {COLORS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={n.color === c.id} aria-label={c.label}
                  className="sticky-dot" style={{ background: c.bg }} onClick={() => recolor(n.id, c.id)} />
              ))}
            </span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Delete sticky note" onClick={() => remove(n.id)}><Trash2 size={14} /></button>
          </div>
        </li>
      ))}
      <li>
        <button type="button" className="sticky sticky-add" onClick={add} disabled={adding}>
          {adding ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          {notes.length ? "Add a sticky note" : "Add your first sticky note"}
        </button>
      </li>
    </ul>
  );
}
