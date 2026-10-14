// Shared cover definitions for notebooks and notes (migration 26).
// Plain module (no "use client") so server and client code can both import it.
export type CoverKind = "color" | "pattern" | "image" | "emoji";
export type Cover = { kind: CoverKind; value: string };

export const COVER_BUCKET = "notebook-covers";
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Calm palette. The notebook name is printed below the cover, never on it, so any colour is safe.
export const COVER_COLORS = [
  { hex: "#E9806E", label: "Coral" }, { hex: "#C8694F", label: "Terracotta" },
  { hex: "#D9A441", label: "Amber" }, { hex: "#7FA68A", label: "Sage" },
  { hex: "#4F9A94", label: "Teal" }, { hex: "#6C9BD1", label: "Sky" },
  { hex: "#6F7FC4", label: "Indigo" }, { hex: "#9B6FB5", label: "Plum" },
  { hex: "#D77A9A", label: "Rose" }, { hex: "#6B7785", label: "Slate" },
] as const;
export const DEFAULT_COVER_COLOR = COVER_COLORS[0].hex;

export const COVER_PATTERNS = [
  { key: "dots", label: "Dots" }, { key: "grid", label: "Grid" },
  { key: "lines", label: "Lines" }, { key: "waves", label: "Waves" },
] as const;
export type PatternKey = (typeof COVER_PATTERNS)[number]["key"];

export const COVER_EMOJIS = ["📘", "📚", "🧪", "🧮", "🌍", "🎨", "🎵", "💻", "🌱", "⚖️", "🔭", "✏️", "🧠", "📝", "🏛️", "🗣️", "❤️", "⭐"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (s: string) => HEX.test(s);

export function patternValue(key: string, hex: string) { return `${key}|${hex}`; }
export function emojiValue(hex: string, emoji: string) { return `${hex}|${emoji}`; }

// Which part of an image cover shows under the crop, as a focal point (0 to 100, left/top origin).
// Encoded onto the end of the image's value as "path#x,y" so no database column or migration is needed.
export type CoverPos = { x: number; y: number };
export const DEFAULT_COVER_POS: CoverPos = { x: 50, y: 50 };
function splitImageValue(value: string): { path: string; pos: CoverPos } {
  const i = value.lastIndexOf("#");
  if (i < 0) return { path: value, pos: DEFAULT_COVER_POS };
  const [xs, ys] = value.slice(i + 1).split(",");
  const x = Number(xs), y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return { path: value.slice(0, i), pos: DEFAULT_COVER_POS };
  return { path: value.slice(0, i), pos: { x, y } };
}
export function imageValue(path: string, pos: CoverPos = DEFAULT_COVER_POS) {
  return `${path}#${Math.round(pos.x)},${Math.round(pos.y)}`;
}

export function parseCover(c: { kind: string | null; value: string | null } | null | undefined): { kind: CoverKind; color: string; pattern?: PatternKey; emoji?: string; path?: string; pos?: CoverPos } | null {
  if (!c || !c.kind || !c.value) return null;
  if (c.kind === "color") return isHex(c.value) ? { kind: "color", color: c.value } : null;
  if (c.kind === "pattern") {
    const [k, hex] = c.value.split("|");
    if (!COVER_PATTERNS.some((p) => p.key === k) || !isHex(hex ?? "")) return null;
    return { kind: "pattern", color: hex, pattern: k as PatternKey };
  }
  if (c.kind === "emoji") {
    const i = c.value.indexOf("|");
    const hex = c.value.slice(0, i), emoji = c.value.slice(i + 1);
    if (i < 0 || !isHex(hex) || !emoji) return null;
    return { kind: "emoji", color: hex, emoji };
  }
  if (c.kind === "image") { const { path, pos } = splitImageValue(c.value); return { kind: "image", color: "#6B7785", path, pos }; }
  return null;
}

// Server-side check of a cover coming from the browser. Returns the cleaned cover or an error.
export function validateCover(c: Cover, userId: string, spaceId: string): { cover: Cover } | { error: string } {
  const kind = c.kind, value = String(c.value ?? "");
  if (kind === "image") {
    const { path, pos } = splitImageValue(value);
    if (!path.startsWith(`${userId}/${spaceId}/`) || path.includes("..") || path.length > 250) return { error: "That image can't be used as a cover." };
    return { cover: { kind, value: imageValue(path, pos) } };
  }
  if (kind === "color" || kind === "pattern" || kind === "emoji") {
    if (!parseCover({ kind, value })) return { error: "That cover isn't valid." };
    if (kind === "emoji" && value.length > 40) return { error: "That cover isn't valid." };
    return { cover: { kind, value } };
  }
  return { error: "That cover isn't valid." };
}
