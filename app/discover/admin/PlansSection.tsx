"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { lookupPlan, setPlan, type PlanLookup } from "@/app/plan-admin-actions";
import { toast } from "@/components/Toaster";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });

// How Pro is granted until payments exist: find a student by email, then grant or revoke.
export function PlansSection() {
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<PlanLookup | null>(null);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setFound(null);
    const res = await lookupPlan(email);
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    setFound(res.user);
  };

  const act = async (action: "grant" | "revoke") => {
    if (!found) return;
    if (action === "revoke" && !window.confirm(`Remove Pro from ${found.email}? They go back to the free plan straight away.`)) return;
    setBusy(true);
    const res = await setPlan(found.userId, action, until);
    if ("error" in res) { setBusy(false); toast(res.error, "error"); return; }
    const again = await lookupPlan(found.email);
    setBusy(false);
    if ("user" in again) setFound(again.user);
    toast(action === "grant" ? "Pro granted." : "Pro removed.");
  };

  const status = !found ? "" : found.plan === "admin" ? "Admin (always unlimited)"
    : found.active ? `Pro until ${fmt(found.until!)}${found.source ? ` (granted: ${found.source})` : ""}`
    : found.plan === "pro" ? `Free (Pro ended ${found.until ? fmt(found.until) : ""})` : "Free";

  return (
    <section aria-labelledby="adm-plans">
      <h2 id="adm-plans" className="dc-h2">Plans</h2>
      <form onSubmit={find} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div className="field">
          <label className="field-label" htmlFor="pl-email">Student email</label>
          <input id="pl-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </div>
        <div><button type="submit" className="btn btn-primary" disabled={busy || !email}><Search size={15} aria-hidden="true" /> Look up</button></div>
        {err && <div className="notice notice-error" role="alert">{err}</div>}
      </form>

      {found && (
        <div className="card" style={{ padding: 16, display: "grid", gap: 12, marginTop: 12 }} aria-live="polite">
          <div>
            <strong style={{ overflowWrap: "anywhere" }}>{found.email}</strong>
            <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>Current plan: {status}</div>
          </div>
          {found.plan !== "admin" && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="pl-until">Pro runs until</label>
                <input id="pl-until" type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
                <div className="field-hint">The plan ends at the end of that day (South African time) and the student drops back to free on its own.</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" disabled={busy || !until} onClick={() => act("grant")}>{found.active ? "Change end date" : "Grant Pro"}</button>
                {found.active && <button type="button" className="btn" disabled={busy} onClick={() => act("revoke")}>Remove Pro</button>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
