// Shared types and small helpers for user-hosted study-with-me rooms (migrations 23 and 24).
import type { LoopSceneId } from "@/lib/loopScenes";
import type { CoverDoc } from "@/lib/coverDoc";
export type SceneId = LoopSceneId;
export type CafeStatus = "unlisted" | "pending" | "public" | "hidden";
export type LoopKind = "preset" | "upload" | "image" | "color";
export type UserCafe = {
  id: string; owner_id: string; name: string; description: string;
  loop_kind: LoopKind; loop_preset: SceneId | null; loop_path: string | null; bg_color: string | null;
  music_kind: "none" | "link" | "upload"; music_url: string | null; music_path: string | null;
  focus_minutes: number; break_minutes: number; anchor: string; status: CafeStatus; created_at: string;
  cover_path?: string | null; cover_doc?: CoverDoc | null; // migration 42
};
export type Host = { id: string; display_name: string | null; avatar_color: string | null; avatar_icon: string | null };
export type UserCafeCard = UserCafe & { host: Host | null; loopUrl: string | null; coverUrl?: string | null };
export type PendingCafe = { cafe: UserCafe; host: Host | null; loopUrl: string | null; audioUrl: string | null; coverUrl?: string | null };
export type CafeInput = {
  name: string; description: string;
  loop_kind: LoopKind; loop_preset: SceneId | null; loop_path: string | null; bg_color: string | null;
  music_kind: "none" | "link" | "upload"; music_url: string | null; music_path: string | null;
  focus_minutes: number; break_minutes: number; listing: "unlisted" | "pending";
  // Only sent when the cover changed: a path (or null to remove it) with its editable layers.
  cover_path?: string | null; cover_doc?: CoverDoc | null;
};

export const STATUS_LABEL: Record<CafeStatus, string> = { unlisted: "Link only", pending: "Awaiting review", public: "Listed", hidden: "Hidden" };

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

// Calm, mid-to-dark swatches. Names are used as accessible labels.
export const BG_SWATCHES: { hex: string; name: string }[] = [
  { hex: "#2f4858", name: "Slate blue" },
  { hex: "#33658a", name: "Ocean" },
  { hex: "#3d5a4c", name: "Moss" },
  { hex: "#4a6b5d", name: "Sage" },
  { hex: "#5b4b6e", name: "Dusk purple" },
  { hex: "#7a4a5a", name: "Plum" },
  { hex: "#8c4a3a", name: "Terracotta" },
  { hex: "#6b5a45", name: "Mocha" },
  { hex: "#3b3f4a", name: "Graphite" },
  { hex: "#1f2a44", name: "Midnight" },
];
export const DEFAULT_BG = BG_SWATCHES[0].hex;

const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminance(r: number, g: number, b: number) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }

// Darkness of the black veil over a colour so white text keeps at least 4.5:1 (we aim for 4.8).
// Never lighter than the standard veil. Pictures use IMAGE_VEIL, which holds 4.5:1 even over pure white.
export const BASE_VEIL = 0.34;
export const IMAGE_VEIL = 0.58;
export function colorVeil(hex: string): number {
  if (!HEX_COLOR.test(hex)) return IMAGE_VEIL;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const limit = 1.05 / 4.8 - 0.05; // max background luminance for white text
  for (let a = BASE_VEIL; a < 1; a += 0.01) {
    if (luminance(r * (1 - a), g * (1 - a), b * (1 - a)) <= limit) return Math.round(a * 100) / 100;
  }
  return 0.9;
}
