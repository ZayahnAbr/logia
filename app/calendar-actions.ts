"use server";

import { createClient } from "@/lib/supabase/server";
import { callChat, callVision } from "@/lib/server/aiRoute";
import { enforceRateLimit, friendlyError, isUnmetered } from "@/lib/server/llm";
import { AI_CLASS_TYPES, TYPE_MAX, DAY_KEYS, fmtMin, isHex, parseHM, type ClassInput, type ClassType, type DraftClass, type TimetableClass } from "@/lib/timetable";

export type CalEvent = {
  id: string; space_id: string | null; title: string; kind: "test" | "assignment" | "task" | "other";
  due_at: string; all_day: boolean; urgency: "low" | "medium" | "high" | "urgent"; color: string; notes: string; done: boolean; meeting_url?: string;
};
export type CalInput = Omit<CalEvent, "id" | "done"> & { done?: boolean };

const MISSING = "The calendar needs a database update. Run supabase/migration-20-calendar.sql.";
const nice = (m: string) => (/calendar_events|schema cache|does not exist/i.test(m) ? MISSING : "Couldn't save that. Try again.");
const KINDS = ["test", "assignment", "task", "other"], URGENCY = ["low", "medium", "high", "urgent"];

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

/** The first http(s) link in whatever was typed or pasted (a whole Teams invite works). Empty if none. */
export async function meetingUrlFrom(raw: string | undefined): Promise<string> {
  const m = (raw ?? "").match(/https?:\/\/[^\s<>"')]+/i);
  if (!m) return "";
  try { const u = new URL(m[0]); return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 600) : ""; } catch { return ""; }
}

async function clean(i: CalInput) {
  const due = new Date(i.due_at);
  if (!i.title?.trim()) throw new Error("Give it a title.");
  if (Number.isNaN(due.getTime())) throw new Error("Pick a valid date.");
  return {
    space_id: i.space_id || null, title: i.title.trim().slice(0, 160), kind: KINDS.includes(i.kind) ? i.kind : "task",
    due_at: due.toISOString(), all_day: !!i.all_day, urgency: URGENCY.includes(i.urgency) ? i.urgency : "medium",
    color: /^#[0-9a-fA-F]{6}$/.test(i.color) ? i.color : "#f2836b", notes: (i.notes ?? "").slice(0, 1000), done: !!i.done,
    meeting_url: await meetingUrlFrom(i.meeting_url),
  };
}

/** Events in a window. spaceId = that space only; omit for everything (dashboard). */
export async function listEvents(fromIso: string, toIso: string, spaceId?: string): Promise<{ events: CalEvent[] } | { error: string }> {
  const { supabase } = await authed();
  let q = supabase.from("calendar_events").select("*").gte("due_at", fromIso).lte("due_at", toIso).order("due_at");
  if (spaceId) q = q.eq("space_id", spaceId);
  const { data, error } = await q;
  return error ? { error: nice(error.message) } : { events: (data ?? []) as CalEvent[] };
}

export async function saveEvent(input: CalInput, id?: string) {
  try {
    const { supabase, user } = await authed();
    const row = await clean(input);
    const run = (r: Record<string, unknown>) => id
      ? supabase.from("calendar_events").update(r).eq("id", id).select("*").single()
      : supabase.from("calendar_events").insert({ ...r, user_id: user.id }).select("*").single();
    let res = await run(row), warning: string | undefined;
    if (res.error && /meeting_url/i.test(res.error.message)) {
      // Migration 53 not run yet: save everything else and say so.
      const { meeting_url: _drop, ...rest } = row; void _drop;
      res = await run(rest);
      if (row.meeting_url) warning = "Saved without the meeting link. Run supabase/migration-53-calendar-meeting-link.sql to keep it.";
    }
    if (res.error) return { error: nice(res.error.message) };
    return { event: res.data as CalEvent, warning };
  } catch (e) { return { error: e instanceof Error ? e.message : "Couldn't save that." }; }
}

export async function setEventDone(id: string, done: boolean) {
  const { supabase } = await authed();
  const { error } = await supabase.from("calendar_events").update({ done }).eq("id", id);
  return error ? { error: nice(error.message) } : {};
}

// ---------- Timetable from a photo ----------
const TT_MISSING = "The timetable needs a database update. Run supabase/migration-31-timetable.sql.";
const ttNice = (m: string) => (/timetable_classes|schema cache|does not exist/i.test(m) ? TT_MISSING : "Couldn't save that. Try again.");

const TT_PROMPT = `You read a student's weekly university or school timetable and return strict JSON only.
Shape: {"terms":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"},"classes":[{"title":"","courseCode":"","type":"lecture|tutorial|lab|practical|seminar|other","day":"mon|tue|wed|thu|fri|sat|sun","start":"HH:MM","end":"HH:MM","venue":"","weeks":""}]}
Rules:
- Copy only what is visible. Never invent or guess a time, venue, course or date. Leave out "terms", "courseCode", "venue" or "weeks" when not shown.
- Times are 24-hour HH:MM in the output. Convert 12-hour times (2pm = 14:00). If am/pm is missing, use the most sensible school-day reading only when the context makes it obvious, otherwise skip that class.
- Grids: days may be columns or rows, and a block spanning several rows is one class from its first row start to its last row end. Merge duplicate cells of the same class.
- If a class meets on several days, output one entry per day.
- type: pick from the label (L, Lec, Lecture; T, Tut, Tutorial; Lab; Prac, Practical; Sem) else "other".
- If the content is not a timetable, return {"classes":[]}.`;

function extractJson(s: string) {
  const t = s.replace(/<think>[\s\S]*?<\/think>/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new SyntaxError("JSON missing");
  return JSON.parse(t.slice(a, b + 1));
}

/** Reads the timetable from photos (sent straight to the vision model) or pasted/PDF text. Saves nothing. */
export async function parseTimetable(images: string[], text: string): Promise<{ classes: DraftClass[]; termStart?: string; termEnd?: string } | { error: string }> {
  try {
    const { supabase, user } = await ttAuthed();
    const plan = (await enforceRateLimit(supabase, user)) ?? "free";
    const imgs = images.filter((i) => typeof i === "string" && i.startsWith("data:image/")).slice(0, 4);
    const body = (text ?? "").trim().slice(0, 12000);
    if (!imgs.length && !body) return { error: "Add a photo, a PDF or some pasted text first." };
    const prompt = `Extract the weekly timetable.${body ? `\n\nText from the document:\n${body}` : ""}`;
    const who = { supabase, userId: user.id, unmetered: isUnmetered(user.email), plan };
    // Images need the vision model (same one Scan uses); text alone uses the standard chat model.
    const { content } = imgs.length > 0
      ? await callVision({ purpose: "interactive", system: TT_PROMPT, imageDataUrls: imgs, text: prompt, maxTokens: 4000, task: "read a timetable", ...who })
      : await callChat({ purpose: "interactive", system: TT_PROMPT, user: prompt, maxTokens: 4000, json: true, temperature: 0, ...who });
    const out = extractJson(content);
    const classes: DraftClass[] = [];
    for (const c of Array.isArray(out.classes) ? out.classes.slice(0, 80) : []) {
      const wd = DAY_KEYS.indexOf(String(c?.day ?? "").toLowerCase().slice(0, 3) as (typeof DAY_KEYS)[number]);
      const s = parseHM(String(c?.start ?? "")), e = parseHM(String(c?.end ?? ""));
      if (wd < 0 || s === null || e === null || e <= s || !String(c?.title ?? "").trim()) continue;
      const type = (AI_CLASS_TYPES as readonly string[]).includes(c.type) ? (c.type as ClassType) : "other";
      classes.push({ key: crypto.randomUUID(), title: String(c.title).trim().slice(0, 120), course_code: String(c.courseCode ?? "").trim().slice(0, 30), class_type: type, weekday: wd, start: fmtMin(s), end: fmtMin(e), venue: String(c.venue ?? "").trim().slice(0, 80) });
    }
    const dt = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return { classes, termStart: dt(out.terms?.startDate), termEnd: dt(out.terms?.endDate) };
  } catch (e) { return { error: friendlyError(e, "read your timetable") }; }
}

/** Any short label the student chose (meeting, dentist, ...); blank falls back to "other". */
function cleanType(t: unknown): string {
  return String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TYPE_MAX) || "other";
}

async function ttAuthed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function listTimetable(): Promise<{ classes: TimetableClass[] } | { error: string }> {
  try {
    const { supabase } = await ttAuthed();
    const base = "id, space_id, title, course_code, class_type, weekday, start_min, end_min, venue, term_start, term_end";
    let { data, error } = (await supabase.from("timetable_classes").select(`${base}, color, notes`).order("weekday").order("start_min")) as { data: unknown[] | null; error: { message: string } | null };
    if (error) ({ data, error } = (await supabase.from("timetable_classes").select(base).order("weekday").order("start_min")) as { data: unknown[] | null; error: { message: string } | null }); // migration 32 not run yet
    return error ? { error: ttNice(error.message) } : { classes: (data ?? []) as unknown as TimetableClass[] };
  } catch { return { error: "Your session has expired. Please sign in again." }; }
}

/** Saves the reviewed rows. replace=true swaps out the student's current timetable. */
export async function saveTimetable(rows: DraftClass[], opts: { replace: boolean; spaceId?: string | null; termStart?: string | null; termEnd?: string | null }): Promise<{ saved: number } | { error: string }> {
  try {
    const { supabase, user } = await ttAuthed();
    const dt = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const data = [];
    for (const r of rows.slice(0, 80)) {
      const s = parseHM(r.start), e = parseHM(r.end);
      if (!r.title.trim() || s === null || e === null || e <= s || r.weekday < 0 || r.weekday > 6) return { error: `Check "${r.title || "a class"}": it needs a title and an end time after the start.` };
      data.push({ user_id: user.id, space_id: opts.spaceId || null, title: r.title.trim().slice(0, 120), course_code: r.course_code.trim().slice(0, 30), class_type: cleanType(r.class_type), weekday: r.weekday, start_min: s, end_min: e, venue: r.venue.trim().slice(0, 80), term_start: dt(opts.termStart), term_end: dt(opts.termEnd) });
    }
    if (!data.length) return { error: "Add at least one class to save." };
    if (opts.replace) {
      const del = await supabase.from("timetable_classes").delete().eq("user_id", user.id);
      if (del.error) return { error: ttNice(del.error.message) };
    }
    const ins = await supabase.from("timetable_classes").insert(data);
    return ins.error ? { error: ttNice(ins.error.message) } : { saved: data.length };
  } catch (e) { return { error: friendlyError(e, "save your timetable") }; }
}

/** Adds or updates one class (timetable maker). If migration 32 is missing, saves without colour and notes and says so. */
export async function saveClass(i: ClassInput): Promise<{ cls: TimetableClass; warning?: string } | { error: string }> {
  try {
    const { supabase, user } = await ttAuthed();
    const title = String(i.title ?? "").trim();
    if (!title) return { error: "Give the class a title." };
    if (!Number.isInteger(i.weekday) || i.weekday < 0 || i.weekday > 6) return { error: "Pick a day." };
    if (!Number.isInteger(i.start_min) || !Number.isInteger(i.end_min) || i.start_min < 0 || i.end_min > 1440 || i.end_min <= i.start_min) return { error: "The end time must be after the start time." };
    const row = {
      title: title.slice(0, 120), course_code: String(i.course_code ?? "").trim().slice(0, 30),
      class_type: cleanType(i.class_type),
      weekday: i.weekday, start_min: i.start_min, end_min: i.end_min, venue: String(i.venue ?? "").trim().slice(0, 80), space_id: i.space_id || null,
    };
    const style = { color: isHex(i.color) ? i.color : null, notes: String(i.notes ?? "").slice(0, 500) };
    const base = "id, space_id, title, course_code, class_type, weekday, start_min, end_min, venue, term_start, term_end";
    const run = async (withStyle: boolean) => {
      const q = i.id
        ? supabase.from("timetable_classes").update(withStyle ? { ...row, ...style } : row).eq("id", i.id).eq("user_id", user.id)
        : supabase.from("timetable_classes").insert({ user_id: user.id, ...row, ...(withStyle ? style : {}) });
      return q.select(withStyle ? `${base}, color, notes` : base).single();
    };
    let res = await run(true), warning: string | undefined;
    if (res.error && /color|notes/i.test(res.error.message)) {
      res = await run(false);
      warning = "Saved without colour and notes. Run supabase/migration-32-timetable-style.sql to keep them.";
    }
    if (res.error || !res.data) return { error: res.error ? ttNice(res.error.message) : "Couldn't save that. Try again." };
    return { cls: res.data as unknown as TimetableClass, warning };
  } catch (e) { return { error: friendlyError(e, "save that class") }; }
}

export async function deleteClass(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await ttAuthed();
    const { error } = await supabase.from("timetable_classes").delete().eq("id", id).eq("user_id", user.id);
    return error ? { error: ttNice(error.message) } : {};
  } catch { return { error: "Your session has expired. Please sign in again." }; }
}

export async function deleteTimetable(): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await ttAuthed();
    const { error } = await supabase.from("timetable_classes").delete().eq("user_id", user.id);
    return error ? { error: ttNice(error.message) } : {};
  } catch { return { error: "Your session has expired. Please sign in again." }; }
}

export async function deleteEvent(id: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("calendar_events").delete().eq("id", id);
  return error ? { error: nice(error.message) } : {};
}
