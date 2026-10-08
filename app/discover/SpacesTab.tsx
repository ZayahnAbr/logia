"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Search, Users } from "lucide-react";
import { listPublicSpaces, joinPublicSpace, type PublicSpace } from "@/app/discover-actions";
import { toast } from "@/components/Toaster";
import { ReportDialog } from "./ReportDialog";

export function SpacesTab() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<PublicSpace[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [joining, setJoining] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listPublicSpaces().then((r) => { if (!alive) return; if ("error" in r) setError(r.error); else setSpaces(r.spaces); });
    return () => { alive = false; };
  }, []);

  const join = async (s: PublicSpace) => {
    setJoining(s.id);
    const res = await joinPublicSpace(s.id);
    setJoining(null);
    if ("error" in res) { toast(res.error, "error"); return; }
    router.push(`/spaces/${res.id}`);
  };

  const needle = q.trim().toLowerCase();
  const list = (spaces ?? []).filter((s) => !needle || [s.name, s.subject, s.public_description].some((v) => v?.toLowerCase().includes(needle)));

  return (
    <div>
      <div className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
        <label className="field-label" htmlFor="space-search">Search public spaces</label>
        <div style={{ position: "relative" }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }} />
          <input id="space-search" type="search" className="input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Subject, course or name" />
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {!error && spaces === null && <p role="status" style={{ color: "var(--muted)" }}>Loading public spaces…</p>}
      {!error && spaces !== null && list.length === 0 && (
        <div className="empty card" style={{ padding: "32px 20px" }}>
          {spaces.length === 0 ? "No public spaces yet. The creator of a space can make it public from the space home page." : "No spaces match that search."}
        </div>
      )}

      <ul className="dc-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.map((s) => (
          <li key={s.id} className="card dc-card">
            <div className="dc-body">
              {s.subject && <div className="eyebrow">{s.subject}</div>}
              <h2 className="dc-name">{s.name}</h2>
              <p className="dc-desc">{s.public_description || "No description yet."}</p>
              <div className="dc-meta"><span className="dc-count"><Users size={14} aria-hidden="true" /> {s.member_count} {s.member_count === 1 ? "member" : "members"}</span></div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" disabled={joining === s.id} onClick={() => join(s)} aria-label={`Join ${s.name}`}>{joining === s.id ? "Joining…" : "Join"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setReporting(s.id)} aria-label={`Report ${s.name}`}><Flag size={14} aria-hidden="true" /> Report</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {reporting && <ReportDialog kind="space" targetId={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}
