"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Caveat, Gochi_Hand, Shadows_Into_Light, Patrick_Hand, Permanent_Marker } from "next/font/google";
import { Brush, Eraser, ImageIcon, Layers as LayersIcon, Loader2, MousePointer2, Redo2, Sticker as StickerIcon, Trash2, Type, Undo2, Upload } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { dropProps } from "@/lib/dropProps";
import { POSTER, SCENE_IDS, SCENE_LABEL, type LoopSceneId } from "@/lib/loopScenes";
import { listSavedStickers, type SavedSticker } from "@/app/spaces/[id]/widget-actions";
import {
  COVER_DOC_MAX_CHARS, COVER_H, COVER_MAX_BYTES, COVER_W, FONT_IDS, FONT_LABEL, PALETTE, STAMP_FILLABLE, STAMP_KINDS, STAMP_LABEL, STAMP_PATH,
  emptyDoc, type CoverDoc, type CoverFontId, type CoverItem, type Pt, type StampKind, type Stroke,
} from "@/lib/coverDoc";
import { boxOf, handlesOf, hitItem, renderCover, strokeHit, type Drawable } from "@/lib/coverRender";

// Handwriting fonts load only when this editor is opened (the editor is imported lazily by the host form).
const caveat = Caveat({ subsets: ["latin"], display: "swap" });
const gochi = Gochi_Hand({ subsets: ["latin"], weight: "400", display: "swap" });
const shadows = Shadows_Into_Light({ subsets: ["latin"], weight: "400", display: "swap" });
const patrick = Patrick_Hand({ subsets: ["latin"], weight: "400", display: "swap" });
const marker = Permanent_Marker({ subsets: ["latin"], weight: "400", display: "swap" });
const FAM: Record<CoverFontId, string> = {
  caveat: caveat.style.fontFamily, gochi: gochi.style.fontFamily, shadows: shadows.style.fontFamily, patrick: patrick.style.fontFamily, marker: marker.style.fontFamily,
};

