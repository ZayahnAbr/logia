import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { platformLabel } from "@/lib/lmsPlatforms";

// "From your school": the next few deadlines synced by the browser extension. Renders nothing until something is synced.
const TYPE: Record<string, string> = { assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", checklist: "Checklist", event: "Event", other: "Item" };

type Row = { id: string; source: string; title: string; course: string; course_code: string; item_type: string; due_at: string; url: string };

function when(iso: string) {
  const due = new Date(iso), now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(due) - day(now)) / 86_400_000);
  const time = due.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (due < now && days <= 0) return days === 0 ? `Overdue, was due ${time}` : `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${due.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  return `In ${days} days, ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export async function SchoolSyncList() {
  const supabase = await createClient();
  const from = new Date(); from.setDate(from.getDate() - 14);
  const to = new Date(); to.setDate(to.getDate() + 45);
  const { data, error } = await supabase.from("lms_items")
    .select("id,source,title,course,course_code,item_type,due_at,url")
    .is("removed_at", null).eq("completed", false).not("due_at", "is", null)
    .gte("due_at", from.toISOString()).lte("due_at", to.toISOString()).order("due_at").limit(6);
  if (error || !data || data.length === 0) return null;
  const rows = data as Row[];
  return (
    <section className="card lms-card" aria-labelledby="lms-h">
      <h3 id="lms-h">From your school</h3>
      <ul className="cal-list">
        {rows.map((r) => {
          const overdue = new Date(r.due_at) < new Date();
          const body = (
            <>
              <span className="cal-item-title">{r.title}</span>
              <span className="cal-item-meta">
                <span className="cal-urg medium">{platformLabel(r.source)}</span>
                {TYPE[r.item_type] ?? "Item"}{r.course || r.course_code ? ` · ${r.course || r.course_code}` : ""} · {when(r.due_at)}
                {r.url && <ExternalLink size={11} aria-hidden="true" />}
              </span>
            </>
          );
          return (
            <li key={r.id} className={`cal-item cal-lms${overdue ? " overdue" : ""}`} style={{ ["--ev" as string]: "#2f5bd3" }}>
              <span className="cal-lms-mark" aria-hidden="true" />
              {r.url
                ? <a className="cal-item-main" href={r.url} target="_blank" rel="noopener noreferrer">{body}<span className="sr-only">, opens your school site in a new tab</span></a>
                : <div className="cal-item-main">{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
