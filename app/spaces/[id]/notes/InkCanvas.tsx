"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine, Highlighter, Eraser, Undo2, Redo2, Plus, Loader2, ScanText } from "lucide-react";
import { readHandwriting } from "@/app/flashcard-actions";
import { toast } from "@/components/Toaster";

// Handwritten note pages for Apple Pencil / stylus / mouse.
// Strokes are vectors in a fixed 1000-unit-wide page space, so they stay sharp at any size.
// Palm rejection: once a pen is seen, touch input scrolls instead of drawing.

export type Stroke = { t: "pen" | "hl"; c: string; w: number; p: number[] }; // p = [x, y, pressure, ...]
export type Ink = { v: 1; paper: "lined" | "grid" | "blank"; pages: number; strokes: Stroke[]; text?: string };

export const INK_PREFIX = "<!--ink:";
export const isInk = (body: string) => body.startsWith(INK_PREFIX);
export const parseInk = (body: string): Ink => {
  try { return { v: 1, paper: "lined", pages: 1, strokes: [], ...JSON.parse(body.slice(INK_PREFIX.length, body.lastIndexOf("-->"))) }; }
  catch { return { v: 1, paper: "lined", pages: 1, strokes: [] }; }
};
export const serializeInk = (ink: Ink) => `${INK_PREFIX}${JSON.stringify(ink)}-->`;
export const blankInk = () => serializeInk({ v: 1, paper: "lined", pages: 1, strokes: [] });

