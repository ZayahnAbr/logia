"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { onedriveDisconnect, onedriveStatus, type OneDriveStatus } from "@/app/onedrive-actions";

// Connect OneDrive: lets you bring Word files in and save notes out as Word files. One way each, no live sync.
export function OneDriveCard({ notice }: { notice?: { kind: "ok" | "error"; text: string } }) {
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(notice ?? null);

  const load = useCallback(async () => setStatus(await onedriveStatus()), []);
  useEffect(() => { load(); }, [load]);

  const disconnect = async () => {
    setBusy(true);
    const res = await onedriveDisconnect();
    setBusy(false); setConfirming(false);
    if (res.error) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "ok", text: "OneDrive disconnected. Files already in OneDrive and notes already imported are not changed." });
    load();
  };

  const setupMissing = status !== null && !status.configured;

  return (
    <div className="card st-card" id="onedrive" style={{ marginTop: 16 }}>
      <div className="st-row">
        <div>
          <strong>OneDrive (Word)</strong>
          <span>
            Import a Word file as a note, or save a note to OneDrive as a Word file. Each works one way and nothing stays in sync.
            {status?.connected ? " Connected." : ""}
          </span>
        </div>
        {status?.connected ? (
          confirming ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn st-danger" onClick={disconnect} disabled={busy}>
                {busy && <Loader2 size={14} className="spin" aria-hidden="true" />} Yes, disconnect
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>Keep connected</button>
            </div>
          ) : (
            <button type="button" className="btn st-danger" onClick={() => setConfirming(true)}>Disconnect</button>
          )
        ) : setupMissing || status === null ? (
          <button type="button" className="btn btn-primary" disabled>Connect OneDrive</button>
        ) : (
          <a className="btn btn-primary" href="/api/microsoft/connect">Connect OneDrive</a>
        )}
      </div>

      {setupMissing && <div className="st-row"><div><span role="status">OneDrive isn&apos;t set up for this app yet. An administrator needs to finish setup first.</span></div></div>}
      {msg && <div className="st-row"><div><span role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</span></div></div>}

      <div className="st-row" style={{ display: "block" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Logia can reach your OneDrive files to list and open Word files, and it saves its own copies in a folder called Logia. Edits made in Word are not brought back into a note.
          To end access, choose Disconnect, or remove Logia in your Microsoft account&apos;s app permissions.
        </p>
      </div>
    </div>
  );
}
