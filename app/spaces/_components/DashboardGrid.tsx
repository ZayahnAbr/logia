"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, ChevronUp, ChevronDown, Loader2, GripVertical, EyeOff, Columns2, RectangleHorizontal, Palette, Check } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { saveDashboardLayout } from "@/app/actions";
import { WIDGET_COLORS } from "@/lib/customWidgets";
import { setWidgetColor } from "@/app/spaces/[id]/widget-actions";

export type Widget = { id: string; title: string; description: string; node: ReactNode; empty?: boolean };
type Entry = { id: string; visible: boolean; half?: boolean };

// Dashboard defaults — a calm first view; other pages pass their own.
const DASHBOARD_ORDER = ["spaces", "reading", "create", "week", "pain", "papers"];
const NO_HALF: string[] = [];
const DASHBOARD_VISIBLE = ["spaces", "reading", "create"];

// Keeps the saved order, drops sections that no longer exist, appends new ones (visible).
function normalise(saved: Entry[] | null, ids: string[], defaultOrder: string[], defaultVisible: Set<string>, defaultHalf: string[] = []): Entry[] {
  // Ignore malformed entries (e.g. from an older buggy save) instead of crashing.
  const known = (Array.isArray(saved) ? saved : []).filter((e): e is Entry => !!e && typeof e.id === "string" && ids.includes(e.id))
    .filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i);
  const missing = ids.filter((id) => !known.some((e) => e.id === id));
  const base = saved ? known : [];
  const order = saved ? missing : [...defaultOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !defaultOrder.includes(id))];
  return [...base, ...order.map((id) => ({ id, visible: saved ? true : defaultVisible.has(id), ...(!saved && defaultHalf.includes(id) ? { half: true } : {}) }))];
}

