"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DRIVE_FILE_SCOPE } from "@/lib/gdocsScopes";
import { gdocsDisconnect, gdocsStatus, type GdocsStatus } from "@/app/gdocs-actions";

// Connect Google Docs: uses your Google sign-in, limited to documents you pick or that Logia creates.
export function GoogleDocsCard({ notice }: { notice?: { kind: "ok" | "error"; text: string } }) {
  const [status, setStatus] = useState<GdocsStatus | null>(null);
  const [busy, setBusy] = useState<"" | "connect" | "disconnect">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(notice ?? null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => setStatus(await gdocsStatus()), []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy("connect"); setMsg(null);
    const supabase = createClient();
    const options = {
      scopes: DRIVE_FILE_SCOPE,
      queryParams: { access_type: "offline", prompt: "consent" },
      redirectTo: `${window.location.origin}/auth/callback?next=/spaces/settings&gdocs=1`,
    };
    const res = status?.hasGoogle
      ? await supabase.auth.signInWithOAuth({ provider: "google", options })
      : await supabase.auth.linkIdentity({ provider: "google", options });
    if (res.error) {
      const m = res.error.message.toLowerCase();
      setMsg({ kind: "error", text: m.includes("provider is not enabled") ? "Google sign-in isn't set up for this app yet." : m.includes("manual linking") ? "Linking Google to an existing account isn't switched on for this app yet." : res.error.message });
      setBusy("");
    }
    // On success the browser goes to Google.
  };

  const disconnect = async () => {
    setBusy("disconnect");
    const res = await gdocsDisconnect();
    setBusy(""); setConfirming(false);
    if (res.error) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "ok", text: "Google Docs disconnected. Linked notes keep their text and stop syncing until you connect again." });
    load();
  };

  const setupMissing = status !== null && !status.configured;

  return (
    <div className="card st-card" id="google-docs" style={{ marginTop: 16 }}>
      <div className="st-row">
        <div>
          <strong>Google Docs</strong>
          <span>
            Keep a note and a Google Doc in step. Logia can only open documents you pick or that Logia creates for you, never the rest of your Drive.
            {status?.connected ? " Connected." : ""}
          </span>
        </div>
        {status?.connected ? (
          confirming ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn st-danger" onClick={disconnect} disabled={busy !== ""}>
                {busy === "disconnect" && <Loader2 size={14} className="spin" aria-hidden="true" />} Yes, disconnect
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy !== ""}>Keep connected</button>
            </div>
          ) : (
            <button type="button" className="btn st-danger" onClick={() => setConfirming(true)} disabled={busy !== ""}>Disconnect</button>
          )
        ) : (
          <button type="button" className="btn btn-primary" onClick={connect} disabled={busy !== "" || status === null || setupMissing}>
            {busy === "connect" && <Loader2 size={14} className="spin" aria-hidden="true" />} Connect Google Docs
          </button>
        )}
      </div>

      {setupMissing && (
        <div className="st-row"><div><span role="status">Google Docs isn&apos;t set up for this app yet. An administrator needs to finish setup first.</span></div></div>
      )}
      {msg && <div className="st-row"><div><span role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</span></div></div>}

      <div className="st-row" style={{ display: "block" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Text, headings, lists and simple formatting sync. Pictures, tables and fonts stay where they are. Link a note from its Google Docs menu in the note toolbar.
          Syncing runs while the note is open. Google may show an &quot;unverified app&quot; warning until Logia is verified. To end access, choose Disconnect, or remove Logia in your Google account&apos;s third-party access settings.
        </p>
      </div>
    </div>
  );
}
