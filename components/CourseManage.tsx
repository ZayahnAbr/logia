"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "@/components/Toaster";
import { renameCourse, deleteCourse } from "@/app/course-outline-actions";
import { CourseOutlineButton, type OutlineFile } from "@/components/CourseOutlineSetup";

export function CourseManage({ spaceId, courseId, code, name, files }: { spaceId: string; courseId: string; code: string; name: string; files: OutlineFile[] }) {
  const router = useRouter();
  const [c, setC] = useState(code);
  const [n, setN] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = c !== code || n !== name;

  const save = () => start(async () => {
    const res = await renameCourse(spaceId, courseId, c, n);
    if (res.error) setErr(res.error); else { setErr(null); toast("Course renamed."); router.refresh(); }
  });
  const remove = () => start(async () => {
    if (!window.confirm("Delete this course with its assessments, marks and topics? Calendar deadlines and notebooks already made stay. This can't be undone.")) return;
    const res = await deleteCourse(spaceId, courseId);
    if (res.error) setErr(res.error); else { toast("Course deleted."); router.push(`/spaces/${spaceId}/course`); router.refresh(); }
  });

  return (
    <div className="co-manage">
      <div className="co-grid3">
        <label>Code<input className="input" value={c} maxLength={30} onChange={(e) => setC(e.target.value)} disabled={pending} /></label>
        <label>Name<input className="input" value={n} maxLength={160} onChange={(e) => setN(e.target.value)} disabled={pending} /></label>
      </div>
      <div className="co-manage-row">
        <button type="button" className="btn btn-sm" onClick={save} disabled={pending || !dirty}>Save name</button>
        <CourseOutlineButton spaceId={spaceId} files={files} variant="button" courseId={courseId} label="Read an outline again" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={remove} disabled={pending}><Trash2 size={14} aria-hidden="true" /> Delete course</button>
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}
