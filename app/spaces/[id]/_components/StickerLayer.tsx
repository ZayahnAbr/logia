"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical, Palette, Check, Trash2, Loader2, MoveDiagonal2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import {
  WIDGET_COLORS, STICKER_MIN_W, STICKER_MAX_W, STICKER_DEFAULT_IMAGE_W, STICKER_DEFAULT_TEXT_W, STICKER_MAX_Y,
  STICKER_DEFAULT_STICKY_W, type ImageData, type TextData, type StickyData, type StickerPos,
} from "@/lib/customWidgets";
import { removeCustomWidget, saveStickerPos, setWidgetColor } from "../widget-actions";
import { ImageStickerBody, TextStickerBody, StickyStickerBody } from "./CustomWidgets";

export type Sticker = { id: string; kind: "image" | "text" | "sticky"; data: ImageData | TextData | StickyData; src: string | null };

const GAP = 12;
const MARGIN = 16;
// A small, stable tilt per note (-2 to 2 degrees). CSS removes it for people who prefer reduced motion.
const tiltFor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return (Math.abs(h) % 5) - 2; };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const label = (s: Sticker) => (s.kind === "text" ? "Text sticker" : s.kind === "sticky" ? "Sticky note" : `Image sticker: ${(s.data as ImageData).alt || (s.data as ImageData).caption || "picture"}`);

