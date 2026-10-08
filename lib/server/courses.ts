import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentRow, CourseData, TopicRow } from "@/lib/courseOutline";

const ACOLS = "id, title, type, weight_percent, due_at, mark_percent";
const TCOLS = "id, name, week, done";

// Loads this person's courses in a space. Works before migration 33: then the space's rows are
// shown as one course (multi=false) so the UI can say adding more needs the update.
export async function loadCourses(supabase: SupabaseClient, userId: string, spaceId: string): Promise<{ multi: boolean; courses: CourseData[] }> {
  const probe = await supabase.from("course_assessments").select("course_id").limit(1);
  const multi = !probe.error;
  const books = (v: unknown) => (Array.isArray(v) ? (v as { title: string; author?: string }[]) : []);

  if (!multi) {
    const [a, t, o] = await Promise.all([
      supabase.from("course_assessments").select(ACOLS).eq("user_id", userId).eq("space_id", spaceId).order("due_at", { nullsFirst: false }).order("created_at"),
      supabase.from("course_topics").select(TCOLS).eq("user_id", userId).eq("space_id", spaceId).order("sort"),
      supabase.from("course_outlines").select("id, course_code, course_name, lecturer, textbooks").eq("user_id", userId).eq("space_id", spaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const assessments = (a.data ?? []) as AssessmentRow[], topics = (t.data ?? []) as TopicRow[];
    if (!assessments.length && !topics.length && !o.data) return { multi, courses: [] };
    return { multi, courses: [{ id: o.data?.id ?? "legacy", code: o.data?.course_code ?? "", name: o.data?.course_name ?? "", lecturer: o.data?.lecturer ?? "", books: books(o.data?.textbooks), assessments, topics }] };
  }

  const [o, a, t] = await Promise.all([
    supabase.from("course_outlines").select("id, course_code, course_name, lecturer, textbooks, sort, created_at").eq("user_id", userId).eq("space_id", spaceId).eq("archived", false).order("sort").order("created_at"),
    supabase.from("course_assessments").select(`${ACOLS}, course_id`).eq("user_id", userId).eq("space_id", spaceId).order("due_at", { nullsFirst: false }).order("created_at"),
    supabase.from("course_topics").select(`${TCOLS}, course_id`).eq("user_id", userId).eq("space_id", spaceId).order("sort"),
  ]);
  const courses = (o.data ?? []).map((c) => ({
    id: c.id as string, code: (c.course_code as string) ?? "", name: (c.course_name as string) ?? "", lecturer: (c.lecturer as string) ?? "", books: books(c.textbooks),
    assessments: (a.data ?? []).filter((r) => r.course_id === c.id) as AssessmentRow[],
    topics: (t.data ?? []).filter((r) => r.course_id === c.id) as TopicRow[],
  }));
  return { multi, courses };
}
