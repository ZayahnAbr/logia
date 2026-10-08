import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { isAdmin } from "@/lib/server/admin";
import { listOpenReports, listAllStreams } from "@/app/discover-actions";
import { listPendingCafes } from "@/app/cafe-actions";
import { AdminPanel } from "./AdminPanel";

export const metadata: Metadata = { title: "Discover admin · Logia" };

export default async function DiscoverAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  if (!isAdmin(user.email)) redirect("/discover");

  const [reports, streams, pending] = await Promise.all([listOpenReports(), listAllStreams(), listPendingCafes()]);

  return (
    <AppShell>
      <div className="phead mesh-warm">
        <div className="eyebrow">Discover admin</div>
        <h1>Reports, rooms and streams</h1>
        <div className="sub">Review reported content, approve hosted rooms and choose which study-with-me streams people see.</div>
      </div>
      <Link href="/discover" className="btn btn-sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} aria-hidden="true" /> Back to Discover</Link>
      <AdminPanel
        reports={"reports" in reports ? reports.reports : []}
        reportsError={"error" in reports ? reports.error : ""}
        streams={"streams" in streams ? streams.streams : []}
        streamsError={"error" in streams ? streams.error : ""}
        pending={"cafes" in pending ? pending.cafes : []}
        pendingError={"error" in pending ? pending.error : ""}
      />
    </AppShell>
  );
}
