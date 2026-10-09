// Draws a cover document on a 1280x720 canvas. The same code paints the editor preview and the exported JPEG,
// so what you see is what you save. Client only.
import { COVER_H, COVER_W, STAMP_PATH, type CoverDoc, type CoverItem, type Photo, type Stroke, type StampItem, type StickerItem, type TextItem, type CoverFontId } from "@/lib/coverDoc";

export type Drawable = (CanvasImageSource & { width: number; height: number });
export type RenderDeps = {
  photo: Drawable | null;
  stickers: Map<string, HTMLImageElement>;
  fam: Record<CoverFontId, string>;
  live?: Stroke | null;
  overlay?: { selectedId: string | null; k: number } | null; // k: canvas units per screen pixel
  fallback: string;
};

export function photoRect(p: Photo, iw: number, ih: number) {
  const base = Math.max(COVER_W / iw, COVER_H / ih);
  const s = base * Math.min(5, Math.max(1, p.zoom));
  const dw = iw * s, dh = ih * s;
  const mx = (dw - COVER_W) / 2, my = (dh - COVER_H) / 2;
  const x = Math.min(mx, Math.max(-mx, p.x)), y = Math.min(my, Math.max(-my, p.y));
  return { dx: COVER_W / 2 - dw / 2 + x, dy: COVER_H / 2 - dh / 2 + y, dw, dh, x, y, mx, my };
}

const LH = 1.12;
export function textLines(t: TextItem) { return t.text.split("\n"); }

