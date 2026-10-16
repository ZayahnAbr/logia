import { redirect } from "next/navigation";
import "../../admin-users.css";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { isAdmin } from "@/lib/server/admin";
import { UsersTable, type AdminUser } from "./UsersTable";

export const metadata: Metadata = { title: "Users · Logia admin" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  if (!isAdmin(user.email)) redirect("/spaces");

  const { data, error } = await supabase.rpc("admin_list_users", { p_limit: 2000 });
  const missing = !!error && /admin_list_users|schema cache|does not exist/i.test(error.message);
  const rows: AdminUser[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.user_id), email: String(r.email ?? ""), name: String(r.display_name ?? ""),
    signedUp: String(r.signed_up ?? ""), lastSignIn: r.last_sign_in ? String(r.last_sign_in) : null,
    plan: (r.effective_plan === "pro" || r.effective_plan === "admin" ? r.effective_plan : "free") as AdminUser["plan"],
    until: r.plan_until ? String(r.plan_until) : null, source: r.plan_source ? String(r.plan_source) : null,
    onboarded: !!r.onboarded, banned: !!r.banned,
  }));

  return (
    <AppShell>
      <div className="phead mesh-warm">
        <div className="eyebrow">Admin</div>
        <h1>Users</h1>
        <div className="sub">Who has signed up, when, and whether they are on Pro.</div>
      </div>
      {missing
        ? <div className="empty card" style={{ padding: 24 }}>This needs a database update. Run <strong>supabase/migration-55-admin-users.sql</strong> in Supabase, then refresh.</div>
        : error
        ? <div className="empty card" style={{ padding: 24 }}>Couldn&apos;t load users. Try again.</div>
        : <UsersTable users={rows} />}
    </AppShell>
  );
}
