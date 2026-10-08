// Shared types and limits for custom space-home widgets (migration 25).
// Plain module (no "use client") so server and client code can both import it.
export const WIDGET_BUCKET = "space-widgets";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const MAX_WIDGETS_PER_SPACE = 60;

export type GifData = { giphyId: string; title: string; url: string; still: string; width: number; height: number; sticker: boolean };
// Free "sticker" placement: x is a fraction of the container width (0..1), y and w are pixels, z is the stacking order.
export type StickerPos = { x?: number; y?: number; w?: number; z?: number };
export const STICKER_MIN_W = 80;
export const STICKER_MAX_W = 900;
export const STICKER_DEFAULT_IMAGE_W = 220;
export const STICKER_DEFAULT_TEXT_W = 280;
export const STICKER_MAX_Y = 20000;
export const MAX_WIDGET_BYTES = 4096;

export type ImageData = { source: "upload" | "link"; path?: string; url?: string; alt: string; caption: string; animated: boolean } & StickerPos;

export type TextData = { text: string; size: "heading" | "body"; align: "left" | "center" | "right" } & StickerPos;
export const MAX_TEXT = 2000;

// Sticky notes as free stickers (migration 28). Square paper notes; colours match the old sticky-note widget.
export const STICKY_COLORS = [
  { id: "yellow", label: "Yellow", bg: "#fff3b0" },
  { id: "pink", label: "Pink", bg: "#fde0e4" },
  { id: "blue", label: "Blue", bg: "#dcebfb" },
  { id: "green", label: "Green", bg: "#e1f1dc" },
  { id: "peach", label: "Peach", bg: "#fde5d2" },
] as const;
export const STICKY_COLOR_IDS: string[] = STICKY_COLORS.map((c) => c.id);
export const STICKY_MAX_TEXT = 1500;
export const STICKER_DEFAULT_STICKY_W = 200;
export type StickyData = { text: string; color: string; legacyId?: string } & StickerPos;

// Widget colour swatches. Only the surface is tinted (lightly in light mode, deeply in dark mode),
// so the theme text colours keep their contrast. Keys are stored; hex values live in CSS (.cw-tint-*).
export const WIDGET_COLORS = [
  { key: "coral", label: "Coral", hex: "#f2836b" }, { key: "peach", label: "Peach", hex: "#f4a87c" },
  { key: "amber", label: "Amber", hex: "#e6b34a" }, { key: "sage", label: "Sage", hex: "#a9c6a2" },
  { key: "mint", label: "Mint", hex: "#7fcdbb" }, { key: "sky", label: "Sky", hex: "#9cc3e6" },
  { key: "lavender", label: "Lavender", hex: "#c6b8ea" }, { key: "rose", label: "Rose", hex: "#e8a0b8" },
  { key: "stone", label: "Stone", hex: "#bdb4a6" }, { key: "slate", label: "Slate", hex: "#8aa0b4" },
] as const;
export const COLOR_KEYS: string[] = WIDGET_COLORS.map((c) => c.key);

export type GifResult = { id: string; title: string; preview: string; width: number; height: number };

export type CustomWidgetRow =
  | { id: string; kind: "gif"; data: GifData }
  | { id: string; kind: "text"; data: TextData }
  | { id: string; kind: "sticky"; data: StickyData }
  | { id: string; kind: "image"; data: ImageData; src: string | null };