export function boxOf(ctx: CanvasRenderingContext2D, it: CoverItem, fam: Record<CoverFontId, string>): { w: number; h: number } {
  if (it.t === "text") {
    ctx.save();
    ctx.font = `${it.size}px ${fam[it.font]}`;
    const lines = textLines(it);
    const w = Math.max(it.size * 0.5, ...lines.map((l) => ctx.measureText(l || " ").width));
    ctx.restore();
    return { w, h: lines.length * it.size * LH };
  }
  if (it.t === "stamp") return { w: it.size, h: it.size };
  if (it.t === "sticker") return { w: it.size, h: it.size * (it.h / it.w) };
  return { w: 0, h: 0 };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save();
  ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const pts = s.p;
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], (s.w * (0.35 + 0.65 * pts[0][2])) / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = s.w * (0.35 + 0.65 * ((pts[i][2] + pts[i - 1][2]) / 2));
      ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, it: TextItem, fam: Record<CoverFontId, string>) {
  ctx.save();
  ctx.translate(it.x, it.y); ctx.rotate((it.rot * Math.PI) / 180);
  ctx.font = `${it.size}px ${fam[it.font]}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = it.color;
  if (it.shadow) { ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = it.size * 0.1; ctx.shadowOffsetY = it.size * 0.03; }
  const lines = textLines(it);
  lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * it.size * LH));
  ctx.restore();
}

const pathCache = new Map<string, Path2D>();
function drawStamp(ctx: CanvasRenderingContext2D, it: StampItem) {
  let p = pathCache.get(it.kind);
  if (!p) { p = new Path2D(STAMP_PATH[it.kind]); pathCache.set(it.kind, p); }
  ctx.save();
  ctx.translate(it.x, it.y); ctx.rotate((it.rot * Math.PI) / 180);
  const k = it.size / 100; ctx.scale(k, k); ctx.translate(-50, -50);
  ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = 6.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (it.fill) ctx.fill(p);
  ctx.stroke(p);
  ctx.restore();
}

function drawSticker(ctx: CanvasRenderingContext2D, it: StickerItem, img: HTMLImageElement | undefined) {
  const h = it.size * (it.h / it.w);
  ctx.save();
  ctx.translate(it.x, it.y); ctx.rotate((it.rot * Math.PI) / 180);
  if (img) ctx.drawImage(img, -it.size / 2, -h / 2, it.size, h);
  else { ctx.strokeStyle = "#888"; ctx.setLineDash([8, 8]); ctx.strokeRect(-it.size / 2, -h / 2, it.size, h); }
  ctx.restore();
}

export function handlesOf(it: CoverItem, box: { w: number; h: number }, k: number) {
  if (it.t === "draw") return null;
  const pad = 10 * k, a = (it.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const place = (lx: number, ly: number) => ({ x: it.x + lx * c - ly * s, y: it.y + lx * s + ly * c });
  return { resize: place(box.w / 2 + pad, box.h / 2 + pad), rotate: place(0, -box.h / 2 - pad - 26 * k), r: 15 * k };
}

function drawSelection(ctx: CanvasRenderingContext2D, it: CoverItem, box: { w: number; h: number }, k: number) {
  if (it.t === "draw") return;
  const h = handlesOf(it, box, k);
  if (!h) return;
  const pad = 10 * k;
  ctx.save();
  ctx.translate(it.x, it.y); ctx.rotate((it.rot * Math.PI) / 180);
  ctx.lineWidth = 2 * k; ctx.strokeStyle = "#ffffff"; ctx.setLineDash([]);
  ctx.strokeRect(-box.w / 2 - pad, -box.h / 2 - pad, box.w + pad * 2, box.h + pad * 2);
  ctx.strokeStyle = "#e8835a"; ctx.setLineDash([6 * k, 5 * k]);
  ctx.strokeRect(-box.w / 2 - pad, -box.h / 2 - pad, box.w + pad * 2, box.h + pad * 2);
  ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(0, -box.h / 2 - pad); ctx.lineTo(0, -box.h / 2 - pad - 26 * k); ctx.stroke();
  ctx.restore();
  for (const pt of [h.resize, h.rotate]) {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, h.r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.lineWidth = 3 * k; ctx.strokeStyle = "#d4724b"; ctx.stroke();
  }
}

export function renderCover(ctx: CanvasRenderingContext2D, doc: CoverDoc, d: RenderDeps) {
  ctx.save();
  ctx.fillStyle = d.fallback; ctx.fillRect(0, 0, COVER_W, COVER_H);
  if (d.photo) {
    const r = photoRect(doc.photo, d.photo.width, d.photo.height);
    ctx.drawImage(d.photo, r.dx, r.dy, r.dw, r.dh);
  }
  for (const it of doc.items) {
    if (it.t === "draw") {
      for (const s of it.strokes) drawStroke(ctx, s);
      if (d.live) drawStroke(ctx, d.live);
    } else if (it.t === "text") drawText(ctx, it, d.fam);
    else if (it.t === "stamp") drawStamp(ctx, it);
    else drawSticker(ctx, it, d.stickers.get(it.sid));
  }
  if (d.overlay?.selectedId) {
    const sel = doc.items.find((i) => i.id === d.overlay!.selectedId);
    if (sel) drawSelection(ctx, sel, boxOf(ctx, sel, d.fam), d.overlay.k);
  }
  ctx.restore();
}

export function hitItem(ctx: CanvasRenderingContext2D, doc: CoverDoc, fam: Record<CoverFontId, string>, px: number, py: number, k: number): CoverItem | null {
  for (let i = doc.items.length - 1; i >= 0; i--) {
    const it = doc.items[i];
    if (it.t === "draw") continue;
    const b = boxOf(ctx, it, fam), a = (-it.rot * Math.PI) / 180;
    const dx = px - it.x, dy = py - it.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const pad = 8 * k;
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) return it;
  }
  return null;
}

// Distance from a point to a stroke's polyline (for the stroke eraser).
export function strokeHit(s: Stroke, px: number, py: number, r: number): boolean {
  const lim = r + s.w / 2;
  const p = s.p;
  if (p.length === 1) return Math.hypot(px - p[0][0], py - p[0][1]) <= lim;
  for (let i = 1; i < p.length; i++) {
    const [x1, y1] = p[i - 1], [x2, y2] = p[i];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    if (Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= lim) return true;
  }
  return false;
}
