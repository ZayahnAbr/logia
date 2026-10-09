// Cover editor data (migration 42). A plain module: safe to import from server and client code.
// The document holds layers only (text, stamps, stroke paths, sticker references). Photo bytes are never stored.
import type { LoopSceneId } from "@/lib/loopScenes";

export const COVER_W = 1280;
export const COVER_H = 720;
export const COVER_DOC_MAX_CHARS = 200_000;
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_PATH_RE = /\.jpg$/i;

export const FONT_IDS = ["caveat", "gochi", "shadows", "patrick", "marker"] as const;
export type CoverFontId = (typeof FONT_IDS)[number];
export const FONT_LABEL: Record<CoverFontId, string> = {
  caveat: "Caveat", gochi: "Gochi Hand", shadows: "Shadows Into Light", patrick: "Patrick Hand", marker: "Permanent Marker",
};

export const STAMP_KINDS = ["asterisk", "heart", "star", "sparkle", "swoosh", "arrow", "lt3"] as const;
export type StampKind = (typeof STAMP_KINDS)[number];
export const STAMP_LABEL: Record<StampKind, string> = {
  asterisk: "Asterisk", heart: "Heart", star: "Star", sparkle: "Sparkle", swoosh: "Underline swoosh", arrow: "Arrow", lt3: "Less-than three",
};
// Hand-drawn style accents on a 100 by 100 grid. Drawn as rounded strokes (optionally filled).
export const STAMP_PATH: Record<StampKind, string> = {
  asterisk: "M50 10 C51 34 49 62 50 90 M15 31 C38 43 63 58 85 71 M86 29 C62 42 37 58 14 69",
  heart: "M50 85 C21 63 9 43 21 27 C31 14 47 19 50 34 C54 18 71 12 81 26 C92 42 79 63 50 85 Z",
  star: "M50 9 L61 38 L92 40 L68 60 L77 90 L50 73 L23 90 L32 60 L8 40 L39 38 Z",
  sparkle: "M50 7 C53 33 67 47 93 50 C67 54 53 67 50 93 C47 67 33 54 7 50 C33 46 47 33 50 7 Z",
  swoosh: "M7 56 C27 42 44 69 62 54 C75 44 85 53 93 45 M20 74 C41 64 62 78 85 67",
  arrow: "M9 62 C33 47 59 44 87 48 M68 27 C78 36 86 43 91 49 C85 57 76 65 65 73",
  lt3: "M38 26 L13 50 L38 74 M55 38 C56 28 74 28 75 39 C76 49 61 50 58 50 C76 50 83 60 76 69 C69 78 53 74 52 64",
};
export const STAMP_FILLABLE: StampKind[] = ["heart", "star", "sparkle"];

export type Photo = { kind: "none" | "upload" | "loop"; scene?: LoopSceneId; zoom: number; x: number; y: number };
export type Pt = [number, number, number]; // x, y, pressure 0..1
export type Stroke = { c: string; w: number; p: Pt[] };
type Base = { id: string; x: number; y: number; rot: number };
export type TextItem = Base & { t: "text"; text: string; font: CoverFontId; size: number; color: string; shadow: boolean };
export type StampItem = Base & { t: "stamp"; kind: StampKind; size: number; color: string; fill: boolean };
export type StickerItem = Base & { t: "sticker"; sid: string; alt: string; w: number; h: number; size: number };
export type DrawItem = { t: "draw"; id: "draw"; strokes: Stroke[] };
export type CoverItem = TextItem | StampItem | StickerItem | DrawItem;
export type CoverDoc = { v: 1; photo: Photo; items: CoverItem[] };

export const PALETTE: { hex: string; name: string }[] = [
  { hex: "#fff6e5", name: "Cream" }, { hex: "#f7c6cf", name: "Blush pink" }, { hex: "#ff7a59", name: "Coral" },
  { hex: "#f2b632", name: "Mustard" }, { hex: "#a9c4a0", name: "Sage" }, { hex: "#b3202e", name: "Deep red" },
  { hex: "#ffffff", name: "White" }, { hex: "#1b1613", name: "Near black" },
];

export function emptyDoc(scene?: LoopSceneId): CoverDoc {
  return { v: 1, photo: scene ? { kind: "loop", scene, zoom: 1, x: 0, y: 0 } : { kind: "none", zoom: 1, x: 0, y: 0 }, items: [{ t: "draw", id: "draw", strokes: [] }] };
}

const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Shape check used by the server action and when reopening. Returns a cleaned doc or null.
export function parseCoverDoc(raw: unknown): CoverDoc | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    if (JSON.stringify(raw).length > COVER_DOC_MAX_CHARS) return null;
    const d = raw as CoverDoc;
    if (d.v !== 1 || !d.photo || !Array.isArray(d.items) || d.items.length > 80) return null;
    const ph = d.photo;
    if (!["none", "upload", "loop"].includes(ph.kind) || !num(ph.zoom, 1, 5) || !num(ph.x, -5000, 5000) || !num(ph.y, -5000, 5000)) return null;
    let points = 0;
    const items: CoverItem[] = [];
    for (const it of d.items) {
      if (!it || typeof it !== "object" || typeof it.id !== "string" || it.id.length > 60) return null;
      if (it.t === "draw") {
        if (!Array.isArray(it.strokes) || it.strokes.length > 600) return null;
        for (const s of it.strokes) {
          if (!HEX.test(s.c) || !num(s.w, 1, 80) || !Array.isArray(s.p) || s.p.length > 3000) return null;
          points += s.p.length;
          if (points > 25000) return null;
          for (const q of s.p) if (!Array.isArray(q) || q.length !== 3 || !q.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
        }
        items.push({ t: "draw", id: "draw", strokes: it.strokes });
        continue;
      }
      if (!num(it.x, -2000, 3000) || !num(it.y, -2000, 3000) || !num(it.rot, -360, 360)) return null;
      if (it.t === "text") {
        if (typeof it.text !== "string" || it.text.length > 200 || !FONT_IDS.includes(it.font) || !num(it.size, 10, 400) || !HEX.test(it.color)) return null;
      } else if (it.t === "stamp") {
        if (!STAMP_KINDS.includes(it.kind) || !num(it.size, 10, 800) || !HEX.test(it.color)) return null;
      } else if (it.t === "sticker") {
        if (typeof it.sid !== "string" || it.sid.length > 60 || typeof it.alt !== "string" || !num(it.w, 1, 5000) || !num(it.h, 1, 5000) || !num(it.size, 10, 1200)) return null;
      } else return null;
      items.push(it);
    }
    if (!items.some((i) => i.t === "draw")) items.unshift({ t: "draw", id: "draw", strokes: [] });
    return { v: 1, photo: { kind: ph.kind, scene: ph.scene, zoom: ph.zoom, x: ph.x, y: ph.y }, items };
  } catch { return null; }
}
