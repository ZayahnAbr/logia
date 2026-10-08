import type { SupabaseClient } from "@supabase/supabase-js";

// Google Classroom sync. Runs on the server with the signed-in user's own Google access token.
// Read-only scopes only. The token is used for this request and is never stored.

const API = "https://classroom.googleapis.com/v1";
const DAY = 86_400_000;
const MAX_COURSES = 30;

export class ClassroomError extends Error {
  constructor(public kind: "expired" | "forbidden" | "api", message: string) { super(message); }
}

type Course = { id: string; name?: string; section?: string };
type Work = { id: string; title?: string; state?: string; workType?: string; alternateLink?: string; dueDate?: { year?: number; month?: number; day?: number }; dueTime?: { hours?: number; minutes?: number } };
type Submission = { courseWorkId?: string; state?: string };

async function gget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  if (res.status === 401) throw new ClassroomError("expired", "Google access has expired.");
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    throw new ClassroomError("forbidden", body.error?.message ?? "Google refused access to Classroom.");
  }
  if (!res.ok) throw new ClassroomError("api", `Google Classroom returned an error (${res.status}).`);
  return (await res.json()) as T;
}

async function pages<T>(token: string, path: string, key: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await gget<Record<string, unknown> & { nextPageToken?: string }>(token, path + (pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ""));
    out.push(...(((data[key] as T[]) ?? [])));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

const TYPE: Record<string, string> = { ASSIGNMENT: "assignment", SHORT_ANSWER_QUESTION: "quiz", MULTIPLE_CHOICE_QUESTION: "quiz" };

export type ClassroomRow = {
  source_id: string; title: string; course: string; item_type: string; due_at: string; url: string; completed: boolean;
};

export async function fetchClassroom(token: string): Promise<{ rows: ClassroomRow[]; undated: number; courses: number }> {
  const courses = (await pages<Course>(token, "/courses?studentId=me&courseStates=ACTIVE&pageSize=50", "courses", 3)).slice(0, MAX_COURSES);
  const from = Date.now() - 30 * DAY, to = Date.now() + 120 * DAY;
  const rows: ClassroomRow[] = [];
  let undated = 0;

  const one = async (c: Course) => {
    const [work, subs] = await Promise.all([
      pages<Work>(token, `/courses/${c.id}/courseWork?pageSize=100`, "courseWork", 3),
      pages<Submission>(token, `/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`, "studentSubmissions", 3),
    ]);
    const done = new Set(subs.filter((s) => s.state === "TURNED_IN" || s.state === "RETURNED").map((s) => s.courseWorkId));
    for (const w of work) {
      if (w.state && w.state !== "PUBLISHED") continue;
      if (!w.dueDate?.year || !w.dueDate.month || !w.dueDate.day) { undated++; continue; }
      // Classroom due dates are in UTC.
      const due = Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, w.dueTime?.hours ?? 0, w.dueTime?.minutes ?? 0);
      if (due < from || due > to) continue;
      const link = w.alternateLink && w.alternateLink.startsWith("https://classroom.google.com/") ? w.alternateLink.slice(0, 600) : "";
      rows.push({
        source_id: `${c.id}:${w.id}`.slice(0, 200),
        title: (w.title || "Untitled").slice(0, 300),
        course: (c.name || "").slice(0, 200),
        item_type: TYPE[w.workType ?? ""] ?? "other",
        due_at: new Date(due).toISOString(),
        url: link,
        completed: done.has(w.id),
      });
    }
  };
  for (let i = 0; i < courses.length; i += 5) await Promise.all(courses.slice(i, i + 5).map(one));
  return { rows, undated, courses: courses.length };
}

/** Fetch from Classroom and upsert into lms_items for this user (own-row RLS policies from migration 29). */
export async function runClassroomSync(supabase: SupabaseClient, userId: string, token: string): Promise<{ count: number; undated: number; courses: number }> {
  const { rows, undated, courses } = await fetchClassroom(token);
  const now = new Date().toISOString();
  if (rows.length) {
    const { error } = await supabase.from("lms_items").upsert(
      rows.map((r) => ({ ...r, user_id: userId, source: "google_classroom", course_code: "", removed_at: null, synced_at: now })),
      { onConflict: "user_id,source,source_id" },
    );
    if (error) throw new ClassroomError("api", /lms_items|schema cache|does not exist|policy/i.test(error.message) ? "School sync needs a database update. Run supabase/migration-29-lms-sync.sql." : "Couldn't save your Classroom items.");
  }
  // Everything in the window that Classroom no longer lists is marked removed.
  await supabase.from("lms_items").update({ removed_at: now })
    .eq("user_id", userId).eq("source", "google_classroom").is("removed_at", null).lt("synced_at", now)
    .gte("due_at", new Date(Date.now() - 30 * DAY).toISOString()).lte("due_at", new Date(Date.now() + 120 * DAY).toISOString());
  return { count: rows.length, undated, courses };
}

export function classroomMessage(e: unknown): string {
  if (e instanceof ClassroomError) {
    if (e.kind === "expired") return "Google's access lasts about an hour and has run out. Connect Google Classroom again to sync.";
    if (e.kind === "forbidden") return /has not been used|disabled|not enabled/i.test(e.message)
      ? "The Google Classroom API isn't switched on for this app yet."
      : "Google didn't allow access to Classroom. Connect again and tick every box on Google's permission screen.";
    return e.message;
  }
  return "Couldn't sync Google Classroom. Try again.";
}
