// Shared café clock. Every client (and cafe_phase() in SQL) derives the phase from
// (now - anchor) mod (focus + break), so no host or server tick is needed.
export type CafeClockRoom = { focus_minutes: number; break_minutes: number; anchor: string };
export type CafePhase = { phase: "focus" | "break"; remainingSec: number; cycleIndex: number; endsAtMs: number };

export function getPhase(room: CafeClockRoom, nowMs: number): CafePhase {
  const f = room.focus_minutes * 60000;
  const cycle = f + room.break_minutes * 60000;
  const elapsed = nowMs - Date.parse(room.anchor);
  const pos = ((elapsed % cycle) + cycle) % cycle;
  const cycleIndex = Math.floor(elapsed / cycle);
  const inFocus = pos < f;
  const left = (inFocus ? f : cycle) - pos;
  return { phase: inFocus ? "focus" : "break", remainingSec: Math.ceil(left / 1000), cycleIndex, endsAtMs: nowMs + left };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
