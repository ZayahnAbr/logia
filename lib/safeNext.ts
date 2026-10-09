// A return address after sign-in or sign-up. Only a path on this site is accepted (never another site).
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  return raw;
}

/** Reads ?next= from the current browser address. */
export function nextFromLocation(): string | null {
  try { return safeNext(new URLSearchParams(window.location.search).get("next")); } catch { return null; }
}

/** Keeps ?next= when moving between the sign-in and sign-up pages. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