const W = 1000, PAGE_H = 1414; // A4 proportions
const COLORS = ["#1f1d1a", "#6b6f76", "#2f5bd3", "#3aa0e8", "#7b4fd6", "#d23c8a", "#d23c3c", "#ef7a2a", "#e0b100", "#1f8a4c", "#14a39a", "#8b5a2b"];
const HL = "#f5d547";
const SIZES = [2, 3.5, 6];

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const p = s.p;
  if (p.length < 3) return;
  ctx.strokeStyle = s.c;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = s.t === "hl" ? 0.35 : 1;
  ctx.globalCompositeOperation = s.t === "hl" ? "multiply" : "source-over";
  if (p.length === 3) {
    ctx.beginPath(); ctx.arc(p[0], p[1], s.w * (0.5 + p[2]) / 2, 0, Math.PI * 2); ctx.fillStyle = s.c; ctx.fill();
  }
  // Segment-by-segment so width can follow pencil pressure; midpoints smooth the curve.
  for (let i = 3; i < p.length; i += 3) {
    const x0 = p[i - 3], y0 = p[i - 2], x1 = p[i], y1 = p[i + 1], pr = p[i + 2];
    const mx0 = i >= 6 ? (p[i - 6] + x0) / 2 : x0, my0 = i >= 6 ? (p[i - 5] + y0) / 2 : y0;
    ctx.lineWidth = s.t === "hl" ? s.w : s.w * (0.45 + pr * 1.1);
    ctx.beginPath();
    ctx.moveTo(mx0, my0);
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawPaper(ctx: CanvasRenderingContext2D, paper: Ink["paper"], pages: number) {
  ctx.fillStyle = "#fffefb";
  ctx.fillRect(0, 0, W, PAGE_H * pages);
  ctx.lineWidth = 1;
  if (paper === "lined") {
    ctx.strokeStyle = "rgba(90,120,170,.22)";
    for (let y = 120; y < PAGE_H * pages; y += 44) { if (y % PAGE_H < 80) continue; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = "rgba(210,90,90,.25)"; ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(90, PAGE_H * pages); ctx.stroke();
  } else if (paper === "grid") {
    ctx.strokeStyle = "rgba(90,120,170,.16)";
    for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H * pages); ctx.stroke(); }
    for (let y = 40; y < PAGE_H * pages; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  ctx.strokeStyle = "rgba(64,38,28,.14)";
  for (let i = 1; i < pages; i++) { ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(0, i * PAGE_H); ctx.lineTo(W, i * PAGE_H); ctx.stroke(); }
  ctx.setLineDash([]);
}

const hitStroke = (s: Stroke, x: number, y: number, r: number) => {
  for (let i = 0; i < s.p.length; i += 3) { const dx = s.p[i] - x, dy = s.p[i + 1] - y; if (dx * dx + dy * dy < r * r) return true; }
  return false;
};

export function InkCanvas({ value, onChange }: { value: string; onChange: (body: string) => void }) {
  const [ink, setInk] = useState<Ink>(() => parseInk(value));
  const [tool, setTool] = useState<"pen" | "hl" | "eraser">("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [reading, setReading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  const scrollTouch = useRef<{ id: number; y: number } | null>(null);
  const inkRef = useRef(ink);
  inkRef.current = ink;

  const commit = useCallback((next: Ink) => { setInk(next); onChange(serializeInk(next)); }, [onChange]);

  // Full redraw (paper + strokes). Cheap enough for note-sized pages.
  const redraw = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const cssW = c.clientWidth, scale = cssW / W, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const h = PAGE_H * inkRef.current.pages;
    if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(h * scale * dpr)) {
      c.width = Math.round(cssW * dpr); c.height = Math.round(h * scale * dpr); c.style.height = `${h * scale}px`;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawPaper(ctx, inkRef.current.paper, inkRef.current.pages);
    for (const s of inkRef.current.strokes) drawStroke(ctx, s);
    if (live.current) drawStroke(ctx, live.current);
  }, []);

  useEffect(() => { redraw(); }, [ink, redraw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => redraw());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  const toPage = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const k = W / r.width;
    return { x: +((e.clientX - r.left) * k).toFixed(1), y: +((e.clientY - r.top) * k).toFixed(1), pr: e.pointerType === "pen" ? +(e.pressure || 0.5).toFixed(2) : 0.5 };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "pen") penSeen.current = true;
    if (e.pointerType === "touch" && penSeen.current) { scrollTouch.current = { id: e.pointerId, y: e.clientY }; return; } // palm / finger → scroll
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, pr } = toPage(e);
    if (tool === "eraser") { erase(x, y); live.current = { t: "pen", c: "", w: 0, p: [] }; return; }
    live.current = { t: tool, c: tool === "hl" ? HL : color, w: tool === "hl" ? 22 : SIZES[size], p: [x, y, pr] };
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrollTouch.current?.id === e.pointerId) {
      const dy = scrollTouch.current.y - e.clientY; scrollTouch.current.y = e.clientY;
      wrapRef.current?.closest(".ink-scroll")?.scrollBy(0, dy);
      return;
    }
    if (!live.current) return;
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) {
      const { x, y, pr } = toPage(ev as unknown as React.PointerEvent);
      if (tool === "eraser") { erase(x, y); continue; }
      const p = live.current.p, lx = p[p.length - 3], ly = p[p.length - 2];
      if ((x - lx) ** 2 + (y - ly) ** 2 < 2) continue;
      p.push(x, y, pr);
    }
    if (tool !== "eraser") redraw();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrollTouch.current?.id === e.pointerId) { scrollTouch.current = null; return; }
    const s = live.current; live.current = null;
    if (!s || tool === "eraser") return;
    setRedo([]);
    commit({ ...inkRef.current, strokes: [...inkRef.current.strokes, s] });
  };
  const erase = (x: number, y: number) => {
    const keep = inkRef.current.strokes.filter((s) => !hitStroke(s, x, y, 14));
    if (keep.length !== inkRef.current.strokes.length) commit({ ...inkRef.current, strokes: keep });
  };

  const undo = () => {
    const s = ink.strokes; if (!s.length) return;
    setRedo((r) => [...r, s[s.length - 1]]);
    commit({ ...ink, strokes: s.slice(0, -1) });
  };
  const redoOne = () => {
    if (!redo.length) return;
    commit({ ...ink, strokes: [...ink.strokes, redo[redo.length - 1]] });
    setRedo((r) => r.slice(0, -1));
  };

  // Handwriting → text (uses the existing vision model, counts towards the AI allowance).
  const convert = async () => {
    const c = canvasRef.current; if (!c || !ink.strokes.length) return;
    setReading(true);
    const res = await readHandwriting(c.toDataURL("image/jpeg", 0.8));
    setReading(false);
    if ("error" in res && res.error) { toast(res.error, "error"); return; }
    commit({ ...ink, text: (res as { text: string }).text });
    toast("Handwriting converted. You can now make flashcards from this page.");
  };

  return (
    <div ref={wrapRef} className="ink">
      <div className="ink-tools" role="toolbar" aria-label="Pen tools">
        <div className="ink-group" role="radiogroup" aria-label="Tool">
          {([["pen", PenLine, "Pen"], ["hl", Highlighter, "Highlighter"], ["eraser", Eraser, "Eraser"]] as const).map(([id, I, label]) => (
            <button key={id} type="button" role="radio" aria-checked={tool === id} aria-label={label} title={label} className={`ink-btn${tool === id ? " on" : ""}`} onClick={() => setTool(id)}><I size={16} /></button>
          ))}
        </div>
        <div className="ink-group" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c && tool === "pen"} aria-label={`Colour ${c}`} className={`ink-swatch${color === c && tool === "pen" ? " on" : ""}`} style={{ background: c }} onClick={() => { setColor(c); setTool("pen"); }} />)}
          <label className={`ink-swatch ink-custom${!COLORS.includes(color) && tool === "pen" ? " on" : ""}`} title="Custom colour" style={!COLORS.includes(color) ? { background: color } : undefined}>
            <span className="sr-only">Custom colour</span>
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool("pen"); }} />
          </label>
        </div>
        <div className="ink-group" role="radiogroup" aria-label="Pen size">
          {SIZES.map((w, i) => <button key={w} type="button" role="radio" aria-checked={size === i} aria-label={["Fine", "Medium", "Bold"][i]} className={`ink-btn${size === i ? " on" : ""}`} onClick={() => setSize(i)}><span className="ink-size" style={{ width: 4 + i * 4, height: 4 + i * 4 }} /></button>)}
        </div>
        <div className="ink-group">
          <button type="button" className="ink-btn" aria-label="Undo" onClick={undo} disabled={!ink.strokes.length}><Undo2 size={16} /></button>
          <button type="button" className="ink-btn" aria-label="Redo" onClick={redoOne} disabled={!redo.length}><Redo2 size={16} /></button>
        </div>
        <label className="ink-paper">
          <span className="sr-only">Paper</span>
          <select className="input" value={ink.paper} onChange={(e) => commit({ ...ink, paper: e.target.value as Ink["paper"] })}>
            <option value="lined">Lined</option><option value="grid">Grid</option><option value="blank">Blank</option>
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={convert} disabled={reading || !ink.strokes.length}>
          {reading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ScanText size={14} aria-hidden="true" />} Convert to text
        </button>
      </div>

      <canvas ref={canvasRef} className="ink-canvas" aria-label="Handwriting page. Draw with an Apple Pencil, stylus, finger or mouse."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />

      <button type="button" className="btn btn-sm ink-addpage" onClick={() => commit({ ...ink, pages: Math.min(ink.pages + 1, 20) })}>
        <Plus size={14} aria-hidden="true" /> Add page
      </button>

      {ink.text && (
        <section className="ink-text" aria-label="Converted text">
          <div className="eyebrow">Converted text</div>
          <p>{ink.text}</p>
        </section>
      )}
    </div>
  );
}
