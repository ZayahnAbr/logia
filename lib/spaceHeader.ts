// Space header customisation (migration 38). A plain module: safe to import from server and client code.
export const HEADER_BUCKET = "space-headers";
export const HEADER_EXPORT_WIDTH = 1600;
export const HEADER_MAX_BYTES = 5 * 1024 * 1024;
export const HEADER_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
export const HEADER_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type HeaderKind = "default" | "color" | "image";
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Dark or light text, whichever has the higher contrast on this colour (always at least 4.5:1). */
export function textToneFor(hex: string): "dark" | "light" {
  return contrastRatio(hex, "#111111") >= contrastRatio(hex, "#ffffff") ? "dark" : "light";
}

/** The least black overlay (0 to 1) that keeps white text at 4.5:1 or better on this colour. */
export function shadeForWhite(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let a = 0; a <= 0.9; a += 0.02) {
    const mixed = "#" + rgb.map((c) => Math.round(c * (1 - a)).toString(16).padStart(2, "0")).join("");
    if (contrastRatio(mixed, "#ffffff") >= 4.6) return Math.round(a * 100) / 100;
  }
  return 0.9;
}

/** The student's choice of overlay (percent of black, 0 to 80; null = automatic) and text colour (null = light). */
export type HeaderStyle = { overlay: number | null; tone: "light" | "dark" | null };
export const NO_STYLE: HeaderStyle = { overlay: null, tone: null };
export const OVERLAY_MAX = 80;
export const cleanOverlay = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(OVERLAY_MAX, Math.max(0, Math.round(v))) : null);
export const cleanTone = (v: unknown): "light" | "dark" | null => (v === "dark" || v === "light" ? v : null);

/** Class names and inline variables for the header band. */
export function headerLook(kind: HeaderKind | null | undefined, color: string | null | undefined, imageUrl: string | null | undefined, style: HeaderStyle = NO_STYLE) {
  const tone = style.tone === "dark" ? "sh-tone-dark" : "sh-tone-light";
  const overlay = cleanOverlay(style.overlay);
  if (kind === "color" && color && HEX_RE.test(color)) {
    // Header text is always white. On pale colours a soft shade sits behind the text, only as dark as
    // needed for the text to stay readable, so the chosen colour still shows across the band.
    const shade = overlay !== null ? overlay / 100 : shadeForWhite(color);
    return { className: `sh-band sh-color ${tone}`, style: { ["--sh-bg" as string]: color, ["--sh-shade" as string]: String(shade) } as Record<string, string>, mesh: false };
  }
  if (kind === "image" && imageUrl) {
    const vars: Record<string, string> = { ["--sh-img"]: `url("${imageUrl}")` };
    if (overlay !== null) vars["--sh-scrim"] = String(overlay / 100);
    return { className: `sh-band sh-image ${tone}${overlay !== null ? " sh-scrimmed" : ""}`, style: vars, mesh: false };
  }
  return { className: "", style: {} as Record<string, string>, mesh: true };
}