export function StickerLayer({ spaceId, stickers, colors, children }: { spaceId: string; stickers: Sticker[]; colors: Record<string, string>; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [local, setLocal] = useState<Record<string, StickerPos>>({});
  const localRef = useRef(local);
  localRef.current = local;
  const [tints, setTints] = useState<Record<string, string>>(colors);
  const [colorOpen, setColorOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Sticker | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});
  const [active, setActive] = useState<{ id: string; mode: "move" | "resize" } | null>(null);
  const gesture = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; left: number; top: number; w: number } | null>(null);

  const list = useMemo(() => stickers.filter((s) => !removed.includes(s.id)), [stickers, removed]);

  // Container width (re-clamps stickers when the window or sidebar changes) and the mobile switch.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mq = window.matchMedia("(max-width: 759px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => { ro.disconnect(); mq.removeEventListener("change", on); };
  }, []);

  // Measured heights, so the container can grow and default positions never overlap.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setHeights((cur) => {
        const next = { ...cur };
        let changed = false;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.sid;
          const h = Math.round((e.target as HTMLElement).offsetHeight);
          if (id && next[id] !== h) { next[id] = h; changed = true; }
        }
        return changed ? next : cur;
      });
    });
    el.querySelectorAll<HTMLElement>("[data-sid]").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [list, mobile]);

  const merged = useCallback((s: Sticker): StickerPos => ({ ...(s.data as StickerPos), ...local[s.id] }), [local]);

  // Final geometry: stored values, or a default stacked down the top right; always inside the container.
  const geo = useMemo(() => {
    const out: Record<string, { left: number; top: number; w: number; z: number }> = {};
    let cursor = 8;
    const maxW = Math.max(STICKER_MIN_W, Math.min(STICKER_MAX_W, W - 2));
    list.forEach((s, i) => {
      const p = merged(s);
      const baseW = s.kind === "text" ? STICKER_DEFAULT_TEXT_W : s.kind === "sticky" ? STICKER_DEFAULT_STICKY_W : STICKER_DEFAULT_IMAGE_W;
      const w = clamp(Math.round(p.w ?? baseW), STICKER_MIN_W, Math.min(maxW, Math.max(STICKER_MIN_W, W)));
      const h = heights[s.id] ?? 160;
      let left: number, top: number;
      if (typeof p.x === "number" && typeof p.y === "number") { left = p.x * W; top = p.y; }
      else { left = W - w - MARGIN; top = cursor; cursor += h + GAP; }
      left = clamp(left, 0, Math.max(0, W - w));
      top = clamp(top, 0, STICKER_MAX_Y);
      out[s.id] = { left, top, w, z: p.z ?? i };
    });
    return out;
  }, [list, merged, W, heights]);

  const rank = useMemo(() => {
    const order = [...list].sort((a, b) => (geo[a.id]?.z ?? 0) - (geo[b.id]?.z ?? 0));
    return Object.fromEntries(order.map((s, i) => [s.id, i]));
  }, [list, geo]);

  const height = mobile ? 0 : Math.max(0, ...list.map((s) => (geo[s.id]?.top ?? 0) + (heights[s.id] ?? 0))) + (list.length ? MARGIN : 0);

  const flush = useCallback((id: string) => {
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(async () => {
      const g = geoRef.current[id];
      const W2 = wRef.current;
      if (!g || !W2) return;
      const r = await saveStickerPos(id, { x: g.left / W2, y: g.top, w: g.w, z: zRef.current[id] ?? g.z });
      if (r.error) { setNotice(r.error); window.setTimeout(() => setNotice(null), 5000); }
    }, 700);
  }, []);
  const geoRef = useRef(geo); geoRef.current = geo;
  const wRef = useRef(W); wRef.current = W;
  const zRef = useRef<Record<string, number>>({});

  const update = (id: string, patch: { left?: number; top?: number; w?: number }) => {
    const g = geo[id];
    if (!g || !W) return;
    const w = clamp(patch.w ?? g.w, STICKER_MIN_W, Math.min(STICKER_MAX_W, W));
    const left = clamp(patch.left ?? g.left, 0, Math.max(0, W - w));
    const top = clamp(patch.top ?? g.top, 0, STICKER_MAX_Y);
    geoRef.current = { ...geoRef.current, [id]: { ...g, left, top, w } };
    setLocal((cur) => ({ ...cur, [id]: { ...cur[id], x: left / W, y: top, w, z: zRef.current[id] ?? g.z } }));
    flush(id);
  };

  const toFront = (id: string) => {
    const zs = list.map((s) => geo[s.id]?.z ?? 0);
    const mine = geo[id]?.z ?? 0;
    if (mine >= Math.max(...zs) && zs.filter((z) => z === mine).length === 1) return;
    const z = Math.min(1_000_000, Math.max(...zs) + 1);
    zRef.current[id] = z;
    const g = geo[id];
    if (!g || !W) return;
    setLocal((cur) => ({ ...cur, [id]: { ...cur[id], x: g.left / W, y: g.top, w: g.w, z } }));
    flush(id);
  };

  // Pointer gestures (mouse, touch and pen). Pointer capture keeps them going outside the sticker.
  const begin = (e: React.PointerEvent<HTMLElement>, id: string, mode: "move" | "resize") => {
    if (mobile || e.button > 0) return;
    const g = geo[id];
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    (e.currentTarget.closest("[data-sid]") as HTMLElement | null)?.focus({ preventScroll: true });
    gesture.current = { id, mode, sx: e.clientX, sy: e.clientY, left: g.left, top: g.top, w: g.w };
    setActive({ id, mode });
    toFront(id);
    // Track on the window so the gesture survives leaving the handle or the sticker.
    const move = (ev: PointerEvent) => onMoveRef.current(ev.clientX, ev.clientY);
    const up = () => { gesture.current = null; setActive(null); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const moveTo = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    const dx = x - g.sx, dy = y - g.sy;
    if (g.mode === "move") update(g.id, { left: g.left + dx, top: g.top + dy });
    // Dragging right or down both grow it (diagonal handle), so either direction works.
    else update(g.id, { w: Math.min(g.w + (Math.abs(dx) >= Math.abs(dy) ? dx : dy), W - g.left) });
  };
  const onMoveRef = useRef(moveTo);
  onMoveRef.current = moveTo;
  const onMove = () => {};
  const end = () => {};

  const onKey = (e: React.KeyboardEvent<HTMLElement>, s: Sticker) => {
    if (e.target !== e.currentTarget || mobile) return;
    const g = geo[s.id];
    if (!g) return;
    const step = e.shiftKey ? 32 : 8;
    const k = e.key;
    if (k === "ArrowLeft") update(s.id, { left: g.left - step });
    else if (k === "ArrowRight") update(s.id, { left: g.left + step });
    else if (k === "ArrowUp") update(s.id, { top: g.top - step });
    else if (k === "ArrowDown") update(s.id, { top: g.top + step });
    else if (k === "+" || k === "=") update(s.id, { w: g.w + (e.shiftKey ? 64 : 16) });
    else if (k === "-" || k === "_") update(s.id, { w: g.w - (e.shiftKey ? 64 : 16) });
    else if (k === "Delete" || k === "Backspace") setConfirm(s);
    else return;
    e.preventDefault();
  };

  const chooseColor = async (id: string, key: string | null) => {
    setTints((cur) => { const n = { ...cur }; if (key) n[`cw-${id}`] = key; else delete n[`cw-${id}`]; return n; });
    setColorOpen(null);
    document.getElementById(`st-color-${id}`)?.focus();
    const r = await setWidgetColor(spaceId, `cw-${id}`, key);
    setNotice(r.error ?? "Colour saved.");
    window.setTimeout(() => setNotice(null), 4000);
  };

  const doRemove = async () => {
    if (!confirm) return;
    setBusy(true);
    const r = await removeCustomWidget(spaceId, confirm.id);
    setBusy(false);
    if (r.error) { setNotice(r.error); window.setTimeout(() => setNotice(null), 5000); setConfirm(null); return; }
    setRemoved((cur) => [...cur, confirm.id]);
    setConfirm(null);
  };

  const render = (s: Sticker) => {
    const g = geo[s.id];
    const tint = tints[`cw-${s.id}`];
    const abs = !mobile;
    const style = abs
      ? { ["--st-w" as string]: `${g?.w ?? 220}px`, left: g?.left ?? 0, top: g?.top ?? 0, width: g?.w ?? 220, zIndex: 5 + (rank[s.id] ?? 0), visibility: W ? undefined : ("hidden" as const) }
      : { ["--st-w" as string]: `${g?.w ?? 220}px`, width: `min(100%, ${g?.w ?? 220}px)` };
    const isText = s.kind === "text";
    const isSticky = s.kind === "sticky";
    return (
      <div key={s.id} data-sid={s.id} tabIndex={0} role="group" aria-label={`${label(s)}.${mobile ? "" : " Arrow keys move it, plus and minus resize it, Delete removes it."}`}
        className={`st ${isText ? "st-text" : isSticky ? "st-sticky" : "st-image"}${tint ? ` st-tinted cw-tint-${tint}` : ""}${colorOpen === s.id ? " is-open" : ""}${abs ? " is-abs" : ""}${active?.id === s.id ? ` is-${active.mode}` : ""}`}
        style={style}
        onKeyDown={(e) => onKey(e, s)}
        onPointerDown={!isText && abs ? (e) => { if (!(e.target as HTMLElement).closest(isSticky ? "button,a,input,select,textarea" : "button,a,input,select")) begin(e, s.id, "move"); } : undefined}
        onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
        onFocus={() => { if (abs) toFront(s.id); }}>
        <div className="st-bar">
          {(isText || isSticky) && abs && (
            <button type="button" className="st-btn st-grip" aria-label={`Move ${isSticky ? "sticky note" : "text"}. Drag, or focus the ${isSticky ? "note" : "text box"} itself and use the arrow keys`} title="Drag to move"
              onPointerDown={(e) => begin(e, s.id, "move")}><GripVertical size={14} aria-hidden="true" /></button>
          )}
          {isText && (
            <div className="cw-color" onKeyDown={(e) => { if (e.key === "Escape" && colorOpen === s.id) { e.stopPropagation(); setColorOpen(null); document.getElementById(`st-color-${s.id}`)?.focus(); } }}>
              <button type="button" id={`st-color-${s.id}`} className="st-btn" aria-haspopup="true" aria-expanded={colorOpen === s.id} aria-label="Text colour"
                onClick={() => setColorOpen(colorOpen === s.id ? null : s.id)}><Palette size={14} aria-hidden="true" /></button>
              {colorOpen === s.id && (
                <div className="cw-color-pop" role="group" aria-label="Text colour">
                  <button type="button" className="cw-sw cw-sw-default" aria-pressed={!tint} onClick={() => chooseColor(s.id, null)}>
                    <span className="cw-sw-dot" aria-hidden="true">{!tint && <Check size={12} />}</span> Default
                  </button>
                  {WIDGET_COLORS.map((c) => (
                    <button key={c.key} type="button" className="cw-sw" aria-pressed={tint === c.key} onClick={() => chooseColor(s.id, c.key)}>
                      <span className="cw-sw-dot" aria-hidden="true" style={{ background: c.hex }}>{tint === c.key && <Check size={12} />}</span> {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" className="st-btn" aria-label={`Remove ${isText ? "text" : isSticky ? "sticky note" : "image"}`} title="Remove" onClick={() => setConfirm(s)}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
        {isText ? <TextStickerBody id={s.id} data={s.data as TextData} /> : isSticky ? <StickyStickerBody id={s.id} data={s.data as StickyData} tilt={tiltFor(s.id)} /> : <ImageStickerBody data={s.data as ImageData} src={s.src} />}
        {abs && (
          <button type="button" className="st-resize" aria-label="Resize. Drag, or focus the sticker and press plus or minus" title="Drag to resize"
            onPointerDown={(e) => begin(e, s.id, "resize")}><MoveDiagonal2 size={14} aria-hidden="true" /></button>
        )}
      </div>
    );
  };

  return (
    <div ref={root} className="st-root" data-has-stickers={list.length > 0 || undefined} style={height ? { minHeight: height } : undefined}>
      {mobile && list.length > 0 && <div className="st-flow">{list.map(render)}</div>}
      {children}
      {!mobile && list.map(render)}
      <div role="status" className="sr-only">{notice}</div>
      {notice && <p className="st-notice" aria-hidden="true">{notice}</p>}
      {confirm && (
        <Dialog title={`Remove this ${confirm.kind === "text" ? "text" : confirm.kind === "sticky" ? "sticky note" : "image"}?`} onClose={() => setConfirm(null)} width={420}>
          <p className="cw-note">It will be removed from this space home. This cannot be undone.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={doRemove}>
              {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Remove
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