export function DashboardGrid({
  widgets, saved = null, syncSupported = false, storageKey = "logia.dashboard.layout",
  defaultOrder = DASHBOARD_ORDER, defaultVisible = DASHBOARD_VISIBLE, syncToAccount = true, dialogTitle = "Customise dashboard", defaultHalf = NO_HALF,
  toolbarExtra, colorSpaceId, colors: savedColors,
}: {
  widgets: Widget[]; saved?: Entry[] | null; syncSupported?: boolean; storageKey?: string;
  defaultOrder?: string[]; defaultVisible?: string[]; syncToAccount?: boolean; dialogTitle?: string; defaultHalf?: string[];
  toolbarExtra?: ReactNode; colorSpaceId?: string; colors?: Record<string, string>;
}) {
  const ids = useMemo(() => widgets.map((w) => w.id), [widgets]);
  const visibleSet = useMemo(() => new Set(defaultVisible), [defaultVisible]);
  const STORAGE_KEY = storageKey;
  const [layout, setLayout] = useState<Entry[]>(() => normalise(saved, ids, defaultOrder, visibleSet, defaultHalf));
  const [editing, setEditing] = useState<Entry[] | null>(null);
  const [customised, setCustomised] = useState(saved !== null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Widgets can be added or removed while the page is open: keep the layout in step with them.
  useEffect(() => {
    setLayout((cur) => {
      const same = cur.length === ids.length && cur.every((e) => ids.includes(e.id)) && ids.every((id) => cur.some((e) => e.id === id));
      return same ? cur : normalise(cur, ids, defaultOrder, visibleSet, defaultHalf);
    });
  }, [ids, defaultOrder, visibleSet, defaultHalf]);

  // Per-widget colours (saved to the account when colorSpaceId is given).
  const [tints, setTints] = useState<Record<string, string>>(savedColors ?? {});
  const [colorOpen, setColorOpen] = useState<string | null>(null);
  const chooseColor = async (id: string, key: string | null) => {
    setTints((cur) => { const n = { ...cur }; if (key) n[id] = key; else delete n[id]; return n; });
    setColorOpen(null);
    document.getElementById(`color-btn-${id}`)?.focus();
    if (!colorSpaceId) return;
    const res = await setWidgetColor(colorSpaceId, id, key);
    setNotice(res.error ?? "Colour saved.");
    window.setTimeout(() => setNotice(null), 4000);
  };

  // No account-level layout yet (or migration not run): fall back to this device's copy.
  useEffect(() => {
    if (saved) return;
    try {
      const local = window.localStorage.getItem(STORAGE_KEY);
      if (local) { setLayout(normalise(JSON.parse(local), ids, defaultOrder, visibleSet, defaultHalf)); setCustomised(true); }
    } catch { /* storage unavailable — keep defaults */ }
  }, [saved, ids, STORAGE_KEY, defaultOrder, visibleSet, defaultHalf]);

  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
  // Until someone customises, sections with nothing in them stay out of the way.
  const visible = layout.filter((e) => e.visible && byId[e.id] && (customised || !byId[e.id].empty));

  const move = (i: number, dir: -1 | 1) => setEditing((cur) => {
    if (!cur) return cur;
    const j = i + dir;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const persist = async (next: Entry[], quiet = false) => {
    setLayout(next);
    setCustomised(true);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    const res = !syncToAccount ? {} : syncSupported ? await saveDashboardLayout(next) : { error: "not-synced" };
    if (quiet && !(res && "error" in res && res.error && syncToAccount)) return;
    setNotice(res && "error" in res && res.error
      ? "Saved on this device. It'll sync to your account once the latest database update (migration 11) is installed."
      : "Layout saved.");
    window.setTimeout(() => setNotice(null), 4000);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    await persist(editing);
    setSaving(false);
    setEditing(null);
  };

  // ── Drag to rearrange (pointer events: mouse, touch and Apple Pencil) ──
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Re-insert the reordered visible sections into the full layout, keeping hidden ones in place.
  const withVisibleOrder = (order: string[]) => {
    const queue = [...order];
    return layout.map((e) => {
      if (!order.includes(e.id)) return e;
      const id = queue.shift();
      return layout.find((x) => x.id === id) ?? e;
    });
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id, order: visible.map((v) => v.id) });
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !listRef.current) return;
    const sections = [...listRef.current.querySelectorAll<HTMLElement>("[data-widget]")];
    let target = 0, best = Infinity;
    sections.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const d = inside ? -1 : Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < best) { best = d; target = i; }
    });
    const from = d.order.indexOf(d.id);
    if (target === from) return;
    const next = d.order.filter((x) => x !== d.id);
    next.splice(target, 0, d.id);
    if (next.join() !== d.order.join()) setDrag({ ...d, order: next });
  };
  const endDrag = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d && d.order.join() !== visible.map((v) => v.id).join()) persist(withVisibleOrder(d.order), true);
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const order = visible.map((v) => v.id);
    const i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persist(withVisibleOrder(order), true);
    requestAnimationFrame(() => document.getElementById(`grip-${id}`)?.focus());
  };
  const hide = (id: string) => persist(layout.map((e) => (e.id === id ? { ...e, visible: false } : e)));
  const toggleHalf = (id: string) => persist(layout.map((e) => (e.id === id ? { ...e, half: !e.half } : e)), true);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {notice && <span role="status" style={{ fontSize: 13, color: "var(--muted)", flex: 1, minWidth: 200 }}>{notice}</span>}
        {toolbarExtra}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(layout)}>
          <SlidersHorizontal size={15} aria-hidden="true" /> {dialogTitle.replace("Customise", "Customise")}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="dash-empty">
          Nothing here yet. Use <strong>{dialogTitle}</strong> to choose which sections to show.
        </div>
      ) : (
        <div ref={listRef} className={`dash-list${drag ? " is-dragging" : ""}`} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {(drag ? drag.order.map((id) => visible.find((v) => v.id === id)!).filter(Boolean) : visible).map((e) => (
            <section key={e.id} data-widget={e.id} aria-labelledby={`dash-${e.id}`} data-tint={tints[e.id] || undefined} className={`dash-widget${e.half ? " is-half" : ""}${tints[e.id] ? ` cw-tinted cw-tint-${tints[e.id]}` : ""}${drag?.id === e.id ? " is-lifted" : ""}`}>
              <div className="dash-widget-head">
                <button type="button" id={`grip-${e.id}`} className="dash-grip" aria-label={`Move ${byId[e.id].title}. Drag, or use the arrow keys`}
                  onPointerDown={(ev) => startDrag(ev, e.id)}
                  onKeyDown={(ev) => { if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") { ev.preventDefault(); nudge(e.id, -1); } if (ev.key === "ArrowDown" || ev.key === "ArrowRight") { ev.preventDefault(); nudge(e.id, 1); } }}>
                  <GripVertical size={16} aria-hidden="true" />
                </button>
                <h2 id={`dash-${e.id}`} style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>{byId[e.id].title}</h2>
                {colorSpaceId && (
                  <div className="cw-color" onKeyDown={(ev) => { if (ev.key === "Escape" && colorOpen === e.id) { ev.stopPropagation(); setColorOpen(null); document.getElementById(`color-btn-${e.id}`)?.focus(); } }}>
                    <button type="button" id={`color-btn-${e.id}`} className="dash-hide btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded={colorOpen === e.id}
                      aria-label={`Colour for ${byId[e.id].title}`} onClick={() => setColorOpen(colorOpen === e.id ? null : e.id)}>
                      <Palette size={14} aria-hidden="true" /> Colour
                    </button>
                    {colorOpen === e.id && (
                      <div className="cw-color-pop" role="group" aria-label={`Colour for ${byId[e.id].title}`}>
                        <button type="button" className="cw-sw cw-sw-default" aria-pressed={!tints[e.id]} onClick={() => chooseColor(e.id, null)}>
                          <span className="cw-sw-dot" aria-hidden="true">{!tints[e.id] && <Check size={12} />}</span> Default
                        </button>
                        {WIDGET_COLORS.map((c) => (
                          <button key={c.key} type="button" className="cw-sw" aria-pressed={tints[e.id] === c.key} onClick={() => chooseColor(e.id, c.key)}>
                            <span className="cw-sw-dot" aria-hidden="true" style={{ background: c.hex }}>{tints[e.id] === c.key && <Check size={12} />}</span> {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="dash-hide btn btn-ghost btn-sm" onClick={() => toggleHalf(e.id)} aria-pressed={!!e.half}
                  aria-label={e.half ? `Make ${byId[e.id].title} full width` : `Make ${byId[e.id].title} half width`} title={e.half ? "Full width" : "Half width"}>
                  {e.half ? <RectangleHorizontal size={14} aria-hidden="true" /> : <Columns2 size={14} aria-hidden="true" />} {e.half ? "Full" : "Half"}
                </button>
                <button type="button" className="dash-hide btn btn-ghost btn-sm" onClick={() => hide(e.id)} aria-label={`Hide ${byId[e.id].title}`}>
                  <EyeOff size={14} aria-hidden="true" /> Hide
                </button>
              </div>
              {byId[e.id].node}
            </section>
          ))}
        </div>
      )}

      {editing && (
        <Dialog title={dialogTitle} onClose={() => setEditing(null)} width={480}>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px" }}>
            Choose which sections appear and put them in the order you want.
          </p>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {editing.map((e, i) => {
              const w = byId[e.id];
              if (!w) return null;
              return (
                <li key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
                  <input type="checkbox" id={`w-${e.id}`} checked={e.visible} style={{ width: 18, height: 18, accentColor: "var(--accent)", flexShrink: 0 }}
                    onChange={(ev) => setEditing((cur) => cur!.map((x) => (x.id === e.id ? { ...x, visible: ev.target.checked } : x)))} />
                  <label htmlFor={`w-${e.id}`} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{w.title}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{w.description}</span>
                  </label>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${w.title} up`} onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={16} /></button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${w.title} down`} onClick={() => move(i, 1)} disabled={i === editing.length - 1}><ChevronDown size={16} /></button>
                </li>
              );
            })}
          </ol>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 20, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(normalise(null, ids, defaultOrder, visibleSet, defaultHalf))}>Reset to default</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving} aria-busy={saving}>
                {saving ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</> : "Save dashboard"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
