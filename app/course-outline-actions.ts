"use server";

import { revalidatePath } from "next/cache";
import { authed, friendlyError, groqChat } from "@/lib/server/llm";
import { notebookIdForName } from "@/lib/server/notebooks";
import { saveEvent } from "@/app/calendar-actions";
import { ASSESSMENT_TYPES, TYPE_STYLE, type AssessmentType, type OutlineResult } from "@/lib/courseOutline";

// Long outlines are read in parts and merged, so the student never has to split a file themselves.
const PART_CHARS = 16000;   // per AI call, comfortably inside the model's limit
const MAX_PARTS = 8;        // about 88k characters, which covers a full course handbook

// Split on blank lines, then lines, so a part never ends mid-sentence where it can be avoided.
function splitParts(text: string): string[] {
  if (text.length <= PART_CHARS) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const block of text.split(/\n(?=\S)/)) {
    const piece = block.length > PART_CHARS ? block : block + "\n";
    if (cur.length + piece.length > PART_CHARS && cur) { parts.push(cur); cur = ""; }
    if (piece.length > PART_CHARS) {
      for (let i = 0; i < piece.length; i += PART_CHARS) parts.push(piece.slice(i, i + PART_CHARS));
    } else cur += piece;
    if (parts.length >= MAX_PARTS) break;
  }
  if (cur && parts.length < MAX_PARTS) parts.push(cur);
  return parts.slice(0, MAX_PARTS);
}

