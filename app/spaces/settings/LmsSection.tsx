"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "@/components/Toaster";
import { createLmsConnection, listLmsConnections, revokeLmsConnection, type LmsConnection } from "@/app/lms-actions";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export function LmsSection({ notice }: { notice?: { kind: "ok" | "error"; text: string } }) {
  const [conns, setConns] = useState<LmsConnection[] | null>(null);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    const res = await listLmsConnections();
    if ("error" in res) { setErr(res.error); setConns([]); return; }
    setErr(null); setConns(res.connections); setCount(res.itemCount); setLast(res.lastSync);
  }, []);
  useEffect(() => { load(); setOrigin(window.location.origin); }, [load]);

  const make = async () => {
    setBusy(true);
    const res = await createLmsConnection();
    setBusy(false);
    if ("error" in res) { toast(res.error, "error"); return; }
    setCode(res.code); load();
  };
  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); toast("Code copied", "success"); } catch { toast("Couldn't copy. Select the code and copy it by hand.", "error"); }
  };
  const revoke = async (c: LmsConnection) => {
    if (!window.confirm("Revoke this code? The extension using it will stop syncing.")) return;
    const res = await revokeLmsConnection(c.id);
    if (res.error) { toast(res.error, "error"); return; }
    toast("Code revoked", "success"); load();
  };

  return (
    <>
    <div className="card st-card">
      <div className="st-row">
        <div>
          <strong>Sync Work To Do from your school</strong>
          <span>Install the Logia School Sync extension in Chrome or Edge. Your school login stays in your browser. Only titles, courses, due dates and links are sent to Logia.</span>
          <span><strong style={{ fontSize: 13 }}>Works with:</strong> Brightspace, Canvas, Moodle. <strong style={{ fontSize: 13 }}>Experimental:</strong> Blackboard.</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={make} disabled={busy || !!err}>
          {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />} New connection code
        </button>
      </div>

      {err && <div className="st-row"><div><span role="alert">{err}</span></div></div>}

      {code && (
        <div className="st-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <strong id="lms-code-label">Your connection code</strong>
          <span>Shown once. Paste it into the extension, then close this. If you lose it, make a new one.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" readOnly value={code} aria-labelledby="lms-code-label" onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 260px", fontFamily: "ui-monospace, monospace" }} />
            <button type="button" className="btn" onClick={copy}><Copy size={14} aria-hidden="true" /> Copy</button>
            <button type="button" className="btn btn-ghost" onClick={() => setCode(null)}>Hide</button>
          </div>
          {origin && <span>Logia address for the extension: <code>{origin}</code></span>}
        </div>
      )}

      <div className="st-row">
        <div>
          <strong>Last sync</strong>
          <span>{conns === null ? "Loading" : `${fmt(last)} · ${count} item${count === 1 ? "" : "s"} from your school`}</span>
        </div>
      </div>

      {conns && conns.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Connection codes">
          {conns.map((c) => (
            <li key={c.id} className="st-row">
              <div>
                <strong>{c.label} code</strong>
                <span>Made {fmt(c.created_at)} · Last used {fmt(c.last_used_at)}</span>
              </div>
              <button type="button" className="btn st-danger" onClick={() => revoke(c)} aria-label={`Revoke the ${c.label} code made ${fmt(c.created_at)}`}><Trash2 size={14} aria-hidden="true" /> Revoke</button>
            </li>
          ))}
        </ul>
      )}

      <details className="st-row" style={{ display: "block" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to install the extension</summary>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Get the <code>extension</code> folder from the Logia project (its README has the full steps).</li>
          <li>In Chrome or Edge open <code>chrome://extensions</code> (or <code>edge://extensions</code>) and turn on Developer mode.</li>
          <li>Choose Load unpacked and pick the <code>extension</code> folder.</li>
          <li>Open the extension, paste your connection code, the Logia address shown above, and your school&apos;s learning site address (for example <code>learn.myschool.edu</code>).</li>
          <li>Sign in to your school site, open the extension and choose Sync now. You review the list before anything is sent.</li>
        </ol>
        <p style={{ margin: "8px 0 0" }}>Logia only receives what you tick in that list. It can&apos;t log in to your school for you, and it can&apos;t see your grades.</p>
      </details>
    </div>
    </>
  );
}
