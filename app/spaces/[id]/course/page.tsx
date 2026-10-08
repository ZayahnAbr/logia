import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getFiles } from "@/lib/queries";
import { loadCourses } from "@/lib/server/courses";
import { CourseOutlineButton } from "@/components/CourseOutlineSetup";
import { CourseManage } from "@/components/CourseManage";
import { MarkCalculator, TopicChecklist } from "@/components/CourseTracker";
import { summarise, courseLabel } from "@/lib/courseOutline";
import "../../../workspace-layout.css";

const f1 = (n: number) => String(Math.round(n * 10) / 10);

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  const { id } = await params;
  const { c: pick } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, { multi, courses }, files] = await Promise.all([getSpace(id), loadCourses(supabase, user.id, id), getFiles(id)]);
  const outlineFiles = files.map((f) => ({ id: f.id, name: f.name, path: f.path, mime_type: f.mime_type }));
  const selected = courses.find((c) => c.id === pick);
  const showAll = !selected && courses.length > 1;
  const current = selected ?? (courses.length === 1 ? courses[0] : null);

  const sums = courses.map((c) => ({ c, s: summarise(c.assessments), unmarked: c.assessments.filter((a) => a.mark_percent == null).length }));
  const now = Date.now();
  const deadlines = courses.reduce((n, c) => n + c.assessments.filter((a) => a.due_at && a.mark_percent == null && new Date(a.due_at).getTime() >= now).length, 0);
  const allOk = sums.length > 0 && sums.every(({ c, s }) => c.assessments.length > 0 && Math.abs(s.weightSum - 100) < 0.01 && s.markedWeight > 0);
  const combined = allOk ? sums.reduce((t, { s }) => t + (s.earned / s.markedWeight) * 100, 0) / sums.length : null;

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Courses and marks</h1>
        <div className="sub">{courses.length ? "Track your marks and topics for each course, then add the next one." : "Set up from your course outline, then track your marks and topics as the term goes on."}</div>
      </div>

      {courses.length === 0 ? (
        <div className="co-page-empty">
          <CourseOutlineButton spaceId={id} files={outlineFiles} variant="card" />
        </div>
      ) : (
        <>
          {!multi && (
            <p className="co-warn co-multi-note" role="note">This space can hold one course for now. To add several courses, ask the site admin to run the latest Supabase migration (33). Reading another outline will replace this course.</p>
          )}
          <nav className="co-tabs" aria-label="Courses">
            {courses.length > 1 && <Link href={`/spaces/${id}/course`} className="co-tab" aria-current={showAll ? "page" : undefined}>All courses</Link>}
            {courses.map((c) => (
              <Link key={c.id} href={`/spaces/${id}/course?c=${c.id}`} className="co-tab" aria-current={current?.id === c.id ? "page" : undefined}>{courseLabel(c)}</Link>
            ))}
            {multi && <span className="co-tab-add"><CourseOutlineButton spaceId={id} files={outlineFiles} variant="button" label="Add another course" /></span>}
          </nav>

          {showAll && (
            <section aria-labelledby="co-all-h" className="co-all">
              <h2 id="co-all-h" className="co-page-h">All courses</h2>
              <ul className="co-all-list">
                {sums.map(({ c, s, unmarked }) => (
                  <li key={c.id} className="co-all-row">
                    <Link href={`/spaces/${id}/course?c=${c.id}`} className="co-all-name">{courseLabel(c)}</Link>
                    <span>{s.markedWeight > 0 ? <><strong>{f1(s.earned)}%</strong> of the final mark earned from {f1(s.markedWeight)}% marked</> : "No marks entered yet"}</span>
                    <span className="co-sub">{unmarked} of {c.assessments.length} assessment{c.assessments.length === 1 ? "" : "s"} unmarked{Math.abs(s.weightSum - 100) > 0.01 && c.assessments.length > 0 ? `, weights add up to ${f1(s.weightSum)}%` : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="co-total"><strong>{deadlines}</strong> <span>unmarked assessment{deadlines === 1 ? "" : "s"} still ahead with a date, across all courses</span></p>
              {combined != null ? (
                <p className="co-total"><strong>{f1(combined)}%</strong> <span>average standing across your courses (each course&rsquo;s marks so far, weighted within it, then averaged equally)</span></p>
              ) : (
                <p className="co-page-note">No combined mark is shown. It needs every course to have weights that add up to 100% and at least one mark entered. Courses are never averaged on guesses.</p>
              )}
            </section>
          )}

          {current && (
            <div className="co-page">
              <section className="co-page-main" aria-labelledby="co-marks-h">
                <h2 id="co-marks-h" className="co-page-h">{courseLabel(current)}: mark calculator</h2>
                {current.assessments.length ? <MarkCalculator key={current.id} rows={current.assessments} /> : <p className="co-page-note">No assessments were saved for this course.</p>}
              </section>

              <aside className="co-page-side">
                <section aria-labelledby="co-topics-h">
                  <h2 id="co-topics-h" className="co-page-h">Topics</h2>
                  {current.topics.length ? <TopicChecklist key={current.id} rows={current.topics} /> : <p className="co-page-note">No topics were saved for this course.</p>}
                </section>

                {current.books.length > 0 && (
                  <section aria-labelledby="co-books-h">
                    <h2 id="co-books-h" className="co-page-h">Prescribed reading</h2>
                    <ul className="co-books">
                      {current.books.map((b, i) => (
                        <li key={`${b.title}-${i}`}><strong>{b.title}</strong>{b.author ? <span> {b.author}</span> : null}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section aria-labelledby="co-redo-h">
                  <h2 id="co-redo-h" className="co-page-h">This course</h2>
                  {multi ? (
                    <>
                      <p className="co-page-note">Reading an outline again replaces only this course&rsquo;s assessments and topics.</p>
                      <CourseManage spaceId={id} courseId={current.id} code={current.code} name={current.name} files={outlineFiles} />
                    </>
                  ) : (
                    <CourseOutlineButton spaceId={id} files={outlineFiles} variant="button" label="Read an outline again" />
                  )}
                </section>
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}