const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN; return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : undefined; };
const isoDate = (v: unknown) => { const s = str(v, 40); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return undefined; const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`); return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? undefined : `${m[1]}-${m[2]}-${m[3]}`; };

const SYSTEM = `You read a university course outline, syllabus or course handbook and extract its structure.
Return ONLY JSON of this shape (omit any field the document does not state):
{ "isCourseOutline": true|false,
  "courseCode": "e.g. PSY1001", "courseName": "...", "lecturerName": "...",
  "topics": [ { "name": "topic or unit title", "week": "Week 3" or "3", "source": "short quote, max 12 words, from the document" } ],
  "assessments": [ { "title": "...", "type": "test|exam|assignment|quiz|other", "weightPercent": 20, "dueDate": "YYYY-MM-DD", "notes": "...", "source": "short quote, max 12 words" } ],
  "textbooks": [ { "title": "...", "author": "..." } ],
  "notes": "anything important not covered above, max 2 sentences" }
Rules:
- Copy only what is actually in the document. Never invent, guess or infer dates, weights, names or topics.
- Leave a field out when it is absent. A dueDate is only allowed when the document gives a full date including the year, or a year can be read unambiguously from the document; otherwise leave dueDate out and put the wording (for example "Week 7") in notes.
- weightPercent is the percentage of the final course mark, as a number 0 to 100, only if stated.
- Course outlines usually carry a mark breakdown, assessment table or weighting table, often laid out as rows
  like "Test 1 ... 25%" or "Assignment 2 20". Read every row of it and set weightPercent for each assessment,
  including a final exam row. Lines may have lost their table borders, so treat a percentage near an assessment
  name on the same line as that assessment's weight. Still never invent a weight that is not written down.
- Topics are the teaching units, themes or chapters, in the document's order. No more than 40.
- If the document is clearly not a course outline, syllabus or handbook, return { "isCourseOutline": false } and nothing else.`;

// A long document is read in parts. A single part is a fragment (a cover page, a reading list, one
// table), so it must never be judged as a whole: just pull out whatever that fragment contains.
const SYSTEM_PART = `${SYSTEM.replace(
  '- If the document is clearly not a course outline, syllabus or handbook, return { "isCourseOutline": false } and nothing else.',
  "")}
IMPORTANT: the text you are given is ONE PART of a longer course outline, cut at an arbitrary point.
- Always set "isCourseOutline": true and extract everything this part contains.
- Never judge whether the whole document is a course outline, and never return { "isCourseOutline": false }.
- If this part has no topics, assessments or textbooks, return empty arrays for them. That is fine.
- Include partial items: a topic list that continues from the previous part, a lone weighting table, a
  reading list on its own. Later parts are merged with this one.`;

export async function analyseOutline(fileName: string, text: string): Promise<{ result: OutlineResult; truncated: boolean } | { error: string }> {
  try {
    const source = (text ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    if (source.length < 150) return { error: "There isn't enough readable text in this file. If it is a scan, open it from Files and use Extract text first, or try a different file." };
    const parts = splitParts(source);
    const truncated = parts.join("").length < source.length;

    // Read each part, then merge. One failed part never loses the rest.
    const results: Record<string, unknown>[] = [];
    let lastError: unknown = null;
    for (let i = 0; i < parts.length; i++) {
      const label = parts.length > 1 ? `FILE: ${str(fileName, 120)} (part ${i + 1} of ${parts.length})` : `FILE: ${str(fileName, 120)}`;
      try {
        results.push(await groqChat(parts.length > 1 ? SYSTEM_PART : SYSTEM, `${label}\n\n${parts[i]}`, 4000, "batch", "read your course outline"));
      } catch (e) { lastError = e; console.log("[outline] part failed", i + 1, "of", parts.length, e instanceof Error ? e.message : e); }
    }
    if (!results.length) return { error: friendlyError(lastError, "read the course outline") };
    // Do not reject on the model's verdict alone: a part that happens to be a reading list or a
    // cover page says "not an outline" even in a real one. The usable-content check below decides.

    // Merge the parts: first value wins for the single fields, lists are joined and de-duplicated.
    const pick = (k: string) => results.map((r) => str(r[k], 200)).find(Boolean) ?? "";
    const listOf = (k: string) => results.flatMap((r) => (Array.isArray(r[k]) ? (r[k] as Record<string, unknown>[]) : []));
    // Merge duplicates rather than keeping the first: a schedule may name an assessment with no
    // weight while the mark table a few pages later gives the weight. Both end up on one row.
    const dedupe = (rows: Record<string, unknown>[], key: (r: Record<string, unknown>) => string) => {
      const byKey = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const k = key(r);
        if (!k) continue;
        const prev = byKey.get(k);
        if (!prev) { byKey.set(k, { ...r }); continue; }
        for (const [f, v] of Object.entries(r)) {
          if (v === null || v === undefined || v === "") continue;
          if (prev[f] === null || prev[f] === undefined || prev[f] === "") prev[f] = v;
        }
      }
      return [...byKey.values()];
    };
    const parsed: Record<string, unknown> = {
      courseCode: pick("courseCode"), courseName: pick("courseName"), lecturerName: pick("lecturerName"), notes: pick("notes"),
      topics: dedupe(listOf("topics"), (t) => keyOf(str(t?.name, 120))),
      assessments: dedupe(listOf("assessments"), (a) => keyOf(str(a?.title, 120))),
      textbooks: dedupe(listOf("textbooks"), (b) => keyOf(str(b?.title, 200))),
    };
    const topics = (Array.isArray(parsed.topics) ? parsed.topics : []).slice(0, 40)
      .map((t: Record<string, unknown>) => ({ name: str(t?.name, 120), week: str(t?.week, 30) || undefined, source: str(t?.source, 160) || undefined })).filter((t: { name: string }) => t.name);
    // Second pass: if no weights came back but the document clearly has a mark breakdown, ask for
    // just the weight table. Mark weightings are the part students most need, so it is worth one call.
    const anyWeight = (parsed.assessments as Record<string, unknown>[]).some((a) => num(a?.weightPercent) !== undefined);
    const weightText = parts.filter((p) => /\d\s?%|percent|weight|mark (?:breakdown|allocation)|final mark/i.test(p)).join("\n\n").slice(0, PART_CHARS);
    if (!anyWeight && weightText.length > 200) {
      try {
        const w = await groqChat(
          `From the course outline text, return ONLY JSON { "assessments": [ { "title": "...", "weightPercent": 25 } ] } listing every assessment that has a stated percentage of the final mark. Copy the titles as written. Leave out anything with no stated percentage. Invent nothing.`,
          weightText, 1500);
        const found = (Array.isArray(w.assessments) ? w.assessments : []) as Record<string, unknown>[];
        if (found.length) {
          parsed.assessments = dedupe([...(parsed.assessments as Record<string, unknown>[]), ...found], (a) => keyOf(str(a?.title, 120)));
        }
      } catch { /* the first pass still stands */ }
    }

    const assessments = (Array.isArray(parsed.assessments) ? parsed.assessments : []).slice(0, 40)
      .map((a: Record<string, unknown>) => ({
        title: str(a?.title, 120), type: (ASSESSMENT_TYPES as readonly string[]).includes(String(a?.type)) ? (a.type as AssessmentType) : "other",
        weightPercent: num(a?.weightPercent), dueDate: isoDate(a?.dueDate), notes: str(a?.notes, 300) || undefined, source: str(a?.source, 160) || undefined,
      })).filter((a: { title: string }) => a.title);
    const textbooks = (Array.isArray(parsed.textbooks) ? parsed.textbooks : []).slice(0, 15)
      .map((b: Record<string, unknown>) => ({ title: str(b?.title, 200), author: str(b?.author, 120) || undefined })).filter((b: { title: string }) => b.title);
    if (!topics.length && !assessments.length && !textbooks.length) {
      // The counts make it obvious whether the file was unreadable or the AI found nothing in it.
      console.log("[outline] no results", { chars: source.length, parts: parts.length, replies: results.length });
      return { error: `No topics, assessments or textbooks were found. Logia read ${source.length} characters from this file in ${parts.length} part${parts.length === 1 ? "" : "s"}. If it is a scan or a photo, open it from Files and use Extract text first. Otherwise try the document your lecturer calls the course outline or study guide.` };
    }
    return {
      truncated,
      result: { courseCode: str(parsed.courseCode, 30) || undefined, courseName: str(parsed.courseName, 160) || undefined, lecturerName: str(parsed.lecturerName, 120) || undefined, notes: str(parsed.notes, 400) || undefined, topics, assessments, textbooks },
    };
  } catch (e) {
    return { error: friendlyError(e, "read the course outline") };
  }
}

export type CreateInput = {
  courseCode?: string; courseName?: string; lecturerName?: string;
  topics: { name: string; week?: string; notebook: boolean }[];
  assessments: { title: string; type: AssessmentType; weightPercent?: number; dueDate?: string; deadline: boolean }[];
  textbooks: { title: string; author?: string }[];
  raw?: unknown;
};

// courseId set = read the outline INTO that course, replacing only its assessments and topics.
// Without it a new course is added. Before migration 33 there is only one course, so it is replaced.
export async function createFromOutline(spaceId: string, input: CreateInput, courseId?: string): Promise<{ notebooks: number; deadlines: number; warnings: string[] } | { error: string }> {
  try {
    const { supabase, user } = await authed();
    const warnings: string[] = [];
    const topics = (input.topics ?? []).slice(0, 40).map((t) => ({ name: str(t.name, 60), week: str(t.week, 30), notebook: !!t.notebook })).filter((t) => t.name);
    const assessments = (input.assessments ?? []).slice(0, 40).map((a) => ({
      title: str(a.title, 160), type: (ASSESSMENT_TYPES as readonly string[]).includes(a.type) ? a.type : ("other" as AssessmentType),
      weight: num(a.weightPercent), date: isoDate(a.dueDate), deadline: !!a.deadline,
    })).filter((a) => a.title);

    const multi = !(await supabase.from("course_assessments").select("course_id").limit(1)).error;
    const fields = {
      course_code: str(input.courseCode, 30) || null, course_name: str(input.courseName, 160) || null,
      lecturer: str(input.lecturerName, 120) || null, textbooks: (input.textbooks ?? []).slice(0, 15).map((b) => ({ title: str(b.title, 200), author: str(b.author, 120) || undefined })), raw: (input.raw as object) ?? {},
    };
    let cid: string | null = null;
    if (multi && courseId && courseId !== "legacy") {
      const { error } = await supabase.from("course_outlines").update(fields).eq("id", courseId).eq("user_id", user.id);
      if (error) return { error: friendlyError(error, "save the course outline") };
      cid = courseId;
      await supabase.from("course_assessments").delete().eq("course_id", cid).eq("user_id", user.id);
      await supabase.from("course_topics").delete().eq("course_id", cid).eq("user_id", user.id);
    } else {
      const { data, error } = await supabase.from("course_outlines").insert({ space_id: spaceId, user_id: user.id, ...fields }).select("id").single();
      if (error) return { error: friendlyError(error, "save the course outline") };
      if (multi) cid = data.id as string;
      else {
        // Before migration 33 a space holds one course: replace what was there.
        await supabase.from("course_assessments").delete().eq("space_id", spaceId).eq("user_id", user.id);
        await supabase.from("course_topics").delete().eq("space_id", spaceId).eq("user_id", user.id);
        warnings.push("Your database doesn't have the several-courses update yet, so this replaced your earlier course. Ask the site admin to run migration 33.");
      }
    }
    const link = cid ? { course_id: cid } : {};
    if (assessments.length) {
      const { error } = await supabase.from("course_assessments").insert(assessments.map((a) => ({
        space_id: spaceId, user_id: user.id, ...link, title: a.title, type: a.type, weight_percent: a.weight ?? null, due_at: a.date ? `${a.date}T12:00:00Z` : null,
      })));
      if (error) warnings.push("The marks calculator couldn't be set up.");
    }
    if (topics.length) {
      const { error } = await supabase.from("course_topics").insert(topics.map((t, i) => ({ space_id: spaceId, user_id: user.id, ...link, name: t.name, week: t.week || null, sort: i })));
      if (error) warnings.push("The topic checklist couldn't be set up.");
    }

    let notebooks = 0;
    for (const t of topics.filter((x) => x.notebook)) {
      const id = await notebookIdForName(supabase, spaceId, user.id, t.name);
      if (id) notebooks++;
    }
    if (topics.some((t) => t.notebook) && notebooks === 0) warnings.push("Notebooks couldn't be created.");

    let deadlines = 0;
    for (const a of assessments.filter((x) => x.deadline && x.date)) {
      const st = TYPE_STYLE[a.type];
      const res = await saveEvent({
        space_id: spaceId, title: a.title, kind: st.kind, due_at: `${a.date}T12:00:00Z`, all_day: true, urgency: st.urgency, color: st.color,
        notes: a.weight != null ? `Counts ${a.weight}% of the course mark. From your course outline.` : "From your course outline.",
      });
      if ("event" in res) deadlines++; else warnings.push(`"${a.title}": ${res.error}`);
    }
    revalidatePath(`/spaces/${spaceId}`);
    revalidatePath(`/spaces/${spaceId}/notes`);
    revalidatePath(`/spaces/${spaceId}/course`);
    return { notebooks, deadlines, warnings };
  } catch (e) {
    return { error: friendlyError(e, "set up the space") };
  }
}

export async function setAssessmentMark(id: string, mark: number | null) {
  const { supabase } = await authed();
  if (mark != null && !(mark >= 0 && mark <= 100)) return { error: "Enter a mark between 0 and 100." };
  const { error } = await supabase.from("course_assessments").update({ mark_percent: mark }).eq("id", id);
  return error ? { error: "Couldn't save that mark. Try again." } : {};
}

export async function renameCourse(spaceId: string, courseId: string, code: string, name: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("course_outlines").update({ course_code: str(code, 30) || null, course_name: str(name, 160) || null }).eq("id", courseId).eq("user_id", user.id);
  if (error) return { error: "Couldn't rename the course. Try again." };
  revalidatePath(`/spaces/${spaceId}/course`); revalidatePath(`/spaces/${spaceId}`);
  return {};
}

// Deletes the course with its assessments and topics (cascade). Calendar deadlines and notebooks already made stay.
export async function deleteCourse(spaceId: string, courseId: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("course_outlines").delete().eq("id", courseId).eq("user_id", user.id);
  if (error) return { error: "Couldn't delete the course. Try again." };
  revalidatePath(`/spaces/${spaceId}/course`); revalidatePath(`/spaces/${spaceId}`);
  return {};
}

export async function setTopicDone(id: string, done: boolean) {
  const { supabase } = await authed();
  const { error } = await supabase.from("course_topics").update({ done }).eq("id", id);
  return error ? { error: "Couldn't save that. Try again." } : {};
}
