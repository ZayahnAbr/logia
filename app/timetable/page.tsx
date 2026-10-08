import { redirect } from "next/navigation";
import "../workspace-layout.css";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { getMySpaces } from "@/lib/queries";
import { listTimetable } from "@/app/calendar-actions";
import { TimetableMaker } from "@/components/TimetableMaker";

export const metadata = { title: "Timetable" };

export default async function TimetablePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  const [res, spaces] = await Promise.all([listTimetable(), getMySpaces()]);

  return (
    <AppShell>
      <div className="phead">
        <div className="eyebrow">Timetable</div>
        <h1>Your week</h1>
        <div className="sub">Build your weekly timetable by hand or from a photo. Classes belong to you, so they show in every space.</div>
      </div>
      <TimetableMaker
        initial={"classes" in res ? res.classes : []}
        loadError={"error" in res ? res.error : null}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
      />
    </AppShell>
  );
}