type Section = "photo" | "text" | "draw" | "stamps" | "stickers" | "layers";
type Tool = "select" | "pen" | "eraser";
type Drag =
  | { mode: "move"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { mode: "resize"; id: string; cx: number; cy: number; d0: number; size0: number; moved: boolean }
  | { mode: "rotate"; id: string; cx: number; cy: number; moved: boolean }
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { mode: "pen" }
  | { mode: "erase"; pushed: boolean };

const SIZE_RANGE = { text: [14, 400], stamp: [20, 600], sticker: [30, 1000] } as const;
const newId = () => crypto.randomUUID().slice(0, 8);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type CoverResult = { blob: Blob; doc: CoverDoc };

function Colors({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="ce-colors" role="group" aria-label={label}>
      {PALETTE.map((c) => (
        <button key={c.hex} type="button" className={`ce-sw${value.toLowerCase() === c.hex ? " on" : ""}`} style={{ background: c.hex }} aria-label={c.name} aria-pressed={value.toLowerCase() === c.hex} onClick={() => onChange(c.hex)} />
      ))}
      <label className="ce-custom"><span className="sr-only">Custom colour</span>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
function Range({ uid, id, label, value, min, max, step = 1, onChange, unit = "" }: { uid: string; id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="ce-row"><label htmlFor={`${uid}-${id}`}>{label} <output>{Math.round(value)}{unit}</output></label>
      <input id={`${uid}-${id}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>
  );
}

export default function CoverEditor({ scene, focus, brk, initialDoc, onClose, onDone }: {
  scene: LoopSceneId | null; focus: number; brk: number; initialDoc: CoverDoc | null;
  onClose: () => void; onDone: (r: CoverResult) => void;
}) {
  const uid = useId();
  const [doc, setDoc] = useState<CoverDoc>(() => initialDoc ?? emptyDoc(scene ?? undefined));
  const docRef = useRef(doc);
  const [photo, setPhoto] = useState<Drawable | null>(null);
  const [stickers, setStickers] = useState<Map<string, HTMLImageElement>>(new Map());
  const [library, setLibrary] = useState<SavedSticker[] | null>(null);
  const [libNote, setLibNote] = useState("");
  const [fontTick, setFontTick] = useState(0);
  const [section, setSection] = useState<Section>("photo");
  const [tool, setTool] = useState<Tool>("select");
  const [selId, setSelId] = useState<string | null>(null);
  const [ink, setInk] = useState("#fff6e5");
  const [penSize, setPenSize] = useState(8);
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [, setHist] = useState(0);
  const [needsPhoto, setNeedsPhoto] = useState(() => initialDoc?.photo.kind === "upload");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const undo = useRef<CoverDoc[]>([]);
  const redo = useRef<CoverDoc[]>([]);
  const lastKey = useRef<{ k: string; t: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef<Stroke | null>(null);
  const raf = useRef(0);
  const view = useRef({ photo: null as Drawable | null, stickers: new Map<string, HTMLImageElement>(), sel: null as string | null, k: 1 });

  const say = (m: string) => setStatus(m);
  const apply = (d: CoverDoc) => { docRef.current = d; setDoc(d); };
  const bump = () => setHist((n) => n + 1);
  const pushUndo = (prev: CoverDoc) => { undo.current.push(prev); if (undo.current.length > 60) undo.current.shift(); redo.current = []; bump(); };
  const commit = (next: CoverDoc, key?: string) => {
    const now = Date.now();
    if (!(key && lastKey.current && lastKey.current.k === key && now - lastKey.current.t < 900)) pushUndo(docRef.current);
    lastKey.current = key ? { k: key, t: now } : null;
    apply(next);
  };
  const doUndo = () => { const p = undo.current.pop(); if (!p) return; redo.current.push(docRef.current); apply(p); lastKey.current = null; bump(); say("Undone."); };
  const doRedo = () => { const n = redo.current.pop(); if (!n) return; undo.current.push(docRef.current); apply(n); lastKey.current = null; bump(); say("Redone."); };

  const items = doc.items;
  const sel = items.find((i) => i.id === selId) ?? null;
  const patchItem = (id: string, patch: Partial<CoverItem>, key?: string) =>
    commit({ ...docRef.current, items: docRef.current.items.map((i) => (i.id === id ? ({ ...i, ...patch } as CoverItem) : i)) }, key);
  const patchPhoto = (patch: Partial<CoverDoc["photo"]>, key?: string) => commit({ ...docRef.current, photo: { ...docRef.current.photo, ...patch } }, key);

  // ---- painting ----
  const paint = useCallback(() => {
    const c = canvasRef.current; const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const v = view.current;
    renderCover(ctx, docRef.current, { photo: v.photo, stickers: v.stickers, fam: FAM, live: live.current, overlay: { selectedId: v.sel, k: v.k }, fallback: "#2f4858" });
  }, []);
  const schedulePaint = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; paint(); }); };
  useEffect(() => {
    view.current.photo = photo; view.current.stickers = stickers; view.current.sel = selId;
    paint();
  }, [doc, photo, stickers, selId, fontTick, paint]);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ro = new ResizeObserver(() => { view.current.k = COVER_W / Math.max(1, c.getBoundingClientRect().width); paint(); });
    ro.observe(c);
    return () => ro.disconnect();
  }, [paint]);
  useEffect(() => {
    let dead = false;
    Promise.all(FONT_IDS.map((id) => document.fonts.load(`40px ${FAM[id]}`, "Aa<3*").catch(() => []))).then(() => { if (!dead) setFontTick((n) => n + 1); });
    return () => { dead = true; };
  }, []);

  // ---- photo ----
  const loadImg = (src: string, cross?: boolean) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image(); if (cross) im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => rej(new Error("load")); im.src = src;
  });
  const setLoop = useCallback(async (s: LoopSceneId, reset: boolean) => {
    try {
      const im = await loadImg(POSTER[s]);
      setPhoto(im);
      if (reset) commit({ ...docRef.current, photo: { kind: "loop", scene: s, zoom: 1, x: 0, y: 0 } });
      setNeedsPhoto(false);
    } catch { toast("That frame could not be loaded.", "error"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const p = docRef.current.photo;
    if (p.kind === "loop" && p.scene) void setLoop(p.scene, false);
  }, [setLoop]);

  const usePhotoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!IMG_TYPES.includes(file.type)) { toast("Choose a JPG, PNG or WebP photo.", "error"); return; }
    if (file.size > 10 * 1024 * 1024) { toast("That photo is over 10 MB. Pick a smaller one.", "error"); return; }
    const url = URL.createObjectURL(file);
    try {
      const im = await loadImg(url);
      const sc = Math.min(1, 2560 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
      setPhoto(c);
      commit({ ...docRef.current, photo: { kind: "upload", zoom: 1, x: 0, y: 0 } });
      setNeedsPhoto(false);
      say("Photo added. Drag it on the canvas to frame it.");
    } catch { toast("That photo could not be read.", "error"); }
    finally { URL.revokeObjectURL(url); }
  };

  // ---- stickers (saved library; fails soft) ----
  const loadLibrary = useCallback(async () => {
    const r = await listSavedStickers().catch(() => ({ items: [] as SavedSticker[], error: "x" }));
    setLibrary(r.items);
    if (r.error) setLibNote("Your saved stickers are not available right now.");
    const m = new Map<string, HTMLImageElement>();
    await Promise.all(r.items.map(async (s) => { try { m.set(s.id, await loadImg(s.url, true)); } catch { /* skip */ } }));
    setStickers((cur) => new Map([...cur, ...m]));
  }, []);
  useEffect(() => { if ((section === "stickers" || docRef.current.items.some((i) => i.t === "sticker")) && library === null) void loadLibrary(); }, [section, library, loadLibrary]);

  // ---- adding things ----
  const add = (it: CoverItem) => {
    const d = docRef.current;
    commit({ ...d, items: [...d.items, it] });
    setSelId(it.id); setTool("select");
  };
  const addText = (text: string) => {
    add({ t: "text", id: newId(), text, font: "caveat", size: 120, color: "#fff6e5", rot: -3, shadow: true, x: COVER_W / 2, y: COVER_H * 0.3 });
    say(`Text box added: ${text}.`);
  };
  const addStamp = (kind: StampKind) => {
    add({ t: "stamp", id: newId(), kind, size: 110, color: ink, rot: 0, fill: false, x: COVER_W / 2 + (Math.random() - 0.5) * 300, y: COVER_H / 2 + (Math.random() - 0.5) * 200 });
    say(`${STAMP_LABEL[kind]} added.`);
  };
  const addSticker = (s: SavedSticker) => {
    add({ t: "sticker", id: newId(), sid: s.id, alt: s.alt, w: s.width, h: s.height, size: 220, rot: 0, x: COVER_W / 2, y: COVER_H / 2 });
    say("Sticker added.");
  };
  const remove = (id: string) => {
    const d = docRef.current;
    commit({ ...d, items: d.items.filter((i) => i.id !== id) });
    setSelId(null); say("Removed.");
  };
  const moveLayer = (id: string, dir: 1 | -1) => {
    const a = [...docRef.current.items]; const i = a.findIndex((x) => x.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    commit({ ...docRef.current, items: a });
    say(dir > 0 ? "Brought forward." : "Sent back.");
  };
  const clearDrawing = () => {
    const d = docRef.current;
    commit({ ...d, items: d.items.map((i) => (i.t === "draw" ? { ...i, strokes: [] } : i)) });
    say("Drawing cleared. You can undo this.");
  };

  // ---- pointer ----
  const toCanvas = (e: React.PointerEvent | PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * COVER_W) / r.width, y: ((e.clientY - r.top) * COVER_H) / r.height };
  };
  const pressure = (e: PointerEvent | React.PointerEvent) => (e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1);
  const mctx = () => canvasRef.current!.getContext("2d")!;
  const setDraw = (fn: (s: Stroke[]) => Stroke[]) =>
    apply({ ...docRef.current, items: docRef.current.items.map((i) => (i.t === "draw" ? { ...i, strokes: fn(i.strokes) } : i)) });

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = toCanvas(e), k = view.current.k;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    stageRef.current?.focus({ preventScroll: true });
    if (tool === "pen") {
      live.current = { c: ink, w: penSize, p: [[p.x, p.y, pressure(e)]] };
      drag.current = { mode: "pen" }; schedulePaint(); return;
    }
    if (tool === "eraser") {
      drag.current = { mode: "erase", pushed: false }; eraseAt(p.x, p.y); return;
    }
    const d = docRef.current;
    if (sel && sel.t !== "draw") {
      const h = handlesOf(sel, boxOf(mctx(), sel, FAM), k);
      if (h) {
        if (Math.hypot(p.x - h.resize.x, p.y - h.resize.y) <= h.r * 1.6) {
          drag.current = { mode: "resize", id: sel.id, cx: sel.x, cy: sel.y, d0: Math.max(1, Math.hypot(p.x - sel.x, p.y - sel.y)), size0: sel.size, moved: false }; return;
        }
        if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= h.r * 1.6) { drag.current = { mode: "rotate", id: sel.id, cx: sel.x, cy: sel.y, moved: false }; return; }
      }
    }
    const hit = hitItem(mctx(), d, FAM, p.x, p.y, k);
    if (hit && hit.t !== "draw") {
      setSelId(hit.id); view.current.sel = hit.id;
      drag.current = { mode: "move", id: hit.id, sx: p.x, sy: p.y, ox: hit.x, oy: hit.y, moved: false };
      say(`Selected ${labelOf(hit)}.`);
    } else {
      setSelId(null); view.current.sel = null;
      drag.current = { mode: "pan", sx: p.x, sy: p.y, ox: d.photo.x, oy: d.photo.y, moved: false };
    }
    schedulePaint();
  };
  const eraseAt = (x: number, y: number) => {
    const dr = docRef.current.items.find((i) => i.t === "draw");
    if (!dr || dr.t !== "draw") return;
    const r = 14 * view.current.k;
    const keep = dr.strokes.filter((s) => !strokeHit(s, x, y, r));
    if (keep.length === dr.strokes.length) return;
    const g = drag.current;
    if (g && g.mode === "erase" && !g.pushed) { pushUndo(docRef.current); g.pushed = true; }
    setDraw(() => keep);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current; if (!g) return;
    const p = toCanvas(e);
    if (g.mode === "pen" && live.current) {
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) as PointerEvent[];
      for (const ev of evs) {
        const q = toCanvas(ev); const last = live.current.p[live.current.p.length - 1];
        if (Math.hypot(q.x - last[0], q.y - last[1]) >= 1.5) live.current.p.push([q.x, q.y, pressure(ev)]);
      }
      schedulePaint(); return;
    }
    if (g.mode === "erase") { eraseAt(p.x, p.y); return; }
    const d = docRef.current;
    if (g.mode === "pan") {
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < 3) return;
      if (!g.moved) { pushUndo(d); g.moved = true; }
      apply({ ...d, photo: { ...d.photo, x: g.ox + (p.x - g.sx), y: g.oy + (p.y - g.sy) } }); return;
    }
    if (g.mode === "pen") return;
    const target = d.items.find((i) => i.id === g.id);
    if (!target || target.t === "draw") return;
    if (g.mode === "move") {
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < 3 * view.current.k) return;
      if (!g.moved) { pushUndo(d); g.moved = true; }
      apply({ ...d, items: d.items.map((i) => (i.id === g.id ? ({ ...i, x: clamp(g.ox + p.x - g.sx, 0, COVER_W), y: clamp(g.oy + p.y - g.sy, 0, COVER_H) } as CoverItem) : i)) });
    } else if (g.mode === "resize") {
      if (!g.moved) { pushUndo(d); g.moved = true; }
      const [lo, hi] = SIZE_RANGE[target.t];
      const size = clamp((g.size0 * Math.hypot(p.x - g.cx, p.y - g.cy)) / g.d0, lo, hi);
      apply({ ...d, items: d.items.map((i) => (i.id === g.id ? ({ ...i, size: Math.round(size) } as CoverItem) : i)) });
    } else if (g.mode === "rotate") {
      if (!g.moved) { pushUndo(d); g.moved = true; }
      let a = (Math.atan2(p.y - g.cy, p.x - g.cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      if (target.t === "text") a = clamp(a, -45, 45);
      apply({ ...d, items: d.items.map((i) => (i.id === g.id ? ({ ...i, rot: Math.round(a) } as CoverItem) : i)) });
    }
  };
  const onUp = () => {
    const g = drag.current; drag.current = null;
    if (g?.mode === "pen" && live.current) {
      const s = live.current; live.current = null;
      const pts: Pt[] = s.p.map(([x, y, pr]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100) / 100]);
      const d = docRef.current;
      pushUndo(d);
      apply({ ...d, items: d.items.map((i) => (i.t === "draw" ? { ...i, strokes: [...i.strokes, { ...s, p: pts.slice(0, 3000) }] } : i)) });
    }
  };

  // ---- keyboard on the canvas ----
  const onStageKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
    const step = e.shiftKey ? 24 : 6;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      if (sel && sel.t !== "draw") patchItem(sel.id, { x: clamp(sel.x + dx, 0, COVER_W), y: clamp(sel.y + dy, 0, COVER_H) }, `mv:${sel.id}`);
      else if (photo) { const ph = docRef.current.photo; patchPhoto({ x: ph.x - dx, y: ph.y - dy }, "pan"); }
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
      e.preventDefault();
      const up = e.key === "+" || e.key === "=";
      if (sel && sel.t !== "draw") { const [lo, hi] = SIZE_RANGE[sel.t]; patchItem(sel.id, { size: Math.round(clamp(sel.size * (up ? 1.06 : 0.94), lo, hi)) }, `sz:${sel.id}`); }
      else patchPhoto({ zoom: clamp(docRef.current.photo.zoom + (up ? 0.1 : -0.1), 1, 3) }, "zoom");
      return;
    }
    if ((e.key === "[" || e.key === "]") && sel && sel.t !== "draw") {
      e.preventDefault();
      let r = sel.rot + (e.key === "]" ? 3 : -3);
      r = sel.t === "text" ? clamp(r, -45, 45) : r > 180 ? r - 360 : r < -180 ? r + 360 : r;
      patchItem(sel.id, { rot: r }, `rt:${sel.id}`); return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel && sel.t !== "draw") { e.preventDefault(); remove(sel.id); return; }
    if (e.key === "Escape" && sel) { e.stopPropagation(); setSelId(null); say("Selection cleared."); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const list = docRef.current.items.filter((i) => i.t !== "draw");
      if (!list.length) return;
      const n = list[(list.findIndex((i) => i.id === selId) + 1) % list.length];
      setSelId(n.id); say(`Selected ${labelOf(n)}.`);
    }
  };

  // ---- export ----
  const finish = async () => {
    setBusy(true);
    try {
      await document.fonts.ready;
      const c = document.createElement("canvas"); c.width = COVER_W; c.height = COVER_H;
      renderCover(c.getContext("2d")!, docRef.current, { photo, stickers, fam: FAM, fallback: "#2f4858" });
      let blob: Blob | null = null;
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));
        if (blob && blob.size <= COVER_MAX_BYTES) break;
      }
      if (!blob || blob.size > COVER_MAX_BYTES) { toast("The cover is too large to save. Try a simpler photo.", "error"); setBusy(false); return; }
      if (JSON.stringify(docRef.current).length > COVER_DOC_MAX_CHARS) { toast("There is too much drawing to keep editable. Clear some strokes and try again.", "error"); setBusy(false); return; }
      onDone({ blob, doc: docRef.current });
    } catch {
      toast("The cover could not be exported. If you used a saved sticker, remove it and try again.", "error");
      setBusy(false);
    }
  };

  const requestClose = () => { if (undo.current.length === 0 || window.confirm("Close the cover editor? Your changes will be lost.")) onClose(); };

  // ---- small pieces ----
  const labelOf = (i: CoverItem) => i.t === "text" ? `text "${i.text.slice(0, 24)}"` : i.t === "stamp" ? STAMP_LABEL[i.kind].toLowerCase() : i.t === "sticker" ? `sticker ${i.alt || ""}`.trim() : `drawing, ${i.strokes.length} strokes`;
  const canUndo = undo.current.length > 0, canRedo = redo.current.length > 0;
  const strokes = items.find((i) => i.t === "draw");
  const nStrokes = strokes && strokes.t === "draw" ? strokes.strokes.length : 0;
  const presets = ["study with me <3", "*study with me*", "late night study with me", `${hours} hours, ${focus}/${brk}`];
  const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "photo", label: "Photo", icon: <ImageIcon size={16} aria-hidden="true" /> }, { id: "text", label: "Text", icon: <Type size={16} aria-hidden="true" /> },
    { id: "draw", label: "Draw", icon: <Brush size={16} aria-hidden="true" /> }, { id: "stamps", label: "Doodles", icon: <MousePointer2 size={16} aria-hidden="true" /> },
    { id: "stickers", label: "Stickers", icon: <StickerIcon size={16} aria-hidden="true" /> }, { id: "layers", label: "Layers", icon: <LayersIcon size={16} aria-hidden="true" /> },
  ];
  const [lo, hi] = sel && sel.t !== "draw" ? SIZE_RANGE[sel.t] : [0, 0];

  return (
    <Dialog title="Make a cover" onClose={requestClose} width={1120}>
      <div className="ce-root">
        <div className="ce-main">
          <div className="ce-top">
            <button type="button" className="btn btn-sm" onClick={doUndo} disabled={!canUndo}><Undo2 size={14} aria-hidden="true" /> Undo</button>
            <button type="button" className="btn btn-sm" onClick={doRedo} disabled={!canRedo}><Redo2 size={14} aria-hidden="true" /> Redo</button>
            <span className="ce-spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={requestClose}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={finish} disabled={busy}>{busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null} Use this cover</button>
          </div>
          <div ref={stageRef} className={`ce-stage tool-${tool}`} tabIndex={0} role="application" aria-label="Cover canvas, 16 by 9"
            aria-describedby={`${uid}-help`} onKeyDown={onStageKey}>
            <canvas ref={canvasRef} width={COVER_W} height={COVER_H} className="ce-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onWheel={(e) => { if (!photo || !e.ctrlKey) return; patchPhoto({ zoom: clamp(docRef.current.photo.zoom - e.deltaY * 0.002, 1, 3) }, "zoom"); }} />
            {needsPhoto && <div className="ce-needphoto">Choose your photo again to keep editing. Your text and doodles are kept.</div>}
          </div>
          <p id={`${uid}-help`} className="field-hint ce-help">
            Drag the photo to frame it. Keys when the canvas is focused: Enter picks the next item; arrows move it (Shift for bigger steps, or pan the photo when nothing is picked);
            plus and minus resize or zoom; [ and ] rotate; Delete removes; Ctrl+Z undoes.
          </p>
          <p className="sr-only" role="status" aria-live="polite">{status}</p>
        </div>

        <div className="ce-side">
          <div className="ce-panel">
            {section === "photo" && (
              <div className="ce-group">
                <h3 className="ce-h">Photo</h3>
                <label className="ce-drop" {...dropProps((f) => void usePhotoFile(f))}>
                  <Upload size={16} aria-hidden="true" /> Choose or drop a photo
                  <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void usePhotoFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <p className="field-hint">JPG, PNG or WebP, up to 10 MB. The photo stays on your device; only the finished cover is uploaded. Use only pictures you made or have the right to share.</p>
                <div className="ce-h2" id={`${uid}-frames`}>Or use a frame from a loop</div>
                <div className="ce-frames" role="group" aria-labelledby={`${uid}-frames`}>
                  {SCENE_IDS.map((s) => (
                    <button key={s} type="button" className={`ce-frame${doc.photo.kind === "loop" && doc.photo.scene === s ? " on" : ""}`} aria-pressed={doc.photo.kind === "loop" && doc.photo.scene === s} onClick={() => void setLoop(s, true)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={POSTER[s]} alt="" /><span>{SCENE_LABEL[s]}</span>
                    </button>
                  ))}
                </div>
                <Range uid={uid} id="zoom" label="Zoom" value={doc.photo.zoom * 100} min={100} max={300} step={5} unit="%" onChange={(v) => patchPhoto({ zoom: v / 100 }, "zoom")} />
                <button type="button" className="btn btn-sm" onClick={() => patchPhoto({ zoom: 1, x: 0, y: 0 })}>Reset framing</button>
              </div>
            )}

            {section === "text" && (
              <div className="ce-group">
                <h3 className="ce-h">Text</h3>
                <div className="ce-presets">
                  {presets.map((p) => <button key={p} type="button" className="btn btn-sm" onClick={() => addText(p)}>{p}</button>)}
                </div>
                <div className="ce-row"><label htmlFor={`${uid}-hours`}>Hours for the last preset</label>
                  <input id={`${uid}-hours`} className="input" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(clamp(Number(e.target.value) || 1, 1, 24))} /></div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => addText("your words")}>Add a text box</button>
              </div>
            )}

            {section === "draw" && (
              <div className="ce-group">
                <h3 className="ce-h">Draw</h3>
                <div className="ce-tools" role="group" aria-label="Tool">
                  <button type="button" className="btn btn-sm" aria-pressed={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={14} aria-hidden="true" /> Select</button>
                  <button type="button" className="btn btn-sm" aria-pressed={tool === "pen"} onClick={() => { setTool("pen"); setSelId(null); }}><Brush size={14} aria-hidden="true" /> Pen</button>
                  <button type="button" className="btn btn-sm" aria-pressed={tool === "eraser"} onClick={() => { setTool("eraser"); setSelId(null); }}><Eraser size={14} aria-hidden="true" /> Eraser</button>
                </div>
                <Range uid={uid} id="pen" label="Pen size" value={penSize} min={2} max={40} onChange={setPenSize} unit=" px" />
                <Colors value={ink} onChange={setInk} label="Pen colour" />
                <p className="field-hint">Draw with a finger, mouse or Apple Pencil. The eraser removes whole pen strokes it touches and leaves text and doodles alone. Drawing is optional. Doodles in the Doodles tab work with the keyboard.</p>
                <button type="button" className="btn btn-sm" onClick={clearDrawing} disabled={nStrokes === 0}><Trash2 size={14} aria-hidden="true" /> Clear drawing</button>
              </div>
            )}

            {section === "stamps" && (
              <div className="ce-group">
                <h3 className="ce-h">Doodles</h3>
                <Colors value={ink} onChange={setInk} label="Doodle colour" />
                <div className="ce-stamps">
                  {STAMP_KINDS.map((k) => (
                    <button key={k} type="button" className="ce-stamp" onClick={() => addStamp(k)} aria-label={`Add ${STAMP_LABEL[k].toLowerCase()}`}>
                      <svg viewBox="0 0 100 100" aria-hidden="true"><path d={STAMP_PATH[k]} fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  ))}
                </div>
                <p className="field-hint">A doodle lands on the canvas. Recolour, resize and rotate it in the panel below.</p>
              </div>
            )}

            {section === "stickers" && (
              <div className="ce-group">
                <h3 className="ce-h">Your saved stickers</h3>
                {library === null ? <p className="field-hint"><Loader2 size={13} className="spin" aria-hidden="true" /> Loading.</p>
                  : library.length === 0 ? <p className="field-hint">{libNote || "No saved stickers yet. Stickers you make in a space are saved there and show up here."}</p>
                  : (
                    <ul className="ce-stk">
                      {library.map((s, i) => (
                        <li key={s.id}><button type="button" onClick={() => addSticker(s)} aria-label={`Add ${s.alt || `saved sticker ${i + 1}`}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.url} alt="" loading="lazy" /></button></li>
                      ))}
                    </ul>
                  )}
                <p className="field-hint">Stickers are added as part of the flattened cover. Only the finished picture is uploaded.</p>
              </div>
            )}

            {section === "layers" && (
              <div className="ce-group">
                <h3 className="ce-h">Layers</h3>
                <p className="field-hint">Top of the list is in front.</p>
                <ul className="ce-layers">
                  {[...items].reverse().map((it) => (
                    <li key={it.id} className={selId === it.id ? "on" : ""}>
                      <button type="button" className="ce-lname" disabled={it.t === "draw"} aria-pressed={selId === it.id} onClick={() => { setSelId(it.id); setTool("select"); }}>
                        {it.t === "draw" ? `Drawing (${it.strokes.length} strokes)` : labelOf(it)}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveLayer(it.id, 1)} disabled={items[items.length - 1].id === it.id} aria-label={`Bring ${labelOf(it)} forward`}>Forward</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveLayer(it.id, -1)} disabled={items[0].id === it.id} aria-label={`Send ${labelOf(it)} back`}>Back</button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-sm" onClick={clearDrawing} disabled={nStrokes === 0}><Trash2 size={14} aria-hidden="true" /> Clear drawing</button>
              </div>
            )}

            {sel && sel.t !== "draw" && (
              <div className="ce-group ce-selected" role="group" aria-label={`Selected: ${labelOf(sel)}`}>
                <h3 className="ce-h">Selected</h3>
                {sel.t === "text" && (<>
                  <div className="ce-row"><label htmlFor={`${uid}-txt`}>Text</label>
                    <textarea id={`${uid}-txt`} ref={textRef} className="input" rows={2} maxLength={200} value={sel.text} onChange={(e) => patchItem(sel.id, { text: e.target.value }, `tx:${sel.id}`)} /></div>
                  <div className="ce-fonts" role="group" aria-label="Font">
                    {FONT_IDS.map((f) => (
                      <button key={f} type="button" className="ce-font" style={{ fontFamily: FAM[f] }} aria-pressed={sel.font === f} onClick={() => patchItem(sel.id, { font: f })}>{FONT_LABEL[f]}</button>
                    ))}
                  </div>
                  <label className="ce-check"><input type="checkbox" checked={sel.shadow} onChange={(e) => patchItem(sel.id, { shadow: e.target.checked })} /> Soft shadow for legibility</label>
                </>)}
                {sel.t !== "sticker" && <Colors value={sel.color} onChange={(c) => { patchItem(sel.id, { color: c }, `c:${sel.id}`); setInk(c); }} label="Colour" />}
                {sel.t === "stamp" && STAMP_FILLABLE.includes(sel.kind) && (
                  <label className="ce-check"><input type="checkbox" checked={sel.fill} onChange={(e) => patchItem(sel.id, { fill: e.target.checked })} /> Filled in</label>
                )}
                <Range uid={uid} id="size" label="Size" value={sel.size} min={lo} max={hi} onChange={(v) => patchItem(sel.id, { size: v }, `sz:${sel.id}`)} />
                <Range uid={uid} id="rot" label="Rotation" value={sel.rot} min={sel.t === "text" ? -45 : -180} max={sel.t === "text" ? 45 : 180} unit="°" onChange={(v) => patchItem(sel.id, { rot: v }, `rt:${sel.id}`)} />
                <Range uid={uid} id="px" label="Left to right" value={sel.x} min={0} max={COVER_W} onChange={(v) => patchItem(sel.id, { x: v }, `mv:${sel.id}`)} />
                <Range uid={uid} id="py" label="Up and down" value={sel.y} min={0} max={COVER_H} onChange={(v) => patchItem(sel.id, { y: v }, `mv:${sel.id}`)} />
                <div className="ce-btns">
                  <button type="button" className="btn btn-sm" onClick={() => moveLayer(sel.id, 1)}>Bring forward</button>
                  <button type="button" className="btn btn-sm" onClick={() => moveLayer(sel.id, -1)}>Send back</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(sel.id)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                </div>
              </div>
            )}
          </div>

          <div className="ce-bar" role="group" aria-label="Editor sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className="ce-tab" aria-pressed={section === s.id} onClick={() => { setSection(s.id); if (s.id !== "draw") setTool("select"); }}>
                {s.icon}<span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

