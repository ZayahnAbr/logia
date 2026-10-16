// Shared timetable types and helpers (no "use client"/"use server", safe for both sides).
// An entry's type is free text: these are only suggestions, so a meeting, appointment or anything else works.
export const CLASS_TYPES = ["lecture", "tutorial", "lab", "practical", "seminar", "meeting", "appointment", "study session", "exam", "work", "personal", "other"] as const;
/** What the timetable reads from a photo: the AI only picks from the school-class types. */
export const AI_CLASS_TYPES = ["lecture", "tutorial", "lab", "practical", "seminar", "other"] as const;
export type ClassType = string;
export const TYPE_MAX = 30;
export const TYPE_LABEL: Record<string, string> = { lecture: "Lecture", tutorial: "Tutorial", lab: "Lab", practical: "Practical", seminar: "Seminar", meeting: "Meeting", appointment: "Appointment", "study session": "Study session", exam: "Exam", work: "Work", personal: "Personal", other: "Event" };
/** Display name for any type, including ones the student typed themselves. */
export const typeLabel = (t: string | null | undefined) => {
  const k = (t ?? "").trim();
  if (!k) return TYPE_LABEL.other;
  return TYPE_LABEL[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1);
};

// weekday: 0 = Monday ... 6 = Sunday
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type TimetableClass = {
  id: string; space_id: string | null; title: string; course_code: string; class_type: ClassType;
  weekday: number; start_min: number; end_min: number; venue: string; term_start: string | null; term_end: string | null;
  color?: string | null; notes?: string; // need migration 32
};
/** What the timetable maker sends to saveClass. */
export type ClassInput = {
  id?: string; title: string; course_code: string; class_type: ClassType; weekday: number; start_min: number; end_min: number;
  venue: string; space_id: string | null; color: string | null; notes: string;
};

// Calm palette. Text on each is picked from its luminance, so contrast passes in both themes.
export const PALETTE: { name: string; hex: string }[] = [
  { name: "Coral", hex: "#f0a283" }, { name: "Sand", hex: "#e6cf9a" }, { name: "Sage", hex: "#a9cdb0" },
  { name: "Teal", hex: "#7fc0b9" }, { name: "Sky", hex: "#9fc4e2" }, { name: "Lavender", hex: "#c3b6e4" },
  { name: "Rose", hex: "#e9aab6" }, { name: "Stone", hex: "#c4bfba" }, { name: "Slate", hex: "#4f5d73" }, { name: "Plum", hex: "#6e4c7a" },
];
export const DEFAULT_COLOR: Record<string, string> = { lecture: "#9fc4e2", tutorial: "#a9cdb0", lab: "#e6cf9a", practical: "#7fc0b9", seminar: "#c3b6e4", meeting: "#e9aab6", appointment: "#f0a283", "study session": "#a9cdb0", exam: "#6e4c7a", work: "#4f5d73", personal: "#e6cf9a", other: "#c4bfba" };
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
export const classColor = (c: { color?: string | null; class_type: ClassType }) => (isHex(c.color) ? c.color : DEFAULT_COLOR[(c.class_type ?? "").toLowerCase()] ?? DEFAULT_COLOR.other);
/** Ink colour with the best contrast on the given background (always at least 4.5:1 for the palette). */
export const inkOn = (bg: string) => { const L = lum(bg); return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#1b1a19" : "#ffffff"; };

/** Overlapping pairs within a day. */
export function findClashes(all: TimetableClass[]): { a: TimetableClass; b: TimetableClass }[] {
  const out: { a: TimetableClass; b: TimetableClass }[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const d = all.filter((c) => c.weekday === wd).sort((x, y) => x.start_min - y.start_min);
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length && d[j].start_min < d[i].end_min; j++) out.push({ a: d[i], b: d[j] });
  }
  return out;
}
// A row in the review screen (strings so inputs stay editable).
export type DraftClass = { key: string; title: string; course_code: string; class_type: ClassType; weekday: number; start: string; end: string; venue: string };

export const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const parseHM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};
/** Monday-first weekday index for a Date. */
export const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Classes that run on this date, respecting term_start/term_end, sorted by start. */
export function classesOn(all: TimetableClass[], d: Date): TimetableClass[] {
  const k = ymdOf(d), wd = weekdayOf(d);
  return all.filter((c) => c.weekday === wd && (!c.term_start || k >= c.term_start) && (!c.term_end || k <= c.term_end)).sort((a, b) => a.start_min - b.start_min);
}
/** The next class that has not finished yet, looking up to 8 days ahead. */
export function nextClass(all: TimetableClass[], now: Date): { c: TimetableClass; start: Date } | null {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (const c of classesOn(all, d)) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, c.start_min);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, c.end_min);
      if (end > now) return { c, start };
    }
  }
  return null;
}
export function countdown(start: Date, now: Date): string {
  const mins = Math.round((+start - +now) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `in ${Math.floor(mins / 1440)} day${mins >= 2880 ? "s" : ""}`;
}
/** Gaps of at least `min` minutes between consecutive classes (suggestions only). */
export function gaps(day: TimetableClass[], min = 60): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < day.length; i++) {
    const from = day[i].end_min, to = day[i + 1].start_min;
    if (to - from >= min) out.push({ from, to });
  }
  return out;
}
