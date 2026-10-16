"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export type AdminUser = {
  id: string; email: string; name: string; signedUp: string; lastSignIn: string | null;
  plan: "free" | "pro" | "admin"; until: string | null; source: string | null; onboarded: boolean; banned: boolean;
};

const DAY = 86_400_000;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const PAGE = 50;
type Filter = "all" | "pro" | "free" | "new";

export function UsersTable({ users }: { users: AdminUser[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const stats = useMemo(() => {
    const now = Date.now();
    const since = (d: number) => users.filter((u) => now - new Date(u.signedUp).getTime() < d * DAY).length;
    return {
      total: users.length, today: since(1), week: since(7), month: since(30),
      pro: users.filter((u) => u.plan === "pro").length, admins: users.filter((u) => u.plan === "admin").length,
    };
  }, [users]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const now = Date.now();
    return users.filter((u) =>
      (filter === "all" || (filter === "pro" && u.plan === "pro") || (filter === "free" && u.plan === "free") || (filter === "new" && now - new Date(u.signedUp).getTime() < 7 * DAY))
      && (!needle || u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle)));
  }, [users, q, filter]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = shown.slice(cur * PAGE, cur * PAGE + PAGE);

  return (
    <div className="au">
      <div className="au-stats">
        {([["Total users", stats.total], ["Today", stats.today], ["This week", stats.week], ["This month", stats.month], ["Pro", stats.pro], ["Admins", stats.admins]] as [string, number][]).map(([l, v]) => (
          <div key={l} className="au-stat"><b>{v}</b><span>{l}</span></div>
        ))}
      </div>

      <div className="au-bar">
        <div className="nb-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="au-q" className="sr-only">Search users</label>
          <input id="au-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search by email or name" />
        </div>
        <div className="seg" role="group" aria-label="Filter users">
          {([["all", "All"], ["new", "New this week"], ["pro", "Pro"], ["free", "Free"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" className="seg-b" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(0); }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="au-table-wrap">
        <table className="au-table">
          <thead><tr><th>User</th><th>Signed up</th><th>Last sign-in</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="au-empty">No users match.</td></tr>}
            {rows.map((u) => (
              <tr key={u.id}>
                <td><div className="au-email">{u.email || "(no email)"}</div>{u.name && <div className="au-sub">{u.name}</div>}</td>
                <td><div>{fmtDate(u.signedUp)}</div><div className="au-sub">{fmtTime(u.signedUp)}</div></td>
                <td>{fmtDate(u.lastSignIn)}</td>
                <td>
                  <span className={`au-badge ${u.plan}`}>{u.plan === "pro" ? "Pro" : u.plan === "admin" ? "Admin" : "Free"}</span>
                  {u.plan === "pro" && u.until && <div className="au-sub">until {fmtDate(u.until)}</div>}
                </td>
                <td>{u.banned ? <span className="au-badge banned">Banned</span> : u.onboarded ? "Active" : <span className="au-sub">Not onboarded</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="au-foot">
        <span>{shown.length} user{shown.length === 1 ? "" : "s"}</span>
        {pages > 1 && (
          <div className="au-pager">
            <button type="button" className="btn btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
            <span>Page {cur + 1} of {pages}</span>
            <button type="button" className="btn btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
